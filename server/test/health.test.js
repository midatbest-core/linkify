import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import app from '../src/app.js';

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

test('health endpoint reports that the database is not connected', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.deepEqual(body, { status: 'unavailable', database: 'disconnected' });
});
