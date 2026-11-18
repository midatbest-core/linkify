import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

function createMemoryLinkModel() {
  const records = new Map();
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
      const saved = { ...record, _id: String(records.size + 1), id: String(records.size + 1), createdAt: new Date() };
      records.set(record.shortCode, saved);
      return saved;
    },
    async findOne({ shortCode }) {
      return records.get(shortCode) ?? null;
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
