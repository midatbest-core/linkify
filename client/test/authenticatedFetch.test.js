import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authenticatedFetch, invalidateSession } from '../src/utils/authenticatedFetch.js';

test('logout rejects server and network failures and only accepts success or an expired session', async (t) => {
  const events = [];
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503 }));
  const previousWindow = globalThis.window;
  globalThis.window = { dispatchEvent: (event) => events.push(event.type) };
  t.after(() => { globalThis.window = previousWindow; });
  await assert.rejects(invalidateSession('/logout'));
  assert.deepEqual(events, []);
  globalThis.fetch.mock.mockImplementation(async () => { throw new Error('offline'); });
  await assert.rejects(invalidateSession('/logout'), /offline/);
  globalThis.fetch.mock.mockImplementation(async () => new Response('{}', { status: 401 }));
  assert.equal(await invalidateSession('/logout'), 'expired');
  assert.deepEqual(events, ['linkify:unauthorized']);
  events.length = 0;
  await authenticatedFetch('/api/links/example/simulate', { method: 'POST' });
  assert.deepEqual(events, ['linkify:unauthorized']);
  globalThis.fetch.mock.mockImplementation(async () => new Response('{}'));
  assert.equal(await invalidateSession('/logout'), 'invalidated');
});
