import { scryptSync } from 'node:crypto';

const username = 'test-admin';
const password = 'test-password';
const salt = Buffer.from('linkify-test-salt');
const digest = scryptSync(password, salt, 64).toString('base64url');
const passwordHash = `scrypt$${salt.toString('base64url')}$${digest}`;

export function createTestAuth() {
  const sessions = [];
  const sessionModel = {
    async create(session) { sessions.push(session); return session; },
    async findOne(filter) { return sessions.find((session) => session.tokenHash === filter.tokenHash && session.credentialVersion === filter.credentialVersion && session.expiresAt > filter.expiresAt.$gt) ?? null; },
    async deleteOne(filter) { const index = sessions.findIndex((session) => session.tokenHash === filter.tokenHash); if (index >= 0) sessions.splice(index, 1); return { deletedCount: index >= 0 ? 1 : 0 }; },
  };
  return {
    sessionModel, adminUsername: username, adminPasswordHash: passwordHash, clientOrigin: 'http://localhost:5174', sessions,
    async login(baseUrl, cookie) {
      const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { origin: 'http://localhost:5174', ...(cookie ? { cookie } : {}), 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
      if (!response.ok) throw new Error(`Test admin login failed (${response.status}).`);
      return response.headers.get('set-cookie').split(';')[0];
    },
    fetch(baseUrl, cookie) {
      return (url, options = {}) => fetch(url.startsWith('http') ? url : `${baseUrl}${url.startsWith('/') ? url : `/${url}`}`, {
        ...options,
        headers: { ...(options.headers ?? {}), origin: 'http://localhost:5174', cookie, ...(options.body ? { 'content-type': 'application/json' } : {}) },
      });
    },
  };
}
