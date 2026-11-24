import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { createTestAuth } from './testAuth.js';
import { diffPublicationSnapshots, publicationSnapshot } from '../src/services/flowIntelligenceService.js';
import { compileFlowToAdaptiveRouting } from '../src/services/flowCompiler.js';
import { resolveAdaptiveDestination } from '../src/services/adaptiveRoutingService.js';
import { normalizePublicationSnapshot, normalizeFlowDoc } from '../src/utils/flowNormalization.js';

function memoryDb() {
  const flows = new Map();
  const links = new Map();
  const clicks = [];
  const publications = [];
  let linkCounter = 1;

  const doc = (val) => ({
    ...val,
    toObject() { const { toObject, ...rest } = this; return structuredClone(rest); },
  });

  const FlowPublication = {
    publications,
    find(filter = {}) {
      let result = publications.filter((p) => {
        if (filter.flowId && p.flowId !== filter.flowId) return false;
        if (filter.publicationNumber !== undefined && p.publicationNumber !== filter.publicationNumber) return false;
        return true;
      });
      const query = {
        _sort: null,
        _skip: 0,
        _limit: Infinity,
        sort(s) {
          this._sort = s;
          if (s?.publicationNumber === -1) {
            result.sort((a, b) => b.publicationNumber - a.publicationNumber);
          } else if (s?.publicationNumber === 1) {
            result.sort((a, b) => a.publicationNumber - b.publicationNumber);
          }
          return this;
        },
        skip(n) { this._skip = n; return this; },
        limit(n) { this._limit = n; return this; },
        lean() {
          const sliced = result.slice(this._skip, this._skip + this._limit);
          const p = Promise.resolve(sliced.map((item) => structuredClone(item)));
          p.exec = () => p;
          return p;
        },
        then(resolve, reject) {
          return this.lean().then(resolve, reject);
        },
      };
      return query;
    },
    async countDocuments(filter = {}) {
      return publications.filter((p) => {
        if (filter.flowId && p.flowId !== filter.flowId) return false;
        return true;
      }).length;
    },
    findOne(filter = {}) {
      const query = {
        lean() {
          const found = publications.find((p) => {
            if (filter.flowId && p.flowId !== filter.flowId) return false;
            if (filter.publicationNumber !== undefined && p.publicationNumber !== filter.publicationNumber) return false;
            return true;
          });
          const p = Promise.resolve(found ? structuredClone(found) : null);
          p.exec = () => p;
          return p;
        },
        then(resolve, reject) {
          return this.lean().then(resolve, reject);
        },
      };
      return query;
    },
    async insertMany(docs) {
      for (const d of docs) {
        publications.push(structuredClone(d));
      }
      return docs;
    },
    async create(docs) {
      const arr = Array.isArray(docs) ? docs : [docs];
      for (const d of arr) {
        publications.push(structuredClone(d));
      }
      return arr;
    },
  };

  const Flow = {
    async create(val) {
      const now = new Date();
      const saved = doc({
        ...structuredClone(val),
        publicationHistory: val.publicationHistory ?? [],
        publicationRequests: val.publicationRequests ?? [],
        publicationSequence: val.publicationSequence ?? 0,
        lifecycleStatus: val.lifecycleStatus ?? 'active',
        operationVersion: val.operationVersion ?? 0,
        createdAt: now,
        updatedAt: now,
      });
      flows.set(saved.flowId, saved);
      return saved;
    },
    async findOne(filter) {
      if (filter.flowId) return flows.get(filter.flowId) ?? null;
      if (filter._id) {
        for (const f of flows.values()) if (f._id === filter._id) return f;
      }
      return null;
    },
    async findOneAndUpdate(filter, update) {
      let found = null;
      if (filter.flowId) found = flows.get(filter.flowId);
      else if (filter._id) {
        for (const f of flows.values()) if (f._id === filter._id) found = f;
      }
      if (!found) return null;
      if (filter.revision !== undefined && found.revision !== filter.revision) return null;
      if (filter.operationVersion !== undefined && found.operationVersion !== filter.operationVersion) return null;

      if (update.$set) Object.assign(found, structuredClone(update.$set));
      if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) found[k] = (found[k] ?? 0) + v;
      }
      if (update.$push) {
        for (const [k, v] of Object.entries(update.$push)) {
          found[k] = found[k] ?? [];
          found[k].push(structuredClone(v));
        }
      }
      found.updatedAt = new Date();
      return found;
    },
    async updateOne(filter, update) {
      const found = await this.findOne(filter);
      if (!found) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$pull?.publicationRequests?.expiresAt?.$lte) {
        const threshold = update.$pull.publicationRequests.expiresAt.$lte;
        const initialLen = found.publicationRequests.length;
        found.publicationRequests = found.publicationRequests.filter((r) => !r.expiresAt || new Date(r.expiresAt) > threshold);
        return { matchedCount: 1, modifiedCount: initialLen !== found.publicationRequests.length ? 1 : 0 };
      }
      return { matchedCount: 1, modifiedCount: 0 };
    },
  };

  const toIdStr = (val) => {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (val?.buffer && val.buffer instanceof Uint8Array) return Buffer.from(val.buffer).toString('hex');
    return String(val);
  };
  const Link = {
    async create(docs) {
      return docs.map((val) => {
        const id = toIdStr(val._id) || `link-${linkCounter++}`;
        const item = doc({ ...structuredClone(val), _id: id, id, createdAt: new Date() });
        links.set(id, item);
        return item;
      });
    },
    async findById(id) {
      return links.get(toIdStr(id)) ?? null;
    },
    async findOne(filter) {
      if (filter.shortCode) {
        for (const l of links.values()) if (l.shortCode === filter.shortCode) return l;
      }
      return null;
    },
    async exists(filter) {
      if (filter.shortCode) {
        for (const l of links.values()) if (l.shortCode === filter.shortCode) return true;
      }
      return false;
    },
    async findOneAndUpdate(filter, update) {
      const target = links.get(filter._id);
      if (!target) return null;
      if (update.$set) Object.assign(target, structuredClone(update.$set));
      return target;
    },
    async findByIdAndUpdate(id, update) {
      const target = links.get(id);
      if (!target) return null;
      if (update.$set) Object.assign(target, structuredClone(update.$set));
      return target;
    },
  };

  const ClickEvent = {
    clicks,
    aggregate(pipeline) {
      return {
        allowDiskUse() { return this; },
        then(resolve) {
          // Emulate facet pipeline output
          const facetMatch = pipeline[0]?.$match ?? {};
          const filtered = clicks.filter((c) => {
            if (facetMatch.linkId && String(c.linkId) !== String(facetMatch.linkId)) return false;
            return true;
          });
          const totals = [{
            totalClicks: filtered.length,
            clicksToday: filtered.length,
            clicksLast7Days: filtered.length,
            clicksLast30Days: filtered.length,
          }];
          const destinationsGroup = new Map();
          for (const c of filtered) {
            const destId = c.selectedDestinationId ?? 'default';
            destinationsGroup.set(destId, (destinationsGroup.get(destId) ?? 0) + 1);
          }
          const destinations = [...destinationsGroup.entries()].map(([destId, count]) => ({
            _id: { destinationId: destId, matchedRuleId: destId.startsWith('rule:') ? destId.slice(5) : null, usedFallback: destId === 'default' },
            clicks: count,
          }));
          resolve([{
            totals,
            selectedTotal: [{ count: filtered.length }],
            daily: [{ _id: new Date().toISOString().slice(0, 10), count: filtered.length }],
            devices: [{ _id: 'desktop', count: filtered.length }],
            browsers: [{ _id: 'Chrome', count: filtered.length }],
            operatingSystems: [{ _id: 'Windows', count: filtered.length }],
            referrers: [{ _id: 'direct', count: filtered.length }],
            countries: [{ _id: { countryCode: 'US', countryName: 'United States' }, count: filtered.length }],
            destinations,
            cities: [],
            regions: [],
            bots: [],
          }]);
        },
      };
    },
  };

  return { Flow, Link, ClickEvent, FlowPublication, flows, links, clicks, publications };
}

function sampleGraph() {
  const nodes = [
    { id: 'entry', position: { x: 0, y: 0 }, data: { kind: 'entry', label: 'Entry' } },
    { id: 'router', position: { x: 200, y: 0 }, data: { kind: 'router', label: 'Router' } },
    { id: 'before', position: { x: 500, y: 0 }, data: { kind: 'destination', phase: 'before', label: 'Before Event', destinationUrl: 'https://example.com/register', schedule: { startLocal: '', endLocal: '2026-12-01T09:00' } } },
    { id: 'during', position: { x: 500, y: 100 }, data: { kind: 'destination', phase: 'during', label: 'During Event', destinationUrl: 'https://example.com/live', schedule: { startLocal: '2026-12-01T09:00', endLocal: '2026-12-01T17:00' } } },
    { id: 'after', position: { x: 500, y: 200 }, data: { kind: 'destination', phase: 'after', label: 'After Event', destinationUrl: 'https://example.com/replay', schedule: { startLocal: '2026-12-01T17:00', endLocal: '' } } },
    { id: 'fallback', position: { x: 500, y: 300 }, data: { kind: 'fallback', label: 'General Fallback', destinationUrl: 'https://example.com/fallback' } },
  ];
  return {
    nodes,
    edges: [
      { id: 'e-r', source: 'entry', target: 'router' },
      { id: 'r-b', source: 'router', target: 'before' },
      { id: 'r-d', source: 'router', target: 'during' },
      { id: 'r-a', source: 'router', target: 'after' },
      { id: 'r-f', source: 'router', target: 'fallback' },
    ],
  };
}

test('diffPublicationSnapshots detects added, removed, and changed stages', () => {
  const snap1 = {
    stages: [
      { stageId: 'before', label: 'Before', destinationUrl: 'https://example.com/v1', startAt: null, endAt: '2026-12-01T09:00:00.000Z' },
      { stageId: 'during', label: 'During', destinationUrl: 'https://example.com/live1', startAt: '2026-12-01T09:00:00.000Z', endAt: '2026-12-01T17:00:00.000Z' },
    ],
    fallback: { stageId: 'default', label: 'Fallback', destinationUrl: 'https://example.com/fallback' },
  };

  const snap2 = {
    stages: [
      { stageId: 'before', label: 'Before', destinationUrl: 'https://example.com/v2', startAt: null, endAt: '2026-12-01T09:00:00.000Z' },
      { stageId: 'after', label: 'After', destinationUrl: 'https://example.com/replay', startAt: '2026-12-01T17:00:00.000Z', endAt: null },
    ],
    fallback: { stageId: 'default', label: 'Fallback', destinationUrl: 'https://example.com/fallback' },
  };

  const diffs = diffPublicationSnapshots(snap1, snap2);
  assert.ok(diffs.some((d) => d.type === 'changed' && d.stageId === 'before' && d.fields.includes('destinationUrl')));
  assert.ok(diffs.some((d) => d.type === 'removed' && d.stageId === 'during'));
  assert.ok(diffs.some((d) => d.type === 'added' && d.stageId === 'after'));
});

test('flow analytics distinguishes unpublished, empty, and populated flows', async () => {
  const { Flow, Link, ClickEvent, FlowPublication, clicks, flows } = memoryDb();
  const auth = createTestAuth();
  const server = createApp({ flowModel: Flow, linkModel: Link, clickEventModel: ClickEvent, flowPublicationModel: FlowPublication, ...auth }).listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const adminFetch = auth.fetch(baseUrl, await auth.login(baseUrl));

  try {
    // 1. Unpublished flow
    const createdFlow = await Flow.create({
      flowId: 'flow-test-analytics',
      eventName: 'Analytics Test',
      creatorTimeZone: 'UTC',
      revision: 1,
      draft: { presentation: { nodes: [] }, routing: { stages: [] } },
    });
    const unpubRes = await adminFetch(`${baseUrl}/api/flows/flow-test-analytics/analytics`);
    const unpubBody = await unpubRes.json();
    assert.equal(unpubRes.status, 200);
    assert.equal(unpubBody.state, 'unpublished');
    assert.equal(unpubBody.analytics, null);

    const linkObjectId = new mongoose.Types.ObjectId();
    const link = (await Link.create([{
      _id: linkObjectId,
      shortCode: 'analytic1',
      originalUrl: 'https://example.com/fallback',
      status: 'active',
      management: { ownerType: 'flow', flowId: 'flow-test-analytics' },
      adaptiveRouting: {
        enabled: true,
        defaultDestinationUrl: 'https://example.com/fallback',
        defaultDestinationId: 'dest-default',
        destinations: [{ destinationId: 'dest-default', ownerId: 'default', destinationUrl: 'https://example.com/fallback' }],
        rules: [],
      },
    }]))[0];

    createdFlow.linkId = linkObjectId;
    flows.get('flow-test-analytics').linkId = linkObjectId;
    const emptyRes = await adminFetch(`${baseUrl}/api/flows/flow-test-analytics/analytics`);
    const emptyBody = await emptyRes.json();
    assert.equal(emptyRes.status, 200);
    assert.equal(emptyBody.state, 'empty');
    assert.equal(emptyBody.analytics.clicksInRange, 0);

    // 3. Populated flow with click event
    clicks.push({
      linkId: linkObjectId,
      selectedDestinationId: 'dest-default',
      clickedAt: new Date(),
      deviceType: 'desktop',
      countryCode: 'US',
      countryName: 'United States',
      browser: 'Chrome',
      operatingSystem: 'Windows',
    });

    const popRes = await adminFetch(`${baseUrl}/api/flows/flow-test-analytics/analytics`);
    const popBody = await popRes.json();
    assert.equal(popBody.status || popRes.status, 200);
    assert.equal(popBody.state, 'ready');
    assert.equal(popBody.analytics.clicksInRange, 1);
    assert.equal(popBody.analytics.destinations[0].stageLabel, 'Fallback');
    assert.ok(Array.isArray(popBody.analytics.topReferrers));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('flow time-travel simulation evaluates draft & published routing without mutating state', async () => {
  const { Flow, Link, ClickEvent, FlowPublication, clicks } = memoryDb();
  const auth = createTestAuth();
  const server = createApp({ flowModel: Flow, linkModel: Link, clickEventModel: ClickEvent, flowPublicationModel: FlowPublication, ...auth }).listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const adminFetch = auth.fetch(baseUrl, await auth.login(baseUrl));

  try {
    const rawFlow = {
      flowId: 'flow-test-sim',
      eventName: 'Simulation Test',
      creatorTimeZone: 'Asia/Kolkata',
      eventStartLocal: '2026-12-01T09:00',
      eventEndLocal: '2026-12-01T17:00',
      eventStartAtUtc: new Date('2026-12-01T03:30:00.000Z'),
      eventEndAtUtc: new Date('2026-12-01T11:30:00.000Z'),
      revision: 1,
      draft: {
        presentation: {
          nodes: sampleGraph().nodes.map((n) => ({ nodeId: n.id, kind: n.data.kind, label: n.data.label, position: n.position })),
          edges: sampleGraph().edges.map((e) => ({ edgeId: e.id, source: e.source, target: e.target })),
        },
        routing: {
          stages: [
            { nodeId: 'before', phase: 'before', destinationUrl: 'https://example.com/register', startAtUtc: null, endAtUtc: new Date('2026-12-01T03:30:00.000Z') },
            { nodeId: 'during', phase: 'during', destinationUrl: 'https://example.com/live', startAtUtc: new Date('2026-12-01T03:30:00.000Z'), endAtUtc: new Date('2026-12-01T11:30:00.000Z') },
            { nodeId: 'after', phase: 'after', destinationUrl: 'https://example.com/replay', startAtUtc: new Date('2026-12-01T11:30:00.000Z'), endAtUtc: null },
          ],
          fallbackNodeId: 'fallback',
          fallbackDestinationUrl: 'https://example.com/fallback',
        },
      },
    };
    await Flow.create(rawFlow);

    // 1. Simulate during phase (local 12:00 IST = 06:30 UTC)
    const simDuring = await adminFetch(`${baseUrl}/api/flows/flow-test-sim/simulate`, {
      method: 'POST',
      body: JSON.stringify({ localDateTime: '2026-12-01T12:00' }),
    });
    const simDuringBody = await simDuring.json();
    assert.equal(simDuring.status, 200);
    assert.equal(simDuringBody.draft.destinationUrl, 'https://example.com/live');
    assert.equal(simDuringBody.draft.stageId, 'during');
    assert.equal(simDuringBody.isArchived, false);
    assert.match(simDuringBody.note, /no click was recorded/i);
    assert.equal(clicks.length, 0); // No clicks recorded!

    // 2. Simulate before phase (local 08:00 IST)
    const simBefore = await adminFetch(`${baseUrl}/api/flows/flow-test-sim/simulate`, {
      method: 'POST',
      body: JSON.stringify({ localDateTime: '2026-12-01T08:00' }),
    });
    const simBeforeBody = await simBefore.json();
    assert.equal(simBeforeBody.draft.destinationUrl, 'https://example.com/register');
    assert.equal(simBeforeBody.draft.stageId, 'before');

    // 3. Simulate after phase (local 18:00 IST)
    const simAfter = await adminFetch(`${baseUrl}/api/flows/flow-test-sim/simulate`, {
      method: 'POST',
      body: JSON.stringify({ localDateTime: '2026-12-01T18:00' }),
    });
    const simAfterBody = await simAfter.json();
    assert.equal(simAfterBody.draft.destinationUrl, 'https://example.com/replay');
    assert.equal(simAfterBody.draft.stageId, 'after');

    // 4. Parity check with routing evaluator
    const compiled = compileFlowToAdaptiveRouting(rawFlow);
    const linkObj = { originalUrl: compiled.defaultDestinationUrl, adaptiveRouting: compiled };
    const parityResult = resolveAdaptiveDestination(linkObj, { now: new Date(simDuringBody.evaluatedAt) });
    assert.equal(parityResult.destinationUrl, simDuringBody.draft.destinationUrl);

    // 5. Verification of boundaries list
    assert.ok(Array.isArray(simDuringBody.boundaries));
    assert.ok(simDuringBody.boundaries.length >= 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('publication history and diff endpoints return paginated snapshots and configuration deltas', async () => {
  const { Flow, Link, ClickEvent, FlowPublication } = memoryDb();
  const auth = createTestAuth();
  const server = createApp({ flowModel: Flow, linkModel: Link, clickEventModel: ClickEvent, flowPublicationModel: FlowPublication, ...auth }).listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const adminFetch = auth.fetch(baseUrl, await auth.login(baseUrl));

  try {
    const snap1 = {
      schemaVersion: 2, flowId: 'flow-hist', revision: 1, publicationNumber: 1,
      creatorTimeZone: 'UTC', stages: [{ stageId: 'before', label: 'Before', destinationUrl: 'https://example.com/v1' }],
      fallback: { stageId: 'default', label: 'Fallback', destinationUrl: 'https://example.com/fb' },
    };
    const snap2 = {
      schemaVersion: 2, flowId: 'flow-hist', revision: 2, publicationNumber: 2,
      creatorTimeZone: 'UTC', stages: [{ stageId: 'before', label: 'Before', destinationUrl: 'https://example.com/v2' }],
      fallback: { stageId: 'default', label: 'Fallback', destinationUrl: 'https://example.com/fb' },
    };

    await Flow.create({
      flowId: 'flow-hist',
      eventName: 'History Test',
      creatorTimeZone: 'UTC',
      revision: 2,
      publicationSequence: 2,
      publishedConfiguration: snap2,
      publicationHistory: [
        { publicationNumber: 1, revision: 1, publishedAt: new Date(Date.now() - 3600000), configuration: snap1 },
        { publicationNumber: 2, revision: 2, publishedAt: new Date(), configuration: snap2 },
      ],
    });

    const histRes = await adminFetch(`${baseUrl}/api/flows/flow-hist/history?page=1&limit=10`);
    const histBody = await histRes.json();
    assert.equal(histRes.status, 200);
    assert.equal(histBody.history.length, 2);
    assert.equal(histBody.history[0].publicationNumber, 2);
    assert.equal(histBody.history[0].isCurrent, true);
    assert.ok(histBody.history[0].changes.some((c) => c.stageId === 'before' && c.type === 'changed'));

    const diffRes = await adminFetch(`${baseUrl}/api/flows/flow-hist/history/diff?from=1&to=2`);
    const diffBody = await diffRes.json();
    assert.equal(diffRes.status, 200);
    assert.equal(diffBody.changes[0].stageId, 'before');
    assert.equal(diffBody.changes[0].after.destinationUrl, 'https://example.com/v2');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('normalizePublicationSnapshot handles legacy Milestone 3 schemaVersion: 1 without fabricating missing labels', () => {
  const legacySnapshot = {
    schemaVersion: 1,
    revision: 1,
    linkId: 'link-123',
    creatorTimeZone: 'America/New_York',
    eventStartAtUtc: '2026-12-01T14:00:00.000Z',
    eventEndAtUtc: '2026-12-01T22:00:00.000Z',
    adaptiveRouting: {
      enabled: true,
      defaultDestinationId: 'dest-default-1',
      defaultDestinationUrl: 'https://example.com/default',
      rules: [
        {
          ruleId: 'during',
          destinationId: 'dest-during-1',
          destinationUrl: 'https://example.com/during-live',
          startAt: '2026-12-01T14:00:00.000Z',
          endAt: '2026-12-01T22:00:00.000Z',
        },
      ],
    },
  };

  const normalized = normalizePublicationSnapshot(legacySnapshot, {
    publicationNumber: 1,
    operation: 'publish',
    flow: { flowId: 'flow-legacy-1', creatorTimeZone: 'America/New_York' },
  });

  assert.equal(normalized.schemaVersion, 2);
  assert.equal(normalized.publicationNumber, 1);
  assert.equal(normalized.creatorTimeZone, 'America/New_York');
  assert.equal(normalized.stages.length, 1);
  assert.equal(normalized.stages[0].stageId, 'during');
  // Labels are preserved or set to ruleId rather than fabricating user names
  assert.equal(normalized.stages[0].label, 'during');
  assert.equal(normalized.stages[0].destinationUrl, 'https://example.com/during-live');
  assert.equal(normalized.fallback.destinationUrl, 'https://example.com/default');
  assert.equal(normalized.fallback.destinationId, 'dest-default-1');
});

test('normalizeFlowDoc assigns safe fallback lifecycleStatus, operationVersion, and publicationSequence', () => {
  const legacyFlow = {
    flowId: 'flow-old-legacy',
    eventName: 'Old Event',
    revision: 3,
    publicationHistory: [{ publicationNumber: 1 }, { publicationNumber: 2 }],
  };

  const normalized = normalizeFlowDoc(legacyFlow);
  assert.equal(normalized.lifecycleStatus, 'active');
  assert.equal(normalized.operationVersion, 0);
  assert.equal(normalized.publicationSequence, 2);
});

test('flow analytics attributes clicks using publication history and ignores draft stage renaming', async () => {
  const { Flow, Link, ClickEvent, FlowPublication, clicks } = memoryDb();
  const auth = createTestAuth();
  const server = createApp({ flowModel: Flow, linkModel: Link, clickEventModel: ClickEvent, flowPublicationModel: FlowPublication, ...auth }).listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const adminFetch = auth.fetch(baseUrl, await auth.login(baseUrl));

  try {
    const linkObjectId = new mongoose.Types.ObjectId();
    const link = (await Link.create([{
      _id: linkObjectId,
      shortCode: 'rename-test',
      originalUrl: 'https://example.com/fb',
      status: 'active',
      management: { ownerType: 'flow', flowId: 'flow-rename' },
      adaptiveRouting: {
        enabled: true,
        defaultDestinationUrl: 'https://example.com/fb',
        defaultDestinationId: 'dest-fb',
        destinations: [
          { destinationId: 'dest-fb', ownerId: 'default', destinationUrl: 'https://example.com/fb' },
          { destinationId: 'dest-v1', ownerId: 'during', destinationUrl: 'https://example.com/v1-live' },
        ],
        rules: [
          { ruleId: 'during', destinationId: 'dest-v1', destinationUrl: 'https://example.com/v1-live' },
        ],
      },
    }]))[0];

    const snap1 = {
      schemaVersion: 2,
      flowId: 'flow-rename',
      revision: 1,
      publicationNumber: 1,
      creatorTimeZone: 'UTC',
      stages: [{ stageId: 'during', label: 'Original Live Stage', destinationId: 'dest-v1', destinationUrl: 'https://example.com/v1-live' }],
      fallback: { stageId: 'default', label: 'Fallback', destinationId: 'dest-fb', destinationUrl: 'https://example.com/fb' },
    };

    // Current draft has renamed the stage to "Renamed Live Stage"
    await Flow.create({
      flowId: 'flow-rename',
      eventName: 'Rename Test',
      linkId: linkObjectId,
      revision: 2,
      publishedRevision: 1,
      publicationSequence: 1,
      draft: {
        presentation: {
          nodes: [
            { nodeId: 'during', data: { label: 'Renamed Live Stage' } },
          ],
        },
      },
      publishedConfiguration: snap1,
      publicationHistory: [
        { publicationNumber: 1, revision: 1, publishedAt: new Date(Date.now() - 3600000), configuration: snap1 },
      ],
    });

    // Also populate FlowPublication
    await FlowPublication.create({
      flowId: 'flow-rename',
      publicationNumber: 1,
      revision: 1,
      configuration: snap1,
    });

    // Historical click occurred with publicationNumber: 1
    clicks.push({
      linkId: linkObjectId,
      flowId: 'flow-rename',
      publicationNumber: 1,
      selectedDestinationId: 'dest-v1',
      clickedAt: new Date(),
      deviceType: 'desktop',
      countryCode: 'US',
      countryName: 'United States',
      browser: 'Chrome',
      operatingSystem: 'Windows',
    });

    const res = await adminFetch(`${baseUrl}/api/flows/flow-rename/analytics`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.state, 'ready');
    // Crucial: Click attribution preserves historical publication label "Original Live Stage", NOT draft "Renamed Live Stage"
    const duringStage = body.analytics.destinations.find((d) => d.stageId === 'during');
    assert.ok(duringStage);
    assert.equal(duringStage.stageLabel, 'Original Live Stage');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('flow simulation identifies archived flows and returns archivedNotice', async () => {
  const { Flow, Link, ClickEvent, FlowPublication } = memoryDb();
  const auth = createTestAuth();
  const server = createApp({ flowModel: Flow, linkModel: Link, clickEventModel: ClickEvent, flowPublicationModel: FlowPublication, ...auth }).listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const adminFetch = auth.fetch(baseUrl, await auth.login(baseUrl));

  try {
    await Flow.create({
      flowId: 'flow-archived-sim',
      eventName: 'Archived Sim Test',
      creatorTimeZone: 'UTC',
      lifecycleStatus: 'archived',
      revision: 1,
      draft: { presentation: { nodes: [] }, routing: { stages: [] } },
    });

    const simRes = await adminFetch(`${baseUrl}/api/flows/flow-archived-sim/simulate`, {
      method: 'POST',
      body: JSON.stringify({ localDateTime: '2026-12-01T12:00' }),
    });
    const simBody = await simRes.json();
    assert.equal(simRes.status, 200);
    assert.equal(simBody.isArchived, true);
    assert.match(simBody.archivedNotice, /archived/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
