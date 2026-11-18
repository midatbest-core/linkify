import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

function createMemoryLinkModel() {
  const records = new Map();
  const byId = new Map();
  return {
    records,
    async exists({ shortCode }) {
      return records.has(shortCode) ? { _id: shortCode } : null;
    },
    async create(record) {
      if (records.has(record.shortCode)) {
        const error = new Error('Duplicate short code');
        error.code = 11000;
        throw error;
      }
      const id = `${String(records.size + 1).padStart(24, '0')}`;
      const saved = { ...record, _id: id, id, createdAt: new Date() };
      records.set(record.shortCode, saved);
      byId.set(id, saved);
      return saved;
    },
    async findOne({ shortCode }) {
      return records.get(shortCode) ?? null;
    },
    find() { return { sort: async () => [...records.values()].reverse() }; },
    async findById(id) { return byId.get(String(id)) ?? null; },
    async findByIdAndDelete(id) {
      const record = byId.get(String(id));
      if (record) { byId.delete(String(id)); records.delete(record.shortCode); }
      return record ?? null;
    },
  };
}

let server;
let baseUrl;
let model;

before(async () => {
  model = createMemoryLinkModel();
  server = createApp({ linkModel: model }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

test('creates a link with a random short code', async () => {
  const response = await fetch(`${baseUrl}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ originalUrl: 'https://example.com/a/long/path?from=test' }),
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.match(body.shortCode, /^[0-9a-zA-Z]{7}$/);
  assert.equal(body.shortUrl, `${baseUrl}/${body.shortCode}`);
  assert.equal(model.records.get(body.shortCode).originalUrl, 'https://example.com/a/long/path?from=test');
});

test('rejects invalid and unsupported destination URLs', async () => {
  for (const originalUrl of ['not a url', 'javascript:alert(1)', 'ftp://example.com/file']) {
    const response = await fetch(`${baseUrl}/api/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ originalUrl }),
    });
    assert.equal(response.status, 400, originalUrl);
  }
});

test('creates a valid custom alias and reports alias availability', async () => {
  const response = await fetch(`${baseUrl}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ originalUrl: 'https://example.org', customAlias: 'Spring-Sale' }),
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.shortCode, 'spring-sale');
  const availability = await fetch(`${baseUrl}/api/aliases/spring-sale/availability`);
  assert.deepEqual(await availability.json(), { alias: 'spring-sale', available: false, suggestions: ['spring-sale-26', 'get-spring-sale', 'spring-sale-link', 'use-spring-sale', 'spring-sale-2'] });
});

test('handles duplicate aliases with database-checked alternatives', async () => {
  const response = await fetch(`${baseUrl}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ originalUrl: 'https://example.net', customAlias: 'spring-sale' }),
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.alias, 'spring-sale');
  assert.equal(body.suggestions.length, 5);
  assert.ok(body.suggestions.every((alias) => !model.records.has(alias)));
});

test('redirects saved codes and returns 404 for unknown codes', async () => {
  const code = [...model.records.keys()].find((value) => value === 'spring-sale');
  const redirect = await fetch(`${baseUrl}/${code}`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://example.org/');

  const missing = await fetch(`${baseUrl}/unknown-code`, { redirect: 'manual' });
  assert.equal(missing.status, 404);
});

test('lists links and retrieves one link by ID', async () => {
  const created = [...model.records.values()][0];
  const list = await fetch(`${baseUrl}/api/links`);
  const body = await list.json();
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(body.links));
  assert.ok(body.links.some((link) => link.id === created.id));

  const detail = await fetch(`${baseUrl}/api/links/${created.id}`);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).link.shortCode, created.shortCode);
});

test('returns consistent missing and invalid ID errors', async () => {
  const invalid = await fetch(`${baseUrl}/api/links/not-an-id`);
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'Invalid link ID.' });
  const missing = await fetch(`${baseUrl}/api/links/ffffffffffffffffffffffff`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Link not found.' });
});

test('deletes only the requested link and reports a nonexistent ID', async () => {
  const target = [...model.records.values()].find((record) => record.shortCode === 'spring-sale');
  const unrelated = [...model.records.keys()].filter((code) => code !== target.shortCode);
  const response = await fetch(`${baseUrl}/api/links/${target.id}`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: 'Link deleted.', id: target.id });
  assert.equal(model.records.has(target.shortCode), false);
  assert.ok(unrelated.every((code) => model.records.has(code)));

  const missing = await fetch(`${baseUrl}/api/links/${target.id}`, { method: 'DELETE' });
  assert.equal(missing.status, 404);
});
