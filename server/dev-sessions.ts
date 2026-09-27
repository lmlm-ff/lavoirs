import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { Profile } from '../packages/shared/src/profile.js';
import type { QueueState, MatchGroup } from '../packages/shared/src/matching.js';
import { User } from '../api/profiles/Profile.js';
import { Group } from '../api/matching/Group.js';
import { Groups } from '../api/matching/groups.js';
import { MatchQueue } from '../api/matching/queue.js';
import { IcebreakerGenerator } from '../api/matching/IcebreakerGenerator.js';

interface DevSession {
  user: { id: string; email: string };
  profile: Profile | null;
  groupId: string | null;
  matchUser: User | null;
}

const sessions = new Map<string, DevSession>();
const matchQueue = new MatchQueue(4, 100, 60_000);
const groups = new Groups();
const promptJobs = new Map<string, Promise<void>>();

const icebreakerGenerator = new IcebreakerGenerator({
  async generateText({ systemPrompt, userPrompt }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_output_tokens: 120,
        store: false,
      }),
    });

    if (!response.ok) throw new Error(`Prompt generation failed (${response.status})`);
    const result = await response.json() as { output_text?: unknown };
    if (typeof result.output_text !== 'string') throw new Error('Prompt response did not contain text');
    return result.output_text;
  },
});

export function localDevelopment(headers: Record<string, unknown>) {
  return process.env.NODE_ENV === 'development' && process.env.DEV_FAKE_USER_AUTH === 'true'
    && typeof headers.host === 'string' && isLocalDevelopmentHost(headers.host);
}

function isLocalDevelopmentHost(value: string): boolean {
  const host = value.trim().toLowerCase();
  const hostname = host.startsWith('[')
    ? host.slice(1, host.indexOf(']'))
    : host.replace(/:\d+$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1') return true;

  if (isIP(hostname) === 4) {
    const [first, second] = hostname.split('.').map(Number);
    return first === 10 || first === 192 && second === 168 || first === 172 && second >= 16 && second <= 31 || first === 127;
  }
  if (isIP(hostname) === 6) return hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:');
  return false;
}

export function readDevSession(cookie: unknown): DevSession | undefined {
  const key = typeof cookie === 'string' ? cookie.split(';').map(s => s.trim()).find(s => s.startsWith('lavoirs_dev='))?.slice(12) : undefined;
  return key ? sessions.get(key) : undefined;
}

export function deleteDevSession(cookie: unknown) {
  const key = typeof cookie === 'string' ? cookie.split(';').map(s => s.trim()).find(s => s.startsWith('lavoirs_dev='))?.slice(12) : undefined;
  if (!key) return;
  const session = sessions.get(key);
  if (session) {
    leaveDevQueue(session);
    leaveDevGroup(session);
  }
  sessions.delete(key);
}

export function createDevSession(email: string) {
  const key = randomUUID();
  const session: DevSession = {
    user: { id: randomUUID(), email },
    profile: null,
    groupId: null,
    matchUser: null,
  };
  sessions.set(key, session);
  return { key, session };
}

export function leaveDevQueue(session: DevSession): boolean {
  if (!session.matchUser || !matchQueue.leave(session.matchUser.id)) return false;
  session.matchUser = null;
  return true;
}

export function leaveDevGroup(session: DevSession): boolean {
  if (!session.groupId) return false;
  const group = groups.get(session.groupId);
  const removed = group?.removeMember(session.user.id) ?? false;
  session.groupId = null;
  if (session.matchUser) session.matchUser.groupId = null;
  return removed;
}

export async function joinDevQueue(
  session: DevSession,
  location: { latitude: number; longitude: number },
): Promise<QueueState> {
  if (!session.profile) throw new Error('Complete your profile before joining the queue.');
  if (session.groupId) return getDevQueueState(session);
  if (session.matchUser?.inQueue) return getDevQueueState(session);

  const user = new User({
    id: session.user.id,
    name: session.profile.name,
    interests: session.profile.interests,
    location,
    radiusKm: session.profile.radiusKm,
  });
  session.matchUser = user;
  matchQueue.join(user);
  createReadyGroups();
  return getDevQueueState(session);
}

export async function getDevQueueState(session: DevSession): Promise<QueueState> {
  createReadyGroups();
  const state = queueStateFor(session);
  if (state.status !== 'matched') return state;

  const group = groups.get(state.group.id);
  if (group) await generateGroupPrompt(group);
  return group ? { ...state, group: serializeGroup(group) } : { status: 'idle' };
}

export function devGroup(session: DevSession): MatchGroup | null {
  const group = session.groupId ? groups.get(session.groupId) : undefined;
  return group ? serializeGroup(group) : null;
}

function createReadyGroups() {
  for (const group of groups.createReadyGroups(matchQueue)) {
    for (const member of group.members) {
      const memberSession = [...sessions.values()].find(candidate => candidate.user.id === member.id);
      if (memberSession) memberSession.groupId = group.id;
    }
    void generateGroupPrompt(group);
  }
}

async function generateGroupPrompt(group: Group): Promise<void> {
  if (group.icebreakerPrompt) return;
  let job = promptJobs.get(group.id);
  if (!job) {
    job = icebreakerGenerator.generate(group)
      .then(prompt => group.setIcebreakerPrompt(prompt.text))
      .finally(() => promptJobs.delete(group.id));
    promptJobs.set(group.id, job);
  }
  await job;
}

function queueStateFor(session: DevSession): QueueState {
  const group = session.groupId ? groups.get(session.groupId) : undefined;
  if (group) return { status: 'matched', group: serializeGroup(group) };
  if (!session.matchUser?.inQueue) return { status: 'idle' };
  return {
    status: 'waiting',
    nearbyCount: matchQueue.countCompatible(session.matchUser),
    groupSize: matchQueue.groupSize,
  };
}

function serializeGroup(group: Group): MatchGroup {
  return {
    id: group.id,
    roomId: group.id,
    participants: group.members.map(member => ({
      id: member.id,
      name: member.name,
      interests: [...member.interests],
    })),
    sharedInterests: [...group.sharedInterests],
    matchType: group.matchType,
    icebreakerPrompt: group.icebreakerPrompt,
  };
}
