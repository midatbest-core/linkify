import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createTestAuth } from './testAuth.js';

function createMemoryLinkModel() {
  const records = new Map();
  const byId = new Map();
  let lastAggregate;
  function matches(item, filter) {
    if (filter.$and && !filter.$and.every((part) => matches(item, part))) return false;
    if (filter.$or && !filter.$or.some((part) => matches(item, part))) return false;
    for (const [key, condition] of Object.entries(filter)) {
      if (key.startsWith('$')) continue;
      if (key === 'status' && condition && typeof condition === 'object' && '$exists' in condition) {
        if ((item.status !== undefined) !== condition.$exists) return false;
      } else if (condition?.$regex) {
        if (!new RegExp(condition.$regex, condition.$options).test(String(item[key] ?? ''))) return false;
      } else if (key === 'tags') {
        if (!item.tags?.includes(condition)) return false;
      } else if ((item[key] ?? (key === 'status' ? 'active' : undefined)) !== condition) return false;
    }
    return true;
  }
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
    find(filter = {}) {
      const matched = [...records.values()].filter((item) => matches(item, filter));
      const query = { sort: () => query, skip: (amount) => { query.offset = amount; return query; }, limit: async (limit = 5) => matched.reverse().slice(query.offset ?? 0, (query.offset ?? 0) + limit) };
      return query;
    },
    async countDocuments(filter = {}) { return [...records.values()].filter((item) => matches(item, filter)).length; },
    async aggregate(pipeline) {
      lastAggregate = pipeline;
      const facet = pipeline.at(-1).$facet;
      const page = facet.links.find((stage) => '$skip' in stage).$skip;
      const limit = facet.links.find((stage) => '$limit' in stage).$limit;
      const rows = [...records.values()].slice(page, page + limit).map((item) => ({ ...item, clickCount: 0 }));
      return [{ links: rows, metadata: [{ total: records.size }] }];
    },
    get lastAggregate() { return lastAggregate; },
    async findById(id) { return byId.get(String(id)) ?? null; },
    async findByIdAndUpdate(id, update) {
      const record = byId.get(String(id));
      if (!record) return null;
      Object.assign(record, update.$set, { updatedAt: new Date() });
      return record;
    },
    async findByIdAndDelete(id) {
      const record = byId.get(String(id));
      if (record) { byId.delete(String(id)); records.delete(record.shortCode); }
      return record ?? null;
    },
  };
}

function createMemoryClickEventModel({ fail = false } = {}) {
  const records = [];
  return {
    records,
    collection: { name: 'clickEvents' },
    async create(event) {
      if (fail) throw new Error('simulated analytics database failure');
      const saved = { ...event, clickedAt: event.clickedAt ?? new Date() };
      records.push(saved);
      return saved;
    },
    async deleteMany({ linkId }) {
      const before = records.length;
      for (let index = records.length - 1; index >= 0; index -= 1) if (String(records[index].linkId) === String(linkId)) records.splice(index, 1);
      return { deletedCount: before - records.length };
    },
    async aggregate(pipeline) {
      if (pipeline[0]?.$match?.linkId) return [{ totals: [{ totalClicks: records.length, clicksToday: records.length, clicksLast7Days: records.length, clicksLast30Days: records.length }], selectedTotal: [{ count: records.length }], daily: [], devices: [], browsers: [], operatingSystems: [], referrers: [], bots: [] }];
      return [{ totals: [{ count: records.length }], daily: [], devices: [], referrers: [], topLinks: [] }];
    },
  };
}

let server;
let baseUrl;
let model;
let clickEvents;
let auth;
let adminFetch;

before(async () => {
  model = createMemoryLinkModel();
  clickEvents = createMemoryClickEventModel();
  auth = createTestAuth();
  server = createApp({ linkModel: model, clickEventModel: clickEvents, ...auth }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminFetch = auth.fetch(baseUrl, await auth.login(baseUrl));
});

after(() => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

test('creates a link with a random short code', async () => {
  const response = await adminFetch(`${baseUrl}/api/links`, {
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
    const response = await adminFetch(`${baseUrl}/api/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ originalUrl }),
    });
    assert.equal(response.status, 400, originalUrl);
  }
});

test('creates a valid custom alias and reports alias availability', async () => {
  const response = await adminFetch(`${baseUrl}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ originalUrl: 'https://example.org', customAlias: 'Spring-Sale' }),
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.shortCode, 'spring-sale');
  const availability = await adminFetch(`${baseUrl}/api/aliases/spring-sale/availability`);
  assert.deepEqual(await availability.json(), { alias: 'spring-sale', available: false, suggestions: ['spring-sale-26', 'get-spring-sale', 'spring-sale-link', 'use-spring-sale', 'spring-sale-2'] });
});

test('handles duplicate aliases with database-checked alternatives', async () => {
  const response = await adminFetch(`${baseUrl}/api/links`, {
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
  const list = await adminFetch(`${baseUrl}/api/links`);
  const body = await list.json();
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(body.links));
  assert.ok(body.links.some((link) => link.id === created.id));

  const detail = await adminFetch(`${baseUrl}/api/links/${created.id}`);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).link.shortCode, created.shortCode);
  const page = await adminFetch(`${baseUrl}/api/links?status=active&page=1&limit=1`);
  const pageBody = await page.json();
  assert.equal(page.status, 200);
  assert.equal(pageBody.links.length, 1);
  assert.ok(pageBody.pagination.total >= 1);
  assert.equal(pageBody.pagination.limit, 1);
});

test('returns consistent missing and invalid ID errors', async () => {
  const invalid = await adminFetch(`${baseUrl}/api/links/not-an-id`);
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'Invalid link ID.' });
  const missing = await adminFetch(`${baseUrl}/api/links/ffffffffffffffffffffffff`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Link not found.' });
});

test('deletes only the requested link and reports a nonexistent ID', async () => {
  const target = [...model.records.values()].find((record) => record.shortCode === 'spring-sale');
  const unrelated = [...model.records.keys()].filter((code) => code !== target.shortCode);
  const response = await adminFetch(`${baseUrl}/api/links/${target.id}`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: 'Link deleted.', id: target.id });
  assert.equal(model.records.has(target.shortCode), false);
  assert.ok(clickEvents.records.every((event) => String(event.linkId) !== target.id));
  assert.ok(unrelated.every((code) => model.records.has(code)));

  const missing = await adminFetch(`${baseUrl}/api/links/${target.id}`, { method: 'DELETE' });
  assert.equal(missing.status, 404);
});

test('edits link metadata, searches and filters links, and archives/restores redirects', async () => {
  const response = await adminFetch(`${baseUrl}/api/links`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ originalUrl: 'https://example.org/promo', customAlias: 'promo-page', title: 'Spring promotion', tags: ['sale', 'spring'] }),
  });
  const created = await response.json();
  const changed = await adminFetch(`${baseUrl}/api/links/${created.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ originalUrl: 'https://example.org/new', title: 'Updated promotion', tags: ['sale', 'new'] }),
  });
  assert.equal(changed.status, 200);
  const updated = (await changed.json()).link;
  assert.equal(updated.shortCode, 'promo-page');
  assert.equal(updated.originalUrl, 'https://example.org/new');
  assert.equal(updated.title, 'Updated promotion');
  assert.deepEqual(updated.tags, ['sale', 'new']);

  const searched = await adminFetch(`${baseUrl}/api/links?q=updated%20promotion&tag=new&status=active`);
  assert.ok((await searched.json()).links.some((item) => item.id === created.id));
  const byClickCount = await adminFetch(`${baseUrl}/api/links?sort=clicks&order=desc`);
  const clickSorted = await byClickCount.json();
  assert.equal(byClickCount.status, 200);
  assert.ok(clickSorted.links.every((item) => Number.isInteger(item.clickCount)));
  assert.deepEqual(model.lastAggregate[0].$match, {});

  const archived = await adminFetch(`${baseUrl}/api/links/${created.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'archived' }) });
  assert.equal((await archived.json()).link.status, 'archived');
  const gone = await fetch(`${baseUrl}/promo-page`, { redirect: 'manual' });
  assert.equal(gone.status, 410);
  const archivedFilter = await adminFetch(`${baseUrl}/api/links?status=archived`);
  assert.ok((await archivedFilter.json()).links.some((item) => item.id === created.id));

  const restored = await adminFetch(`${baseUrl}/api/links/${created.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'active' }) });
  assert.equal((await restored.json()).link.status, 'active');
  const redirect = await fetch(`${baseUrl}/promo-page`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://example.org/new');
});

test('link creation appends UTM values without replacing existing values or fragments', async () => {
  const response = await adminFetch(`${baseUrl}/api/links`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ originalUrl: 'https://example.org/path?utm_source=existing&x=1#section', customAlias: 'utm-example', utm: { utm_source: 'new-source', utm_medium: 'email & social' } }),
  });
  const data = await response.json();
  const destination = new URL(data.originalUrl);
  assert.equal(response.status, 201);
  assert.equal(destination.searchParams.get('utm_source'), 'existing');
  assert.equal(destination.searchParams.get('utm_medium'), 'email & social');
  assert.equal(destination.searchParams.get('x'), '1');
  assert.equal(destination.hash, '#section');
  assert.deepEqual(data.utmConflicts, ['utm_source']);
});
