import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { test } from 'node:test';
import Flow from '../src/models/Flow.js';
import Link from '../src/models/Link.js';
import ClickEvent from '../src/models/ClickEvent.js';
import { createApp } from '../src/app.js';
import { createFlowPublishingService } from '../src/services/flowPublishingService.js';
import { normalizeFlowPayload } from '../src/services/flowService.js';
import { utcDateTimeToLocal } from '../src/utils/schedule.js';
import { createTestAuth } from './testAuth.js';

const mongoUri = process.env.MONGODB_TEST_URI;
if (mongoUri) {
  const uri = new URL(mongoUri);
  if (uri.protocol !== 'mongodb:' || !['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname)) throw new Error('MONGODB_TEST_URI must point to an isolated local MongoDB replica set.');
}
const wall = (value) => utcDateTimeToLocal(value, 'UTC');
function graph({ before = 'https://example.com/register', during = 'https://example.com/live', after = 'https://example.com/replay', fallback = 'https://example.com/event' } = {}) {
  const nodes = [
    { id: 'entry', position: { x: 0, y: 0 }, data: { kind: 'entry', label: 'Entry' } },
    { id: 'router', position: { x: 200, y: 0 }, data: { kind: 'router', label: 'Router' } },
    { id: 'before', position: { x: 500, y: 0 }, data: { kind: 'destination', phase: 'before', label: 'Before', destinationUrl: before, schedule: {} } },
    { id: 'during', position: { x: 500, y: 100 }, data: { kind: 'destination', phase: 'during', label: 'During', destinationUrl: during, schedule: {} } },
    { id: 'after', position: { x: 500, y: 200 }, data: { kind: 'destination', phase: 'after', label: 'After', destinationUrl: after, schedule: {} } },
    { id: 'fallback', position: { x: 500, y: 300 }, data: { kind: 'fallback', label: 'Fallback', destinationUrl: fallback } },
  ];
  return { nodes, edges: [{ id: 'entry-router', source: 'entry', target: 'router' }, ...nodes.slice(2).map((node) => ({ id: `router-${node.id}`, source: 'router', target: node.id }))] };
}

test('replica-set publishing is atomic, idempotent, permanent, protected, and routed by the existing resolver', { skip: !mongoUri }, async (t) => {
  const dbName = `linkify_flow_publish_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  await mongoose.connect(mongoUri, { dbName });
  await Promise.all([Flow.syncIndexes(), Link.syncIndexes(), ClickEvent.syncIndexes()]);
  const auth = createTestAuth(); const server = createApp({ ...auth, flowModel: Flow, linkModel: Link, clickEventModel: ClickEvent, logger: { error() {}, warn() {} } }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`; const cookie = await auth.login(baseUrl); const headers = { cookie, origin: 'http://localhost:5174', 'content-type': 'application/json' };
  const now = new Date(); const initialPayload = { eventName: 'Live summit', creatorTimeZone: 'UTC', eventStartLocal: wall(new Date(now.getTime() - 300000)), eventEndLocal: wall(new Date(now.getTime() + 300000)), graph: graph() };
  const anonymous = await fetch(`${baseUrl}/api/flows/nope/publish`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5174', 'idempotency-key': 'anonymous-key' }, body: JSON.stringify({ expectedRevision: 1 }) });
  assert.equal(anonymous.status, 401);
  const createdResponse = await fetch(`${baseUrl}/api/flows`, { method: 'POST', headers, body: JSON.stringify(initialPayload) }); const created = await createdResponse.json(); assert.equal(createdResponse.status, 201);
  const publishHeaders = { ...headers, 'idempotency-key': 'publish-first-0001' };
  const firstResponse = await fetch(`${baseUrl}/api/flows/${created.flow.id}/publish`, { method: 'POST', headers: publishHeaders, body: JSON.stringify({ expectedRevision: 1, customAlias: 'live-summit' }) }); const first = await firstResponse.json();
  assert.equal(firstResponse.status, 201); assert.equal(first.publication.shortCode, 'live-summit'); assert.equal(first.flow.publishedRevision, 1);
  const storedFlow = await Flow.findOne({ flowId: created.flow.id }).lean(); const storedLink = await Link.findById(storedFlow.linkId).lean();
  assert.equal(storedFlow.publicationHistory.length, 1); assert.equal(storedLink.management.flowId, created.flow.id); assert.equal(storedLink.management.ownerType, 'flow');
  const retryResponse = await fetch(`${baseUrl}/api/flows/${created.flow.id}/publish`, { method: 'POST', headers: publishHeaders, body: JSON.stringify({ expectedRevision: 1, customAlias: 'live-summit' }) }); const retry = await retryResponse.json();
  assert.equal(retryResponse.status, 200); assert.equal(retry.idempotent, true); assert.equal(retry.publication.linkId, first.publication.linkId); assert.equal(await Link.countDocuments({ 'management.flowId': created.flow.id }), 1);
  const reused = await fetch(`${baseUrl}/api/flows/${created.flow.id}/publish`, { method: 'POST', headers: publishHeaders, body: JSON.stringify({ expectedRevision: 1 }) }); assert.equal(reused.status, 409); assert.equal((await reused.json()).code, 'IDEMPOTENCY_CONFLICT');
  const redirectDuring = await fetch(`${baseUrl}/live-summit`, { redirect: 'manual' }); assert.equal(redirectDuring.status, 302); assert.equal(redirectDuring.headers.get('location'), 'https://example.com/live');
  const protectedPatch = await fetch(`${baseUrl}/api/links/${first.publication.linkId}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'archived' }) }); assert.equal(protectedPatch.status, 409); assert.equal((await protectedPatch.json()).code, 'FLOW_MANAGED_LINK');
  const protectedDelete = await fetch(`${baseUrl}/api/links/${first.publication.linkId}`, { method: 'DELETE', headers }); assert.equal(protectedDelete.status, 409);

  const draftGraph = graph({ during: 'https://example.com/new-live' });
  const patchResponse = await fetch(`${baseUrl}/api/flows/${created.flow.id}`, { method: 'PATCH', headers, body: JSON.stringify({ revision: 1, graph: draftGraph }) }); const patched = await patchResponse.json(); assert.equal(patched.flow.revision, 2);
  const unchangedRedirect = await fetch(`${baseUrl}/live-summit`, { redirect: 'manual' }); assert.equal(unchangedRedirect.headers.get('location'), 'https://example.com/live');
  const stale = await fetch(`${baseUrl}/api/flows/${created.flow.id}/publish`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'publish-stale-0001' }, body: JSON.stringify({ expectedRevision: 1 }) }); assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'STALE_FLOW_REVISION');
  const republish = await fetch(`${baseUrl}/api/flows/${created.flow.id}/publish`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'publish-second-001' }, body: JSON.stringify({ expectedRevision: 2 }) }); const republished = await republish.json();
  assert.equal(republish.status, 201); assert.equal(republished.publication.linkId, first.publication.linkId); assert.equal(republished.publication.shortCode, 'live-summit');
  assert.equal((await fetch(`${baseUrl}/live-summit`, { redirect: 'manual' })).headers.get('location'), 'https://example.com/new-live');
  const history = (await Link.findById(first.publication.linkId).lean()).adaptiveRouting.destinations;
  assert.ok(history.some((item) => item.ownerId === 'during' && item.destinationUrl === 'https://example.com/live'));
  assert.ok(history.some((item) => item.ownerId === 'during' && item.destinationUrl === 'https://example.com/new-live'));
  const active = await fetch(`${baseUrl}/api/flows/${created.flow.id}/active-destination`, { headers }); const activeBody = await active.json(); assert.equal(activeBody.activeDestination.destinationUrl, 'https://example.com/new-live'); assert.match(activeBody.note, /No click was recorded/);

  const secondPayload = { ...initialPayload, eventName: 'Concurrent flow', graph: graph({ during: 'https://example.com/concurrent' }) };
  const secondCreated = await (await fetch(`${baseUrl}/api/flows`, { method: 'POST', headers, body: JSON.stringify(secondPayload) })).json();
  const concurrent = await Promise.all(['concurrent-key-01', 'concurrent-key-02'].map((key) => fetch(`${baseUrl}/api/flows/${secondCreated.flow.id}/publish`, { method: 'POST', headers: { ...headers, 'idempotency-key': key }, body: JSON.stringify({ expectedRevision: 1 }) })));
  assert.ok(concurrent.every((response) => [200, 201].includes(response.status))); assert.equal(await Link.countDocuments({ 'management.flowId': secondCreated.flow.id }), 1);

  const collisionLink = await fetch(`${baseUrl}/api/links`, { method: 'POST', headers, body: JSON.stringify({ originalUrl: 'https://example.com', customAlias: 'reserved-event' }) }); assert.equal(collisionLink.status, 201);
  const thirdCreated = await (await fetch(`${baseUrl}/api/flows`, { method: 'POST', headers, body: JSON.stringify({ ...initialPayload, eventName: 'Collision flow' }) })).json();
  const collision = await fetch(`${baseUrl}/api/flows/${thirdCreated.flow.id}/publish`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'collision-key-001' }, body: JSON.stringify({ expectedRevision: 1, customAlias: 'reserved-event' }) }); const collisionBody = await collision.json(); assert.equal(collision.status, 409); assert.equal(collisionBody.code, 'ALIAS_CONFLICT'); assert.ok(collisionBody.suggestions.length > 0);

  const rollbackNormalized = normalizeFlowPayload({ ...initialPayload, eventName: 'Rollback flow' }).value; const rollbackFlow = await Flow.create({ flowId: randomUUID(), revision: 1, ...rollbackNormalized });
  const originalUpdate = Flow.findOneAndUpdate; Flow.findOneAndUpdate = async () => null;
  try { await assert.rejects(() => createFlowPublishingService({ Flow, Link }).publish(rollbackFlow.flowId, { expectedRevision: 1 }, 'rollback-key-001'), /changed during publication/); }
  finally { Flow.findOneAndUpdate = originalUpdate; }
  assert.equal(await Link.countDocuments({ 'management.flowId': rollbackFlow.flowId }), 0);
});
