import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { test } from 'node:test';
import Link from '../src/models/Link.js';
import ClickEvent from '../src/models/ClickEvent.js';
import Flow from '../src/models/Flow.js';
import { createApp } from '../src/app.js';
import { createTestAuth } from './testAuth.js';
import { utcDateTimeToLocal } from '../src/utils/schedule.js';

const mongoUri = process.env.MONGODB_TEST_URI;
if (mongoUri) {
  const uri = new URL(mongoUri);
  if (uri.protocol !== 'mongodb:' || !['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname)) {
    throw new Error('MONGODB_TEST_URI must point to a local MongoDB server; remote databases are intentionally rejected.');
  }
}

test('isolated MongoDB persists adaptive links and event flows, evaluates routing, and protects concurrent updates', { skip: !mongoUri }, async (t) => {
  const databaseName = `linkify_phase2_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  await mongoose.connect(mongoUri, { dbName: databaseName });
  await Promise.all([Link.syncIndexes(), ClickEvent.syncIndexes(), Flow.syncIndexes()]);
  const auth = createTestAuth();
  const server = createApp({
    ...auth, linkModel: Link, flowModel: Flow, clickEventModel: ClickEvent,
    geoLocator: async () => ({ countryName: 'India', countryCode: 'IN', region: null, cityName: null }),
    logger: { error() {}, warn() {} },
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const cookie = await auth.login(baseUrl);
  const headers = { cookie, origin: 'http://localhost:5174', 'content-type': 'application/json' };
  const flowNodes = [
    { id: 'entry', position: { x: 0, y: 0 }, data: { kind: 'entry', label: 'Entry' } },
    { id: 'router', position: { x: 200, y: 0 }, data: { kind: 'router', label: 'Router' } },
    ...['before', 'during', 'after'].map((phase, index) => ({ id: phase, position: { x: 500, y: index * 100 }, data: { kind: 'destination', phase, label: phase, destinationUrl: `https://example.com/${phase}`, schedule: {} } })),
    { id: 'fallback', position: { x: 500, y: 400 }, data: { kind: 'fallback', label: 'Fallback', destinationUrl: 'https://example.com/fallback' } },
  ];
  const flowResponse = await fetch(`${baseUrl}/api/flows`, { method: 'POST', headers, body: JSON.stringify({ eventName: 'Mongo event', creatorTimeZone: 'Asia/Kolkata', eventStartLocal: '2026-12-01T09:00', eventEndLocal: '2026-12-01T17:00', graph: { nodes: flowNodes, edges: [{ id: 'entry-router', source: 'entry', target: 'router' }, ...flowNodes.slice(2).map((node) => ({ id: `router-${node.id}`, source: 'router', target: node.id }))] } }) });
  assert.equal(flowResponse.status, 201);
  const createdFlow = await flowResponse.json();
  const storedFlow = await Flow.findOne({ flowId: createdFlow.flow.id }).lean();
  assert.equal(storedFlow.creatorTimeZone, 'Asia/Kolkata');
  assert.equal(storedFlow.eventStartAtUtc.toISOString(), '2026-12-01T03:30:00.000Z');
  assert.equal(storedFlow.draft.presentation.nodes.find((node) => node.nodeId === 'during').position.x, 500);
  assert.equal(storedFlow.draft.routing.stages.find((stage) => stage.phase === 'during').destinationUrl, 'https://example.com/during');
  const now = Date.now();
  const payload = {
    customAlias: `phase2-${randomUUID().slice(0, 8)}`,
    originalUrl: 'https://example.com/default',
    adaptiveRouting: { enabled: true, defaultDestinationUrl: 'https://example.com/default', rules: [
      { ruleId: 'india-launch', deviceType: 'mobile', countryCode: 'IN', startAt: utcDateTimeToLocal(new Date(now - 120000), 'UTC'), endAt: utcDateTimeToLocal(new Date(now + 120000), 'UTC'), timeZone: 'UTC', campaign: { source: 'Launch', medium: 'email' }, destinationUrl: 'https://example.com/launch', enabled: true },
      { ruleId: 'india-fallback-rule', countryCode: 'IN', destinationUrl: 'https://example.com/india', enabled: true },
    ] },
  };
  const createResponse = await fetch(`${baseUrl}/api/links`, { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  const stored = await Link.findById(created.id).lean();
  assert.equal(stored.adaptiveRouting.rules[0].countryCode, 'IN');
  assert.ok(stored.adaptiveRouting.rules[0].startAt instanceof Date);
  assert.equal(stored.adaptiveRouting.rules[0].campaign.source, 'Launch');
  assert.deepEqual(stored.adaptiveRouting.rules.map((rule) => rule.priority), [0, 1]);
  const retrieved = await fetch(`${baseUrl}/api/links/${created.id}`, { headers });
  assert.equal((await retrieved.json()).link.adaptiveRouting.rules[0].timeZone, 'UTC');

  const redirect = await fetch(`${baseUrl}/${created.shortCode}?utm_source=Launch&utm_medium=email`, {
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'cf-connecting-ip': '198.51.100.20' },
    redirect: 'manual',
  });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://example.com/launch');
  await new Promise((resolve) => setTimeout(resolve, 30));
  const analyticsResponse = await fetch(`${baseUrl}/api/links/${created.id}/analytics`, { headers });
  const analytics = (await analyticsResponse.json()).analytics;
  assert.equal(analytics.totalClicks, 1);
  assert.equal(analytics.destinations.find((entry) => entry.matchedRuleId === 'india-launch')?.clicks, 1);
  const event = await ClickEvent.findOne({ linkId: new mongoose.Types.ObjectId(created.id) }).lean();
  assert.equal(event.countryCode, 'IN');
  assert.equal(Object.hasOwn(event, 'ip'), false);
  assert.equal(Object.hasOwn(event, 'userAgent'), false);

  const reordered = { ...created.adaptiveRouting, rules: [...created.adaptiveRouting.rules].reverse() };
  assert.equal((await fetch(`${baseUrl}/api/links/${created.id}`, { method: 'PATCH', headers, body: JSON.stringify({ adaptiveRouting: reordered }) })).status, 200);
  const reorderedDocument = await Link.findById(created.id).lean();
  assert.deepEqual(reorderedDocument.adaptiveRouting.rules.map((rule) => [rule.ruleId, rule.priority]), [['india-fallback-rule', 0], ['india-launch', 1]]);
  assert.ok(reorderedDocument.adaptiveRouting.destinations.some((destination) => destination.ownerId === 'india-launch' && destination.destinationUrl === 'https://example.com/launch'));

  const disable = { ...reordered, rules: reordered.rules.map((rule) => rule.ruleId === 'india-launch' ? { ...rule, enabled: false } : rule) };
  assert.equal((await fetch(`${baseUrl}/api/links/${created.id}`, { method: 'PATCH', headers, body: JSON.stringify({ adaptiveRouting: disable }) })).status, 200);
  assert.equal((await Link.findById(created.id).lean()).adaptiveRouting.rules.find((rule) => rule.ruleId === 'india-launch').enabled, false);

  const originalCreate = ClickEvent.create;
  try {
    ClickEvent.create = () => Promise.reject(new Error('isolated test analytics failure'));
    const response = await fetch(`${baseUrl}/${created.shortCode}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://example.com/india');
  } finally { ClickEvent.create = originalCreate; }

  const originalFindById = Link.findById.bind(Link);
  let readCount = 0;
  let releaseReads;
  const bothReads = new Promise((resolve) => { releaseReads = resolve; });
  Link.findById = async (...args) => { const result = await originalFindById(...args); readCount += 1; if (readCount === 2) releaseReads(); await bothReads; return result; };
  let updates;
  try {
    updates = await Promise.all(['first', 'second'].map((title) => fetch(`${baseUrl}/api/links/${created.id}`, { method: 'PATCH', headers, body: JSON.stringify({ title }) })));
  } finally { Link.findById = originalFindById; }
  assert.deepEqual(updates.map((response) => response.status).sort(), [200, 409]);
});
