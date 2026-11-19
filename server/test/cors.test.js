import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { isCanonicalHttpsOrigin } from '../src/utils/httpOrigin.js';
import { createTestAuth } from './testAuth.js';

const productionOrigin = 'https://linkify-3jnh.vercel.app';

let server;
let baseUrl;

before(async () => {
  server = createApp({ ...createTestAuth(), clientOrigin: productionOrigin, production: true }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

test('allows credentialed session requests from the exact production Vercel origin', async () => {
  const response = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Origin: productionOrigin },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), productionOrigin);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
});

test('does not expose credentialed session responses to a foreign origin', async () => {
  const response = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Origin: 'https://attacker.example' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
});

test('allows login preflight from the exact production origin and denies foreign origins', async () => {
  const allowed = await fetch(`${baseUrl}/api/auth/login`, { method: 'OPTIONS', headers: { origin: productionOrigin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), productionOrigin);
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
  assert.match(allowed.headers.get('access-control-allow-methods'), /POST/);
  const denied = await fetch(`${baseUrl}/api/auth/login`, { method: 'OPTIONS', headers: { origin: 'https://attacker.example', 'access-control-request-method': 'POST' } });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  assert.equal(denied.headers.get('access-control-allow-credentials'), null);
});

test('CORS headers are present on early authentication rejections', async () => {
  const response = await fetch(`${baseUrl}/api/links`, { headers: { origin: productionOrigin } });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('access-control-allow-origin'), productionOrigin);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
});

test('production frontend origin validation requires an exact canonical HTTPS origin', () => {
  assert.equal(isCanonicalHttpsOrigin(productionOrigin), true);
  assert.equal(isCanonicalHttpsOrigin(`${productionOrigin}/`), false);
  assert.equal(isCanonicalHttpsOrigin(`${productionOrigin}/dashboard`), false);
  assert.equal(isCanonicalHttpsOrigin('http://linkify-3jnh.vercel.app'), false);
  assert.equal(isCanonicalHttpsOrigin('not an origin'), false);
});
