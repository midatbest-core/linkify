import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

let server;
let baseUrl;

before(async () => {
  server = createApp({ clientOrigin: 'http://localhost:5174' }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

test('allows requests from the configured Vite origin', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'http://localhost:5174' },
  });
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5174');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
});

test('does not allow an unconfigured origin', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'http://localhost:5173' },
  });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
});

test('credentialed management preflight is limited to the configured origin', async () => {
  const allowed = await fetch(`${baseUrl}/api/links/example`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5174', 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'content-type' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5174');
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
  assert.match(allowed.headers.get('access-control-allow-methods'), /PATCH/);
  const denied = await fetch(`${baseUrl}/api/links/example`, { method: 'OPTIONS', headers: { origin: 'https://attacker.example', 'access-control-request-method': 'PATCH' } });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  assert.equal(denied.headers.get('access-control-allow-credentials'), null);
});
