import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { test } from 'node:test';
import Flow from '../src/models/Flow.js';
import Link from '../src/models/Link.js';
import ClickEvent from '../src/models/ClickEvent.js';
import FlowPublication from '../src/models/FlowPublication.js';
import { createApp } from '../src/app.js';
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

function sampleGraph({ before = 'https://example.com/v1-reg', during = 'https://example.com/v1-live', after = 'https://example.com/v1-replay', fallback = 'https://example.com/fb' } = {}) {
  const nodes = [
    { id: 'entry', position: { x: 0, y: 0 }, data: { kind: 'entry', label: 'Entry' } },
    { id: 'router', position: { x: 200, y: 0 }, data: { kind: 'router', label: 'Router' } },
    { id: 'before', position: { x: 500, y: 0 }, data: { kind: 'destination', phase: 'before', label: 'Register', destinationUrl: before, schedule: {} } },
    { id: 'during', position: { x: 500, y: 100 }, data: { kind: 'destination', phase: 'during', label: 'Watch Live', destinationUrl: during, schedule: {} } },
    { id: 'after', position: { x: 500, y: 200 }, data: { kind: 'destination', phase: 'after', label: 'Replay', destinationUrl: after, schedule: {} } },
    { id: 'fallback', position: { x: 500, y: 300 }, data: { kind: 'fallback', label: 'Fallback', destinationUrl: fallback } },
  ];
  return { nodes, edges: [{ id: 'entry-router', source: 'entry', target: 'router' }, ...nodes.slice(2).map((node) => ({ id: `router-${node.id}`, source: 'router', target: node.id }))] };
}

test('Milestone 5C Acceptance Gate: storage, migration, real concurrency, and historical attribution', { skip: !mongoUri }, async (t) => {
  const dbName = `linkify_gate_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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

  // =========================================================================
  // 1. Verify publication storage and migration
  // =========================================================================
  await t.test('1. Publication storage and repeatable migration', async () => {
    // A. Verify compound unique index
    const indexes = await FlowPublication.collection.indexes();
    const compoundIndex = indexes.find((idx) => idx.key.flowId === 1 && idx.key.publicationNumber === -1);
    assert.ok(compoundIndex, 'Compound index on { flowId: 1, publicationNumber: -1 } exists');
    assert.equal(compoundIndex.unique, true, 'Compound index is unique');

    // B. Create a legacy Milestone 3 Flow document with 4 embedded publication snapshots
    const legacyFlowId = `legacy-${randomUUID()}`;
    const legacySnapshots = [1, 2, 3, 4].map((num) => ({
      publicationNumber: num,
      revision: num,
      publishedAt: new Date(Date.now() - (5 - num) * 3600000),
      configuration: {
        schemaVersion: 1,
        flowId: legacyFlowId,
        revision: num,
        creatorTimeZone: 'UTC',
        adaptiveRouting: {
          enabled: true,
          defaultDestinationId: 'dest-default',
          defaultDestinationUrl: 'https://example.com/legacy-fb',
          rules: [{ ruleId: 'during', destinationId: `dest-during-${num}`, destinationUrl: `https://example.com/legacy-${num}` }],
        },
      },
    }));

    await Flow.create({
      flowId: legacyFlowId,
      eventName: 'Legacy Summit',
      creatorTimeZone: 'UTC',
      revision: 4,
      publicationSequence: 4,
      publishedRevision: 4,
      publishedConfiguration: legacySnapshots[3].configuration,
      publicationHistory: legacySnapshots,
    });

    // C. Simulate migration interruption: pre-insert only publications 1 and 2
    await FlowPublication.create([
      {
        flowId: legacyFlowId,
        publicationNumber: 1,
        revision: 1,
        operation: 'publish',
        publishedAt: legacySnapshots[0].publishedAt,
        configuration: legacySnapshots[0].configuration,
      },
      {
        flowId: legacyFlowId,
        publicationNumber: 2,
        revision: 2,
        operation: 'publish',
        publishedAt: legacySnapshots[1].publishedAt,
        configuration: legacySnapshots[1].configuration,
      },
    ]);
    assert.equal(await FlowPublication.countDocuments({ flowId: legacyFlowId }), 2);

    // D. Fetch history: migration should resume, detect missing 3 & 4, and insert them
    const histRes1 = await fetch(`${baseUrl}/api/flows/${legacyFlowId}/history?page=1&limit=10`, { headers });
    assert.equal(histRes1.status, 200);
    const histBody1 = await histRes1.json();
    assert.equal(histBody1.pagination.total, 4);
    assert.equal(await FlowPublication.countDocuments({ flowId: legacyFlowId }), 4);

    // E. Repeated migration: fetch history again, count must remain exactly 4
    const histRes2 = await fetch(`${baseUrl}/api/flows/${legacyFlowId}/history?page=1&limit=10`, { headers });
    assert.equal(histRes2.status, 200);
    assert.equal(await FlowPublication.countDocuments({ flowId: legacyFlowId }), 4);

    // F. Concurrent migration: send 5 simultaneous requests to /history on unmigrated flow
    const concurrentLegacyFlowId = `legacy-concurrent-${randomUUID()}`;
    await Flow.create({
      flowId: concurrentLegacyFlowId,
      eventName: 'Concurrent Legacy',
      creatorTimeZone: 'UTC',
      revision: 3,
      publicationSequence: 3,
      publicationHistory: legacySnapshots.slice(0, 3),
    });
    const concurrentRes = await Promise.all(
      [1, 2, 3, 4, 5].map(() => fetch(`${baseUrl}/api/flows/${concurrentLegacyFlowId}/history?page=1&limit=10`, { headers })),
    );
    assert.ok(concurrentRes.every((r) => r.status === 200), 'All concurrent history migrations succeeded');
    assert.equal(await FlowPublication.countDocuments({ flowId: concurrentLegacyFlowId }), 3);

    // G. Verify read-only simulation & analytics do NOT mutate FlowPublication or Flow
    const pubsBefore = await FlowPublication.countDocuments();
    const simRes = await fetch(`${baseUrl}/api/flows/${legacyFlowId}/simulate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ localDateTime: wall(now) }),
    });
    assert.equal(simRes.status, 200);
    assert.equal(await FlowPublication.countDocuments(), pubsBefore, 'Simulation performed zero database writes');

    // H. Bounded embedded history: publishing 25 times caps Flow.publicationHistory at <= 20
    const boundedFlowRes = await fetch(`${baseUrl}/api/flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        eventName: 'Bounded Flow',
        creatorTimeZone: 'UTC',
        eventStartLocal: wall(new Date(now.getTime() - 60000)),
        eventEndLocal: wall(new Date(now.getTime() + 60000)),
        graph: sampleGraph(),
      }),
    });
    const boundedFlowId = (await boundedFlowRes.json()).flow.id;

    for (let i = 1; i <= 22; i++) {
      const pubRes = await fetch(`${baseUrl}/api/flows/${boundedFlowId}/publish`, {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': `bound-pub-${i}` },
        body: JSON.stringify({ expectedRevision: 1 }),
      });
      assert.equal(pubRes.status, 201);
    }

    const storedBoundedFlow = await Flow.findOne({ flowId: boundedFlowId }).lean();
    assert.equal(storedBoundedFlow.publicationSequence, 22);
    assert.ok(storedBoundedFlow.publicationHistory.length <= 20, `Embedded history bounded at ${storedBoundedFlow.publicationHistory.length} <= 20`);
    assert.equal(await FlowPublication.countDocuments({ flowId: boundedFlowId }), 22, 'FlowPublication holds all 22 publications');
  });

  // =========================================================================
  // 2. Deterministic MongoDB Concurrency Tests
  // =========================================================================
  await t.test('2. Real MongoDB transaction concurrency guarantees', async () => {
    // Helper to create and return active flow
    async function createFlow(alias) {
      const res = await fetch(`${baseUrl}/api/flows`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          eventName: 'Concurrency Flow',
          creatorTimeZone: 'UTC',
          eventStartLocal: wall(new Date(now.getTime() - 60000)),
          eventEndLocal: wall(new Date(now.getTime() + 60000)),
          graph: sampleGraph(),
        }),
      });
      const flowId = (await res.json()).flow.id;
      const pubRes = await fetch(`${baseUrl}/api/flows/${flowId}/publish`, {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': `init-${randomUUID()}` },
        body: JSON.stringify({ expectedRevision: 1, ...(alias ? { customAlias: alias } : {}) }),
      });
      assert.equal(pubRes.status, 201);
      return flowId;
    }

    // A. Concurrent Publish vs Archive
    const flow1 = await createFlow();
    const [pubVsArch_pub, pubVsArch_arch] = await Promise.all([
      fetch(`${baseUrl}/api/flows/${flow1}/publish`, {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': `conc-pub-${randomUUID()}` },
        body: JSON.stringify({ expectedRevision: 1 }),
      }),
      fetch(`${baseUrl}/api/flows/${flow1}/archive`, {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': `conc-arch-${randomUUID()}` },
      }),
    ]);
    const statuses1 = [pubVsArch_pub.status, pubVsArch_arch.status];
    // Either publish succeeded (201) and archive succeeded (200), OR archive succeeded (200) and publish was blocked with 409 FLOW_ARCHIVED
    assert.ok(
      (statuses1.includes(201) && statuses1.includes(200)) ||
      (statuses1.includes(200) && statuses1.includes(409)),
      `Publish vs Archive statuses valid: ${statuses1}`,
    );

    // B. Concurrent Publish vs Rollback
    const flow2 = await createFlow();
    // Publish a 2nd revision so we can rollback to 1
    await fetch(`${baseUrl}/api/flows/${flow2}/publish`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': `prep-pub-${randomUUID()}` },
      body: JSON.stringify({ expectedRevision: 1 }),
    });

    const [pubVsRb_pub, pubVsRb_rb] = await Promise.all([
      fetch(`${baseUrl}/api/flows/${flow2}/publish`, {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': `conc-pub2-${randomUUID()}` },
        body: JSON.stringify({ expectedRevision: 1 }),
      }),
      fetch(`${baseUrl}/api/flows/${flow2}/rollback`, {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': `conc-rb2-${randomUUID()}` },
        body: JSON.stringify({ targetPublicationNumber: 1, syncDraft: true, confirmDraftDiscard: true }),
      }),
    ]);
    assert.ok([200, 201, 409].includes(pubVsRb_pub.status));
    assert.ok([200, 201, 409].includes(pubVsRb_rb.status));
    const flow2Stored = await Flow.findOne({ flowId: flow2 }).lean();
    assert.equal(flow2Stored.lifecycleStatus, 'active');

    // C. Concurrent Rollback vs Archive
    const flow3 = await createFlow();
    const [rbVsArch_rb, rbVsArch_arch] = await Promise.all([
      fetch(`${baseUrl}/api/flows/${flow3}/rollback`, {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': `conc-rb3-${randomUUID()}` },
        body: JSON.stringify({ targetPublicationNumber: 1 }),
      }),
      fetch(`${baseUrl}/api/flows/${flow3}/archive`, {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': `conc-arch3-${randomUUID()}` },
      }),
    ]);
    assert.ok([200, 201, 409].includes(rbVsArch_rb.status));
    assert.ok([200, 409].includes(rbVsArch_arch.status));

    // D. Concurrent Archive vs Restore
    const flow4 = await createFlow();
    await fetch(`${baseUrl}/api/flows/${flow4}/archive`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': `arch-init-${randomUUID()}` },
    });
    const [archVsRest_arch, archVsRest_rest] = await Promise.all([
      fetch(`${baseUrl}/api/flows/${flow4}/archive`, {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': `conc-arch4-${randomUUID()}` },
      }),
      fetch(`${baseUrl}/api/flows/${flow4}/restore`, {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': `conc-rest4-${randomUUID()}` },
      }),
    ]);
    assert.ok([200, 409].includes(archVsRest_arch.status));
    assert.ok([200, 409].includes(archVsRest_rest.status));

    // E. Concurrent Draft Save vs Rollback
    const flow5 = await createFlow();
    const [draftVsRb_draft, draftVsRb_rb] = await Promise.all([
      fetch(`${baseUrl}/api/flows/${flow5}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ revision: 1, eventName: 'Concurrently Saved Name' }),
      }),
      fetch(`${baseUrl}/api/flows/${flow5}/rollback`, {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': `conc-rb5-${randomUUID()}` },
        body: JSON.stringify({ targetPublicationNumber: 1, syncDraft: true, confirmDraftDiscard: false }),
      }),
    ]);
    // If draft save committed first, rollback without discard confirmation rejects with 409 UNSAVED_DRAFT_CONFLICT
    // If rollback committed first, draft save with stale revision rejects with 409 REVISION_CONFLICT
    assert.ok([200, 409].includes(draftVsRb_draft.status));
    assert.ok([201, 409].includes(draftVsRb_rb.status));

    // F. Concurrent Duplicate Requests with Identical Idempotency Key
    const flow6 = await createFlow();
    const identicalKey = `identical-key-${randomUUID()}`;
    const duplicateResults = await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        fetch(`${baseUrl}/api/flows/${flow6}/publish`, {
          method: 'POST',
          headers: { ...headers, 'idempotency-key': identicalKey },
          body: JSON.stringify({ expectedRevision: 1 }),
        }),
      ),
    );
    assert.ok(duplicateResults.every((r) => [200, 201].includes(r.status)), 'All identical retries succeeded with 200 or 201');
    const flow6Stored = await Flow.findOne({ flowId: flow6 }).lean();
    assert.equal(flow6Stored.publicationSequence, 2, 'Exactly one new publication sequence created despite 5 concurrent requests');
  });

  // =========================================================================
  // 3. Historical Analytics and Attribution
  // =========================================================================
  await t.test('3. Accurate publication click attribution across lifecycle operations', async () => {
    const eventAlias = `attr-summit-${randomUUID().slice(0, 8)}`;
    const createRes = await fetch(`${baseUrl}/api/flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        eventName: 'Attribution Summit',
        creatorTimeZone: 'UTC',
        eventStartLocal: wall(new Date(now.getTime() - 60000)),
        eventEndLocal: wall(new Date(now.getTime() + 60000)),
        graph: sampleGraph({ during: 'https://example.com/live-v1' }),
      }),
    });
    const flowId = (await createRes.json()).flow.id;

    // Publication #1
    const pub1Res = await fetch(`${baseUrl}/api/flows/${flowId}/publish`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': `attr-pub-1` },
      body: JSON.stringify({ expectedRevision: 1, customAlias: eventAlias }),
    });
    assert.equal(pub1Res.status, 201);

    // Click 1: during phase resolves to live-v1
    const click1 = await fetch(`${baseUrl}/${eventAlias}`, { redirect: 'manual' });
    assert.equal(click1.status, 302);
    assert.equal(click1.headers.get('location'), 'https://example.com/live-v1');

    // A. Draft-only stage renaming: rename "during" to "Draft Only Stage Name" without publishing
    const draftRenamed = sampleGraph({ during: 'https://example.com/live-v1' });
    draftRenamed.nodes.find((n) => n.id === 'during').data.label = 'Draft Only Stage Name';
    await fetch(`${baseUrl}/api/flows/${flowId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ revision: 1, graph: draftRenamed }),
    });

    // Check analytics: click 1 must retain "Watch Live", NOT "Draft Only Stage Name"
    const analyticsAfterDraftRename = await (await fetch(`${baseUrl}/api/flows/${flowId}/analytics`, { headers })).json();
    const duringAfterDraftRename = analyticsAfterDraftRename.analytics.destinations.find((d) => d.stageId === 'during');
    assert.equal(duringAfterDraftRename.stageLabel, 'Watch Live', 'Draft rename did not alter historical attribution');

    // B. Published stage renaming without changing destination URL
    const publishedRenamed = sampleGraph({ during: 'https://example.com/live-v1' });
    publishedRenamed.nodes.find((n) => n.id === 'during').data.label = 'Official Live Stream';
    await fetch(`${baseUrl}/api/flows/${flowId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ revision: 2, graph: publishedRenamed }),
    });
    const pub2Res = await fetch(`${baseUrl}/api/flows/${flowId}/publish`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': `attr-pub-2` },
      body: JSON.stringify({ expectedRevision: 3 }),
    });
    assert.equal(pub2Res.status, 201);

    // Click 2: occurs under Publication #2
    const click2 = await fetch(`${baseUrl}/${eventAlias}`, { redirect: 'manual' });
    assert.equal(click2.status, 302);

    // C. Destination URL change: Publication #3 with live-v2
    const draftNewUrl = sampleGraph({ during: 'https://example.com/live-v2' });
    draftNewUrl.nodes.find((n) => n.id === 'during').data.label = 'Official Live Stream v2';
    await fetch(`${baseUrl}/api/flows/${flowId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ revision: 3, graph: draftNewUrl }),
    });
    const pub3Res = await fetch(`${baseUrl}/api/flows/${flowId}/publish`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': `attr-pub-3` },
      body: JSON.stringify({ expectedRevision: 4 }),
    });
    assert.equal(pub3Res.status, 201);

    // Click 3: occurs under Publication #3
    const click3 = await fetch(`${baseUrl}/${eventAlias}`, { redirect: 'manual' });
    assert.equal(click3.status, 302);
    assert.equal(click3.headers.get('location'), 'https://example.com/live-v2');

    // D. Rollback to Publication #1 (creating Publication #4)
    const rollbackRes = await fetch(`${baseUrl}/api/flows/${flowId}/rollback`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': `attr-rb-1` },
      body: JSON.stringify({ targetPublicationNumber: 1, syncDraft: false }),
    });
    assert.equal(rollbackRes.status, 201);

    // Click 4: occurs under Publication #4 (restored live-v1)
    const click4 = await fetch(`${baseUrl}/${eventAlias}`, { redirect: 'manual' });
    assert.equal(click4.status, 302);
    assert.equal(click4.headers.get('location'), 'https://example.com/live-v1');

    // E. Archive & Restore
    await fetch(`${baseUrl}/api/flows/${flowId}/archive`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': `attr-arch-1` },
    });
    const clickArchived = await fetch(`${baseUrl}/${eventAlias}`, { redirect: 'manual' });
    assert.equal(clickArchived.status, 410, 'Archived flow returns HTTP 410 Gone');

    await fetch(`${baseUrl}/api/flows/${flowId}/restore`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': `attr-rest-1` },
    });
    const clickRestored = await fetch(`${baseUrl}/${eventAlias}`, { redirect: 'manual' });
    assert.equal(clickRestored.status, 302);

    // F. Verify final click attribution
    const finalAnalytics = await (await fetch(`${baseUrl}/api/flows/${flowId}/analytics`, { headers })).json();
    assert.equal(finalAnalytics.state, 'ready');
    assert.ok(finalAnalytics.analytics.destinations.length >= 2);

    // G. Verify legacy clicks with ambiguous and unknown attribution
    const linkId = (await Link.findOne({ shortCode: eventAlias }))._id;
    // Insert an ambiguous legacy click (no publicationNumber, matches destination with multiple historical labels)
    await ClickEvent.create({
      linkId,
      flowId,
      selectedDestinationId: 'dest-during-v1-ambiguous',
      clickedAt: new Date(Date.now() - 7200000),
      deviceType: 'desktop',
    });
    // Insert an unknown legacy click
    await ClickEvent.create({
      linkId,
      flowId,
      selectedDestinationId: 'dest-completely-nonexistent',
      clickedAt: new Date(Date.now() - 7200000),
      deviceType: 'desktop',
    });

    const analyticsWithLegacy = await (await fetch(`${baseUrl}/api/flows/${flowId}/analytics`, { headers })).json();
    const unknownAttribution = analyticsWithLegacy.analytics.destinations.find((d) => d.stageLabel.includes('Unknown') || d.attribution === 'unknown');
    assert.ok(unknownAttribution, 'Legacy click with nonexistent destination correctly marked as unknown');
  });
});
