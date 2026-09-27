import type { AppServices, AuthSession } from '../../../../packages/shared/src/auth';
import { createHttpProfileService } from './profile-service';

export async function localRequest<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/dev/${path}`, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers } });
  const result = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof result?.error === 'string' ? result.error : 'The local API request failed. Make sure npm run dev is running.');
  }
  return result as T;
}
export function createLocalServices(): AppServices {
  const listeners = new Set<(session: AuthSession | null) => void>();
  return {
    auth: {
      mode: 'demo', requiresPassword: false,
      getSession: () => localRequest<AuthSession | null>('session'),
      async authenticate({ email }) {
        const session = await localRequest<AuthSession>('session', { method: 'POST', body: JSON.stringify({ email }) });
        listeners.forEach(listener => listener(session));
        return { status: 'authenticated', session };
      },
      async signOut() { await localRequest('session', { method: 'DELETE' }); listeners.forEach(listener => listener(null)); },
      onSessionChange(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    },
    profiles: createHttpProfileService({ endpoint: '/api/dev/profile' }),
  };
}
