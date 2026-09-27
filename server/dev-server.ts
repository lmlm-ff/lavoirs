import express from 'express';
import tokenHandler from '../api/livekit/token.js';
import {
  createDevSession,
  deleteDevSession,
  devGroup,
  getDevQueueState,
  joinDevQueue,
  leaveDevGroup,
  leaveDevQueue,
  localDevelopment,
  readDevSession,
} from './dev-sessions.js';

process.env.NODE_ENV ??= 'development';
// This server binds to loopback and is only for local development. Keep an
// explicit false value as an opt-out, but make the documented local demo work
// without requiring developers to create .env.local first.
process.env.DEV_FAKE_USER_AUTH ??= 'true';

const app = express();
app.use(express.json({ limit: '10kb' }));
app.get('/api/health', (_request, response) => response.json({ ok: true }));
app.use('/api/dev', (request, response, next) => {
  if (!localDevelopment(request.headers)) { response.status(503).json({ error: 'Local development sessions are disabled.' }); return; }
  const origin = request.headers.origin;
  if (typeof origin === 'string') {
    try {
      const parsedOrigin = new URL(origin);
      if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.host !== request.headers.host) { response.sendStatus(403); return; }
    } catch { response.sendStatus(403); return; }
  }
  next();
});
app.post('/api/dev/session', (request, response) => {
  const email = request.body?.email;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) { response.sendStatus(400); return; }
  deleteDevSession(request.headers.cookie);
  const { key, session } = createDevSession(email);
  response.cookie('lavoirs_dev', key, { httpOnly: true, sameSite: 'strict', path: '/' });
  response.json({ user: session.user });
});
app.get('/api/dev/session', (request, response) => {
  const session = readDevSession(request.headers.cookie);
  response.json(session ? { user: session.user } : null);
});
app.delete('/api/dev/session', (request, response) => {
  deleteDevSession(request.headers.cookie);
  response.clearCookie('lavoirs_dev', { path: '/' });
  response.json({ ok: true });
});
app.get('/api/dev/profile', (request, response) => {
  const session = readDevSession(request.headers.cookie);
  if (!session) { response.sendStatus(401); return; }
  response.json(session.profile);
});
app.put('/api/dev/profile', (request, response) => {
  const session = readDevSession(request.headers.cookie);
  if (!session) { response.sendStatus(401); return; }
  const p = request.body;
  if (!p || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60
    || typeof p.location !== 'string' || !p.location.trim() || p.location.length > 100
    || typeof p.description !== 'string' || p.description.length > 500
    || !Array.isArray(p.interests) || !p.interests.length || p.interests.length > 30 || p.interests.some((i: unknown) => typeof i !== 'string')
    || typeof p.radiusKm !== 'number' || p.radiusKm < 5 || p.radiusKm > 100 || typeof p.transcriptionConsent !== 'boolean') { response.sendStatus(400); return; }
  if (session.matchUser?.inQueue) leaveDevQueue(session);
  session.profile = { ...session.user, name: p.name.trim(), location: p.location.trim(), description: p.description.trim(), interests: p.interests, radiusKm: p.radiusKm, transcriptionConsent: p.transcriptionConsent };
  response.json(session.profile);
});
app.get('/api/dev/group', (request, response) => {
  const session = readDevSession(request.headers.cookie);
  if (!session) { response.sendStatus(401); return; }
  response.json(devGroup(session));
});
app.post('/api/dev/queue', async (request, response) => {
  const session = readDevSession(request.headers.cookie);
  if (!session) { response.sendStatus(401); return; }
  const { latitude, longitude } = request.body ?? {};
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    response.status(400).json({ error: 'Valid coordinates are required to find nearby members.' });
    return;
  }
  try {
    response.json(await joinDevQueue(session, { latitude, longitude }));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Could not join the queue.' });
  }
});
app.get('/api/dev/queue', async (request, response) => {
  const session = readDevSession(request.headers.cookie);
  if (!session) { response.sendStatus(401); return; }
  response.setHeader('Cache-Control', 'no-store');
  response.json(await getDevQueueState(session));
});
app.delete('/api/dev/queue', (request, response) => {
  const session = readDevSession(request.headers.cookie);
  if (!session) { response.sendStatus(401); return; }
  response.json({ left: leaveDevQueue(session) });
});
app.post('/api/dev/group/leave', (request, response) => {
  const session = readDevSession(request.headers.cookie);
  if (!session) { response.sendStatus(401); return; }
  response.json({ left: leaveDevGroup(session) });
});
app.post('/api/livekit/token', (request, response) => {
  void tokenHandler(request, response);
});

const port = Number(process.env.API_PORT ?? 3002);
app.listen(port, '127.0.0.1', (error?: Error) => {
  if (error) {
    console.error(`Could not start API on port ${port}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Local API listening on http://127.0.0.1:${port}`);
});
