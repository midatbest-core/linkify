import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { normalizeAdaptiveRouting, resolveAdaptiveDestination } from '../src/services/adaptiveRoutingService.js';
import { createLinkService } from '../src/services/linkService.js';
import Link from '../src/models/Link.js';
import { createTestAuth } from './testAuth.js';

const routing = {
  enabled: true,
  defaultDestinationUrl: 'https://example.com/default',
  rules: [
    { ruleId: 'mobile-first', deviceType: 'mobile', destinationUrl: 'https://example.com/mobile', enabled: true },
    { ruleId: 'mobile-second', deviceType: 'mobile', destinationUrl: 'https://example.com/second', enabled: true },
    { ruleId: 'desktop', deviceType: 'desktop', destinationUrl: 'https://example.com/desktop', enabled: true },
    { ruleId: 'tablet-disabled', deviceType: 'tablet', destinationUrl: 'https://example.com/tablet', enabled: false },
  ],
};

test('adaptive rules use priority order and fallback for unknown, unmatched, disabled and malformed configurations', () => {
  const link = { originalUrl: 'https://example.com/default', adaptiveRouting: normalizeAdaptiveRouting(routing).value };
  const mobileRule = link.adaptiveRouting.rules.find((rule) => rule.ruleId === 'mobile-first');
  assert.deepEqual(resolveAdaptiveDestination(link, 'mobile'), { destinationUrl: 'https://example.com/mobile', selectedDestinationId: mobileRule.destinationId, matchedRuleId: 'mobile-first', usedFallback: false });
  assert.equal(resolveAdaptiveDestination(link, 'desktop').destinationUrl, 'https://example.com/desktop');
  assert.equal(resolveAdaptiveDestination(link, 'tablet').usedFallback, true);
  assert.equal(resolveAdaptiveDestination(link, 'unknown').selectedDestinationId, link.adaptiveRouting.defaultDestinationId);
  assert.equal(resolveAdaptiveDestination({ originalUrl: 'https://legacy.example' }, 'mobile').destinationUrl, 'https://legacy.example');
  const invalidStored = { originalUrl: 'https://safe.example', adaptiveRouting: { enabled: true, defaultDestinationUrl: 'javascript:alert(1)', rules: [{ ruleId: 'bad', enabled: true, deviceType: 'mobile', destinationUrl: 'data:text/html,no' }] } };
  assert.equal(resolveAdaptiveDestination(invalidStored, 'mobile').destinationUrl, 'https://safe.example');
});

test('configuration validates protocols, device types, unique IDs and reorders priorities from array order', () => {
  assert.match(normalizeAdaptiveRouting({ ...routing, rules: [{ ...routing.rules[0], destinationUrl: 'javascript:alert(1)' }] }).error, /HTTP and HTTPS/);
  assert.match(normalizeAdaptiveRouting({ ...routing, rules: [{ ...routing.rules[0], deviceType: 'phone' }] }).error, /mobile, desktop, or tablet/);
  assert.match(normalizeAdaptiveRouting({ ...routing, rules: [routing.rules[0], routing.rules[0]] }).error, /unique/);
  const normalized = normalizeAdaptiveRouting({ ...routing, rules: [routing.rules[2], routing.rules[0]] }).value;
  assert.deepEqual(normalized.rules.map((rule) => rule.priority), [0, 1]);
  const cleaned = normalizeAdaptiveRouting(routing, { previousRouting: { destinations: [
    { destinationId: 'stable-id', ownerId: 'mobile-first', destinationUrl: 'https://example.com/mobile' },
    { destinationId: 'stable-id', ownerId: 'desktop', destinationUrl: 'https://example.com/desktop' },
    { destinationId: 'bad-url', ownerId: 'desktop', destinationUrl: 'javascript:alert(1)' },
  ] } }).value;
  assert.equal(new Set(cleaned.destinations.map((entry) => entry.destinationId)).size, cleaned.destinations.length);
  assert.ok(cleaned.destinations.every((entry) => !entry.destinationUrl.startsWith('javascript:')));
});

test('Mongoose casts and validates adaptive routing with nested rule and destination history IDs', () => {
  const adaptiveRouting = normalizeAdaptiveRouting(routing).value;
  const document = new Link({ originalUrl: adaptiveRouting.defaultDestinationUrl, shortCode: 'schema-check', adaptiveRouting });
  assert.equal(document.validateSync(), undefined);
  assert.equal(document.adaptiveRouting.rules[0].ruleId, adaptiveRouting.rules[0].ruleId);
  assert.equal(document.adaptiveRouting.rules[0].destinationId, adaptiveRouting.rules[0].destinationId);
  assert.equal(document.adaptiveRouting.destinations[0].destinationId, adaptiveRouting.defaultDestinationId);
});

function memoryModels() {
  const links = new Map();
  const ids = new Map();
  const events = [];
  let holdAnalyticsWrite = false;
  const linkModel = {
    async exists({ shortCode }) { return links.has(shortCode) ? { _id: '000000000000000000000001' } : null; },
    async create(record) { const saved = { ...record, id: '000000000000000000000001', _id: '000000000000000000000001' }; links.set(record.shortCode, saved); ids.set(saved.id, saved); return saved; },
    async findOne({ shortCode }) { return links.get(shortCode) ?? null; },
    async findById(id) { return ids.get(String(id)) ?? null; },
    async findByIdAndUpdate(id, update) { const saved = ids.get(String(id)); if (!saved) return null; Object.assign(saved, update.$set); return saved; },
    async findByIdAndDelete(id) { const saved = ids.get(String(id)); if (!saved) return null; ids.delete(String(id)); links.delete(saved.shortCode); return saved; },
  };
  const clickEventModel = { async create(event) { if (holdAnalyticsWrite) return new Promise(() => {}); events.push(event); return event; }, async deleteMany({ linkId }) { const before = events.length; for (let index = events.length - 1; index >= 0; index -= 1) if (String(events[index].linkId) === String(linkId)) events.splice(index, 1); return { deletedCount: before - events.length }; }, collection: { name: 'clickEvents' } };
  return { linkModel, clickEventModel, links, events, holdAnalyticsWrite: (value) => { holdAnalyticsWrite = value; } };
}

let server;
let api;
let fixture;
let models;
let cookie;

before(async () => {
  models = memoryModels();
  fixture = createTestAuth();
  server = createApp({ ...models, ...fixture }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  api = `http://127.0.0.1:${server.address().port}`;
  cookie = await fixture.login(api);
});

after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

test('authenticated API creates, retrieves, updates, reorders, disables and deletes adaptive links', async () => {
  const unauthorized = await fetch(`${api}/api/links`, { method: 'POST', headers: { origin: 'http://localhost:5174', 'content-type': 'application/json' }, body: JSON.stringify({ originalUrl: routing.defaultDestinationUrl, adaptiveRouting: routing }) });
  assert.equal(unauthorized.status, 401);

  const create = await fetch(`${api}/api/links`, { method: 'POST', headers: { cookie, origin: 'http://localhost:5174', 'content-type': 'application/json' }, body: JSON.stringify({ originalUrl: routing.defaultDestinationUrl, customAlias: 'adaptive-link', adaptiveRouting: routing }) });
  assert.equal(create.status, 201);
  const created = await create.json();
  assert.equal(created.adaptiveRouting.enabled, true);
  assert.deepEqual(created.adaptiveRouting.rules.map((rule) => rule.priority), [0, 1, 2, 3]);

  const configOnlyCreate = await fetch(`${api}/api/links`, { method: 'POST', headers: { cookie, origin: 'http://localhost:5174', 'content-type': 'application/json' }, body: JSON.stringify({ customAlias: 'adaptive-config', adaptiveRouting: routing }) });
  assert.equal(configOnlyCreate.status, 201);
  const configOnlyCreated = await configOnlyCreate.json();
  assert.equal(configOnlyCreated.originalUrl, 'https://example.com/default');

  const changedRouting = { ...routing, rules: [...routing.rules].reverse() };
  const update = await fetch(`${api}/api/links/${created.id}`, { method: 'PATCH', headers: { cookie, origin: 'http://localhost:5174', 'content-type': 'application/json' }, body: JSON.stringify({ adaptiveRouting: changedRouting }) });
  assert.equal(update.status, 200);
  const changed = (await update.json()).link;
  assert.equal(changed.adaptiveRouting.rules[0].ruleId, 'tablet-disabled');
  assert.equal(changed.adaptiveRouting.rules[0].priority, 0);
  const retrieve = await fetch(`${api}/api/links/${created.id}`, { headers: { cookie, origin: 'http://localhost:5174' } });
  assert.equal(retrieve.status, 200);
  assert.deepEqual((await retrieve.json()).link.adaptiveRouting.rules.map((rule) => rule.priority), [0, 1, 2, 3]);

  const removed = await fetch(`${api}/api/links/${created.id}`, { method: 'PATCH', headers: { cookie, origin: 'http://localhost:5174', 'content-type': 'application/json' }, body: JSON.stringify({ adaptiveRouting: { ...changedRouting, rules: changedRouting.rules.filter((rule) => rule.ruleId !== 'mobile-first') } }) });
  const removedLink = (await removed.json()).link;
  assert.equal(removedLink.adaptiveRouting.rules.some((rule) => rule.ruleId === 'mobile-first'), false);
  assert.ok(removedLink.adaptiveRouting.destinations.some((entry) => entry.ownerId === 'mobile-first' && entry.destinationUrl === 'https://example.com/mobile'));

  const editedRouting = { ...changedRouting, rules: changedRouting.rules.map((rule) => rule.ruleId === 'desktop' ? { ...rule, destinationUrl: 'https://example.com/desktop-v2' } : rule) };
  const edit = await fetch(`${api}/api/links/${created.id}`, { method: 'PATCH', headers: { cookie, origin: 'http://localhost:5174', 'content-type': 'application/json' }, body: JSON.stringify({ adaptiveRouting: editedRouting }) });
  assert.equal(edit.status, 200);
  const edited = (await edit.json()).link.adaptiveRouting;
  const oldDesktop = removedLink.adaptiveRouting.rules.find((rule) => rule.ruleId === 'desktop');
  const newDesktop = edited.rules.find((rule) => rule.ruleId === 'desktop');
  assert.equal(newDesktop.ruleId, oldDesktop.ruleId);
  assert.notEqual(newDesktop.destinationId, oldDesktop.destinationId);
  assert.ok(edited.destinations.some((entry) => entry.destinationId === oldDesktop.destinationId && entry.destinationUrl === 'https://example.com/desktop'));
  assert.ok(edited.destinations.some((entry) => entry.destinationId === newDesktop.destinationId && entry.destinationUrl === 'https://example.com/desktop-v2'));

  const disable = await fetch(`${api}/api/links/${created.id}`, { method: 'PATCH', headers: { cookie, origin: 'http://localhost:5174', 'content-type': 'application/json' }, body: JSON.stringify({ adaptiveRouting: { ...changedRouting, enabled: false } }) });
  assert.equal((await disable.json()).link.adaptiveRouting.enabled, false);
  const deletion = await fetch(`${api}/api/links/${configOnlyCreated.id}`, { method: 'DELETE', headers: { cookie, origin: 'http://localhost:5174' } });
  assert.equal(deletion.status, 200);
  assert.equal((await fetch(`${api}/adaptive-config`, { redirect: 'manual' })).status, 404);
});

test('redirects choose UA-derived device destinations and record exactly one attribution event', async () => {
  const link = models.links.get('adaptive-link');
  link.adaptiveRouting = normalizeAdaptiveRouting({ ...routing, rules: routing.rules.map((rule) => rule.ruleId === 'tablet-disabled' ? { ...rule, enabled: true } : rule) }).value;
  const cases = [
    ['iPhone Mobile Safari', 'https://example.com/mobile', 'mobile-first', false],
    ['Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0', 'https://example.com/desktop', 'desktop', false],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', 'https://example.com/tablet', 'tablet-disabled', false],
    ['', 'https://example.com/default', 'default', true],
  ];
  for (const [userAgent, destination, matchedRuleId, usedFallback] of cases) {
    const beforeCount = models.events.length;
    const response = await fetch(`${api}/adaptive-link`, { headers: { 'user-agent': userAgent, 'x-device-type': 'desktop' }, redirect: 'manual' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), destination);
    assert.equal(models.events.length, beforeCount + 1);
    assert.equal(models.events.at(-1).matchedRuleId, matchedRuleId === 'default' ? null : matchedRuleId);
    const expectedDestinationId = matchedRuleId === 'default' ? link.adaptiveRouting.defaultDestinationId : link.adaptiveRouting.rules.find((rule) => rule.ruleId === matchedRuleId).destinationId;
    assert.equal(models.events.at(-1).selectedDestinationId, expectedDestinationId);
    assert.equal(models.events.at(-1).usedFallback, usedFallback);
    assert.equal(Object.hasOwn(models.events.at(-1), 'userAgent'), false);
  }

  link.adaptiveRouting.enabled = false;
  const disabled = await fetch(`${api}/adaptive-link`, { headers: { 'user-agent': 'iPhone Mobile Safari' }, redirect: 'manual' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(disabled.headers.get('location'), 'https://example.com/default');
  assert.equal(models.events.at(-1).selectedDestinationId, 'default');
});

test('redirect does not wait for a pending analytics database write', async () => {
  models.holdAnalyticsWrite(true);
  try {
    const response = await Promise.race([
      fetch(`${api}/adaptive-link`, { redirect: 'manual' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('redirect waited for analytics write')), 500)),
    ]);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://example.com/default');
  } finally {
    models.holdAnalyticsWrite(false);
  }
});

test('concurrent link edits use optimistic version checks and reject the stale writer', async () => {
  const record = { _id: 'link-1', __v: 0, originalUrl: 'https://example.com/old', title: '', tags: [], status: 'active' };
  let readers = 0;
  let releaseReaders;
  const bothRead = new Promise((resolve) => { releaseReaders = resolve; });
  const model = {
    async findById() { readers += 1; if (readers === 2) releaseReaders(); await bothRead; return { ...record }; },
    async findOneAndUpdate(filter, update) {
      if (filter.__v !== record.__v) return null;
      Object.assign(record, update.$set);
      record.__v += update.$inc.__v;
      return { ...record };
    },
  };
  const service = createLinkService(model);
  const outcomes = await Promise.allSettled([
    service.update('link-1', { title: 'first edit' }),
    service.update('link-1', { title: 'second edit' }),
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.status, 409);
  assert.match(rejected.reason.message, /changed while you were editing/);
});
