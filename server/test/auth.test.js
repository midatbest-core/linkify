import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { test } from 'node:test';
import { createAdminAuth } from '../src/middleware/adminAuth.js';
import { isValidAdminPasswordHash } from '../src/middleware/adminAuth.js';
import AdminSession from '../src/models/AdminSession.js';
import { createTestAuth } from './testAuth.js';

test('production admin cookies are HttpOnly, Secure, SameSite=Lax, and expire after eight hours', async () => {
  const fixture = createTestAuth();
  const auth = createAdminAuth({ ...fixture, username: fixture.adminUsername, passwordHash: fixture.adminPasswordHash, production: true });
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; },
    status(code) { this.statusCode = code; return this; },
  };
  let failure;
  await auth.login({ body: { username: fixture.adminUsername, password: 'test-password' } }, response, (error) => { failure = error; });
  assert.equal(failure, undefined);
  assert.equal(response.statusCode, undefined);
  assert.match(response.headers['Set-Cookie'], /HttpOnly/);
  assert.match(response.headers['Set-Cookie'], /Secure/);
  assert.match(response.headers['Set-Cookie'], /SameSite=Lax/);
  assert.match(response.headers['Set-Cookie'], /Max-Age=28800/);
});

test('admin password configuration requires a full-length scrypt hash', () => {
  const fixture = createTestAuth();
  assert.equal(isValidAdminPasswordHash(fixture.adminPasswordHash), true);
  assert.equal(isValidAdminPasswordHash('plaintext-password'), false);
  assert.equal(isValidAdminPasswordHash('scrypt$c2FsdA$AA'), false);
});

test('session records expire in Mongo and credential rotation rejects existing sessions', async () => {
  assert.ok(AdminSession.schema.indexes().some(([keys, options]) => keys.expiresAt === 1 && options.expireAfterSeconds === 0));
  const fixture = createTestAuth();
  const oldAuth = createAdminAuth({ ...fixture, username: fixture.adminUsername, passwordHash: fixture.adminPasswordHash });
  const loginResponse = {
    headers: {}, setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; }, status(code) { this.statusCode = code; return this; },
  };
  await oldAuth.login({ body: { username: fixture.adminUsername, password: 'test-password' } }, loginResponse, (error) => { throw error; });
  const oldCookie = loginResponse.headers['Set-Cookie'].split(';')[0];
  const salt = Buffer.from('rotated-password-salt');
  const newHash = `scrypt$${salt.toString('base64url')}$${scryptSync('new-test-password', salt, 64).toString('base64url')}`;
  const newAuth = createAdminAuth({ sessionModel: fixture.sessionModel, username: fixture.adminUsername, passwordHash: newHash });
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let authorized = false;
  await newAuth.requireAdmin({ headers: { cookie: oldCookie } }, response, () => { authorized = true; });
  assert.equal(authorized, false);
  assert.equal(response.statusCode, 401);
});

test('logout reports storage failures without clearing the cookie or claiming invalidation', async () => {
  const fixture = createTestAuth();
  const storageError = new Error('session store unavailable');
  const auth = createAdminAuth({
    ...fixture,
    username: fixture.adminUsername,
    passwordHash: fixture.adminPasswordHash,
    sessionModel: { async deleteOne() { throw storageError; } },
  });
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; },
    status(code) { this.statusCode = code; return this; },
  };
  let failure;
  await auth.logout({ headers: { cookie: 'linkify_admin=active-session' } }, response, (error) => { failure = error; });
  assert.equal(failure, storageError);
  assert.equal(response.headers['Set-Cookie'], undefined);
  assert.equal(response.body, undefined);
});
