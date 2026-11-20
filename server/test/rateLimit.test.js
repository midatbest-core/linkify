import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createTestAuth } from './testAuth.js';

const auth = createTestAuth();
let server;
let baseUrl;

before(async () => {
  server = createApp({ ...auth }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

test('login rate limiter rejects requests after the configured attempt limit', async () => {
  const responses = [];
  for (let attempt = 0; attempt < 11; attempt += 1) {
    responses.push(await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { origin: 'http://localhost:5174', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'test-admin', password: 'incorrect' }),
    }));
  }
  assert.ok(responses.slice(0, 10).every((response) => response.status === 401));
  assert.equal(responses[10].status, 429);
});
