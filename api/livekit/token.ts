import { AccessToken } from 'livekit-server-sdk';
import { localDevelopment, readDevSession } from '../../server/dev-sessions.js';
import type { LiveKitTokenRequest, LiveKitTokenResponse } from '../../packages/shared/src/livekit.js';

interface TokenRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface TokenResponseWriter {
  status(code: number): TokenResponseWriter;
  json(payload: unknown): unknown;
  setHeader?(name: string, value: string): void;
}

function readBody(body: unknown): LiveKitTokenRequest | null {
  if (!body || typeof body !== 'object' || !('groupId' in body)) return null;
  const groupId = (body as { groupId?: unknown }).groupId;
  return typeof groupId === 'string' && groupId.length > 0 && groupId.length <= 100
    ? { groupId }
    : null;
}

export default async function handler(req: TokenRequest, res: TokenResponseWriter) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST to request room access.' });
  }

  // Match the local-only development gate used by the queue API. LAN clients
  // reach this endpoint through Vite's same-origin proxy during local demos.
  // Production still requires verified auth and database group membership.
  if (!localDevelopment(req.headers)) {
    return res.status(503).json({ error: 'Room authentication is not configured.' });
  }

  const session = readDevSession(req.headers.cookie);
  if (!session) return res.status(401).json({ error: 'Please sign in before joining a room.' });
  const request = readBody(req.body);
  if (!request) {
    return res.status(400).json({ error: 'A groupId is required.' });
  }

  if (request.groupId !== session.groupId || !session.profile) {
    return res.status(403).json({ error: 'This user is not a member of that group.' });
  }

  const { LIVEKIT_URL: serverUrl, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = process.env;
  if (!serverUrl || !apiKey || !apiSecret) {
    return res.status(503).json({ error: 'Add LiveKit credentials to .env.local, then restart the dev server.' });
  }

  try {
    // The room name and participant identity come from the server-side match,
    // not from caller-controlled token claims.
    const roomName = `lavoirs_${session.groupId}`;
    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity: session.user.id,
      name: session.profile.name,
      ttl: '10m',
    });
    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });

    const response: LiveKitTokenResponse = {
      serverUrl,
      participantToken: await accessToken.toJwt(),
      roomName,
      participantName: session.profile.name,
    };
    return res.status(200).json(response);
  } catch {
    return res.status(500).json({ error: 'Could not create room access.' });
  }
}
