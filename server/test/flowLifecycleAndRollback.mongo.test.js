import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { test } from 'node:test';
import Flow from '../src/models/Flow.js';
import Link from '../src/models/Link.js';
import ClickEvent from '../src/models/ClickEvent.js';
import FlowPublication from '../src/models/FlowPublication.js';
import { createApp } from '../src/app.js';
import { createFlowPublishingService } from '../src/services/flowPublishingService.js';
import { utcDateTimeToLocal } from '../src/utils/schedule.js';
import { createTestAuth } from './testAuth.js';

const mongoUri = process.env.MONGODB_TEST_URI;
if (mongoUri) {
  const uri = new URL(mongoUri);
  if (uri.protocol !== 'mongodb:' || !['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname)) {
    throw new Error('MONGODB_TEST_URI must point to an isolated local MongoDB replica set.');
  }
}

const wall = (value) => utcDateTimeToLocal(value, 'UTC');
function graph({ before = 'https://example.com/v1-register', during = 'https://example.com/v1-live', after = 'https://example.com/v1-replay', fallback = 'https://example.com/event' } = {}) {
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

test('flow rollback, synchronized archive/restore, and bounded idempotency retention in replica-set', { skip: !mongoUri }, async (t) => {
  const dbName = `linkify_flow_m4_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  await mongoose.connect(mongoUri, { dbName });
  await Promise.all([Flow.syncIndexes(), Link.syncIndexes(), ClickEvent.syncIndexes(), FlowPublication.syncIndexes()]);

  const auth = createTestAuth();
  const server = createApp({ ...auth, flowModel: Flow, linkModel: Link, clickEventModel: ClickEvent, flowPublicationModel: FlowPublication, logger: { error() {}, warn() {} } }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const cookie = await auth.login(baseUrl);
  const headers = { cookie, origin: 'http://localhost:5174', 'content-type': 'application/json' };

  const now = new Date();
  const initialPayload = {
    eventName: 'Lifecycle Summit',
    creatorTimeZone: 'UTC',
    eventStartLocal: wall(new Date(now.getTime() - 300000)),
    eventEndLocal: wall(new Date(now.getTime() + 300000)),
    graph: graph(),
  };

  // 1. Create flow and publish Publication #1
  const createdRes = await fetch(`${baseUrl}/api/flows`, { method: 'POST', headers, body: JSON.stringify(initialPayload) });
  const created = await createdRes.json();
  assert.equal(createdRes.status, 201);
  const flowId = created.flow.id;

  const pub1Res = await fetch(`${baseUrl}/api/flows/${flowId}/publish`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'm4-pub-001' },
    body: JSON.stringify({ expectedRevision: 1, customAlias: 'lifecycle-summit' }),
  });
  const pub1 = await pub1Res.json();
  assert.equal(pub1Res.status, 201);
  assert.equal(pub1.flow.publicationSequence, 1);

  // Redirect check for Publication #1 (during should resolve to v1-live)
  const redirect1 = await fetch(`${baseUrl}/lifecycle-summit`, { redirect: 'manual' });
  assert.equal(redirect1.status, 302);
  assert.equal(redirect1.headers.get('location'), 'https://example.com/v1-live');

  // 2. Modify draft and publish Publication #2 with new destination
  const draft2 = graph({ during: 'https://example.com/v2-live' });
  const patchRes = await fetch(`${baseUrl}/api/flows/${flowId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ revision: 1, graph: draft2 }),
  });
  assert.equal(patchRes.status, 200);

  const pub2Res = await fetch(`${baseUrl}/api/flows/${flowId}/publish`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'm4-pub-002' },
    body: JSON.stringify({ expectedRevision: 2 }),
  });
  const pub2 = await pub2Res.json();
  assert.equal(pub2Res.status, 201);
  assert.equal(pub2.flow.publicationSequence, 2);

  const redirect2 = await fetch(`${baseUrl}/lifecycle-summit`, { redirect: 'manual' });
  assert.equal(redirect2.headers.get('location'), 'https://example.com/v2-live');

  // 3. Rollback to Publication #1
  // Test invalid target publication number rejected
  const badRollback = await fetch(`${baseUrl}/api/flows/${flowId}/rollback`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'm4-rb-bad' },
    body: JSON.stringify({ targetPublicationNumber: 999 }),
  });
  assert.equal(badRollback.status, 404);

  // Controlled rollback creating Publication #3 restored from #1
  const rollbackRes = await fetch(`${baseUrl}/api/flows/${flowId}/rollback`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'm4-rb-001' },
    body: JSON.stringify({ targetPublicationNumber: 1, syncDraft: false }),
  });
  const rollbackBody = await rollbackRes.json();
  assert.equal(rollbackRes.status, 201);
  assert.equal(rollbackBody.flow.publicationSequence, 3);
  assert.equal(rollbackBody.restoredFrom, 1);

  // Redirect now serves restored v1-live!
  const redirectRollback = await fetch(`${baseUrl}/lifecycle-summit`, { redirect: 'manual' });
  assert.equal(redirectRollback.headers.get('location'), 'https://example.com/v1-live');

  // History includes 3 publications
  const historyRes = await fetch(`${baseUrl}/api/flows/${flowId}/history`, { headers });
  const historyBody = await historyRes.json();
  assert.equal(historyBody.history.length, 3);
  assert.equal(historyBody.history[0].publicationNumber, 3);
  assert.equal(historyBody.history[0].operation, 'rollback');
  assert.equal(historyBody.history[0].restoredFrom, 1);

  // Rollback idempotency check
  const retryRollback = await fetch(`${baseUrl}/api/flows/${flowId}/rollback`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'm4-rb-001' },
    body: JSON.stringify({ targetPublicationNumber: 1, syncDraft: false }),
  });
  assert.equal(retryRollback.status, 200);
  assert.equal((await retryRollback.json()).idempotent, true);

  // 4. Synchronized Archive
  const archiveRes = await fetch(`${baseUrl}/api/flows/${flowId}/archive`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'm4-arch-001' },
  });
  const archiveBody = await archiveRes.json();
  assert.equal(archiveRes.status, 200);
  assert.equal(archiveBody.status, 'archived');
  assert.equal(archiveBody.flow.lifecycleStatus, 'archived');

  // Check managed Link is archived
  const storedLinkArchived = await Link.findById(pub1.publication.linkId).lean();
  assert.equal(storedLinkArchived.status, 'archived');

  // Public redirect for archived flow returns 410 Gone and does not record clicks!
  const redirectArchived = await fetch(`${baseUrl}/lifecycle-summit`, { redirect: 'manual' });
  assert.equal(redirectArchived.status, 410);
  assert.match(await redirectArchived.text(), /archived/);

  // Idempotent archive retry
  const retryArchive = await fetch(`${baseUrl}/api/flows/${flowId}/archive`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'm4-arch-001' },
  });
  assert.equal(retryArchive.status, 200);
  assert.equal((await retryArchive.json()).idempotent, true);

  // Redundant archive with new key rejects with 409 FLOW_ALREADY_ARCHIVED
  const redundantArchive = await fetch(`${baseUrl}/api/flows/${flowId}/archive`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'm4-arch-002' },
  });
  assert.equal(redundantArchive.status, 409);

  // 5. Synchronized Restore
  const restoreRes = await fetch(`${baseUrl}/api/flows/${flowId}/restore`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'm4-rest-001' },
  });
  const restoreBody = await restoreRes.json();
  assert.equal(restoreRes.status, 200);
  assert.equal(restoreBody.status, 'active');
  assert.equal(restoreBody.flow.lifecycleStatus, 'active');

  // Link status is restored to active
  const storedLinkRestored = await Link.findById(pub1.publication.linkId).lean();
  assert.equal(storedLinkRestored.status, 'active');

  // Public redirect resumes working!
  const redirectRestored = await fetch(`${baseUrl}/lifecycle-summit`, { redirect: 'manual' });
  assert.equal(redirectRestored.status, 302);
  assert.equal(redirectRestored.headers.get('location'), 'https://example.com/v1-live');

  // 6. Bounded publication idempotency retention
  const publishingService = createFlowPublishingService({ Flow, Link, FlowPublication });
  const storedFlowBeforePrune = await Flow.findOne({ flowId }).lean();
  assert.ok(storedFlowBeforePrune.publicationRequests.length > 0);
  assert.ok(storedFlowBeforePrune.publicationRequests.every((r) => r.expiresAt !== null));

  // Pruning with future date prunes expired requests while preserving publicationHistory
  await publishingService.pruneExpiredRequests(flowId, { olderThan: new Date(Date.now() + 100 * 3600000) });
  const storedFlowAfterPrune = await Flow.findOne({ flowId }).lean();
  assert.equal(storedFlowAfterPrune.publicationRequests.length, 0);
  assert.equal(storedFlowAfterPrune.publicationHistory.length, 3); // History is IMMUTABLE and PRESERVED!

  // 7. Mutation rejections on archived Flow (SEC-05)
  const reArchiveRes = await fetch(`${baseUrl}/api/flows/${flowId}/archive`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'm4-arch-003' },
  });
  assert.equal(reArchiveRes.status, 200);

  // Attempting to publish or rollback while archived must be rejected with 409 FLOW_ARCHIVED
  const blockedPublish = await fetch(`${baseUrl}/api/flows/${flowId}/publish`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'm4-pub-archived' },
    body: JSON.stringify({ expectedRevision: 2 }),
  });
  assert.equal(blockedPublish.status, 409);
  const blockedPublishBody = await blockedPublish.json();
  assert.equal(blockedPublishBody.code, 'FLOW_ARCHIVED');

  const blockedRollback = await fetch(`${baseUrl}/api/flows/${flowId}/rollback`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'm4-rb-archived' },
    body: JSON.stringify({ targetPublicationNumber: 1 }),
  });
  assert.equal(blockedRollback.status, 409);
  const blockedRollbackBody = await blockedRollback.json();
  assert.equal(blockedRollbackBody.code, 'FLOW_ARCHIVED');

  // Verify simulator reports isArchived: true when archived
  const simArchivedRes = await fetch(`${baseUrl}/api/flows/${flowId}/simulate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localDateTime: wall(now) }),
  });
  assert.equal(simArchivedRes.status, 200);
  const simArchivedBody = await simArchivedRes.json();
  assert.equal(simArchivedBody.isArchived, true);
  assert.match(simArchivedBody.archivedNotice, /archived/i);

  // Restore flow to active
  const unarchiveRes = await fetch(`${baseUrl}/api/flows/${flowId}/restore`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'm4-rest-002' },
  });
  assert.equal(unarchiveRes.status, 200);

  // 8. Expired key reuse and opportunistic pruning (SEC-02)
  // Manually push an expired publicationRequest record
  const expiredKey = 'm4-pub-expired-key-1';
  await Flow.updateOne(
    { flowId },
    {
      $push: {
        publicationRequests: {
          key: expiredKey,
          requestHash: 'fakehash',
          expiresAt: new Date(Date.now() - 3600000), // 1 hour in the past
          responseBody: { stale: true },
        },
      },
    },
  );

  // Reusing the expired key directly in /publish must succeed without STALE_FLOW_REVISION error
  const reuseExpiredRes = await fetch(`${baseUrl}/api/flows/${flowId}/publish`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': expiredKey },
    body: JSON.stringify({ expectedRevision: 2 }),
  });
  assert.equal(reuseExpiredRes.status, 201);
  const reuseExpiredBody = await reuseExpiredRes.json();
  assert.equal(reuseExpiredBody.flow.publicationSequence, 4);

  // 9. Active idempotency key retry vs payload mismatch (SEC-02)
  const activeKey = 'm4-pub-active-key-test';
  const pubActive1 = await fetch(`${baseUrl}/api/flows/${flowId}/publish`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': activeKey },
    body: JSON.stringify({ expectedRevision: 2 }),
  });
  assert.equal(pubActive1.status, 201);
  const pubActive1Body = await pubActive1.json();
  assert.equal(pubActive1Body.flow.publicationSequence, 5);

  // Same key + same payload => 200 idempotent retry
  const pubActiveRetry = await fetch(`${baseUrl}/api/flows/${flowId}/publish`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': activeKey },
    body: JSON.stringify({ expectedRevision: 2 }),
  });
  assert.equal(pubActiveRetry.status, 200);
  assert.equal((await pubActiveRetry.json()).idempotent, true);

  // Same active key + different payload => 409 conflict
  const pubActiveMismatch = await fetch(`${baseUrl}/api/flows/${flowId}/publish`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': activeKey },
    body: JSON.stringify({ expectedRevision: 99 }),
  });
  assert.equal(pubActiveMismatch.status, 409);

  // 10. Dedicated FlowPublication collection & database-side pagination (SEC-06)
  const totalPubDocs = await FlowPublication.countDocuments({ flowId });
  assert.equal(totalPubDocs, 5);

  const histPage1Res = await fetch(`${baseUrl}/api/flows/${flowId}/history?page=1&limit=2`, { headers });
  assert.equal(histPage1Res.status, 200);
  const histPage1 = await histPage1Res.json();
  assert.equal(histPage1.history.length, 2);
  assert.equal(histPage1.pagination.total, 5);
  assert.equal(histPage1.history[0].publicationNumber, 5);
  assert.equal(histPage1.history[1].publicationNumber, 4);

  const histPage2Res = await fetch(`${baseUrl}/api/flows/${flowId}/history?page=2&limit=2`, { headers });
  assert.equal(histPage2Res.status, 200);
  const histPage2 = await histPage2Res.json();
  assert.equal(histPage2.history.length, 2);
  assert.equal(histPage2.history[0].publicationNumber, 3);
  assert.equal(histPage2.history[1].publicationNumber, 2);

  // 11. Rollback graph reconstruction with custom additions and deletions (SEC-07 & SEC-08)
  // Current draft: add custom stage "vip", delete stage "after"
  const draftCustom = {
    nodes: [
      { id: 'entry', position: { x: 0, y: 0 }, data: { kind: 'entry', label: 'Entry' } },
      { id: 'router', position: { x: 200, y: 0 }, data: { kind: 'router', label: 'Router' } },
      { id: 'before', position: { x: 500, y: 0 }, data: { kind: 'destination', phase: 'before', label: 'Before', destinationUrl: 'https://example.com/v1-register', schedule: {} } },
      { id: 'during', position: { x: 500, y: 100 }, data: { kind: 'destination', phase: 'during', label: 'During', destinationUrl: 'https://example.com/v1-live', schedule: {} } },
      { id: 'vip', position: { x: 500, y: 250 }, data: { kind: 'destination', phase: 'custom', label: 'VIP Lounge', destinationUrl: 'https://example.com/vip', schedule: {} } },
      { id: 'fallback', position: { x: 500, y: 300 }, data: { kind: 'fallback', label: 'Fallback', destinationUrl: 'https://example.com/event' } },
    ],
    edges: [
      { id: 'entry-router', source: 'entry', target: 'router' },
      { id: 'router-before', source: 'router', target: 'before' },
      { id: 'router-during', source: 'router', target: 'during' },
      { id: 'router-vip', source: 'router', target: 'vip' },
      { id: 'router-fallback', source: 'router', target: 'fallback' },
    ],
  };
  const saveCustomDraftRes = await fetch(`${baseUrl}/api/flows/${flowId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ revision: 2, graph: draftCustom }),
  });
  assert.equal(saveCustomDraftRes.status, 200);

  // Rollback to Publication #1 with syncDraft: true
  const rollbackSyncRes = await fetch(`${baseUrl}/api/flows/${flowId}/rollback`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'm4-rb-sync-001' },
    body: JSON.stringify({ targetPublicationNumber: 1, syncDraft: true, discardDraft: true }),
  });
  assert.equal(rollbackSyncRes.status, 201);

  // Inspect the synchronized draft
  const fetchedFlowRes = await fetch(`${baseUrl}/api/flows/${flowId}`, { headers });
  assert.equal(fetchedFlowRes.status, 200);
  const fetchedFlow = (await fetchedFlowRes.json()).flow;
  const draftNodeIds = fetchedFlow.graph.nodes.map((n) => n.id);
  assert.ok(draftNodeIds.includes('after'), 'Deleted "after" stage was restored in draft graph');
  assert.ok(!draftNodeIds.includes('vip'), 'Custom "vip" stage was cleaned from draft graph');
  assert.ok(fetchedFlow.graph.edges.some((e) => e.target === 'after'), 'Edge to "after" was reconstructed');

  // 12. Publication-aware click attribution across stage rename (SEC-03 & SEC-09)
  // Record ClickEvent with publicationNumber: 1
  const linkId = pub1.publication.linkId;
  await ClickEvent.create({
    linkId,
    flowId,
    publicationNumber: 1,
    selectedDestinationId: 'dest-during',
    clickedAt: new Date(),
    deviceType: 'desktop',
    countryCode: 'US',
    countryName: 'United States',
    browser: 'Chrome',
    operatingSystem: 'Windows',
  });

  const analyticsRes = await fetch(`${baseUrl}/api/flows/${flowId}/analytics`, { headers });
  assert.equal(analyticsRes.status, 200);
  const analyticsBody = await analyticsRes.json();
  assert.equal(analyticsBody.state, 'ready');
  assert.ok(Array.isArray(analyticsBody.analytics.topReferrers));
  assert.ok(analyticsBody.analytics.destinations.length > 0);
});
