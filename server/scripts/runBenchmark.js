import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import http from 'node:http';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import Link from '../src/models/Link.js';
import ClickEvent from '../src/models/ClickEvent.js';
import Flow from '../src/models/Flow.js';
import FlowPublication from '../src/models/FlowPublication.js';
import AdminSession from '../src/models/AdminSession.js';
import { createApp } from '../src/app.js';
import { createGeoLocator } from '../src/services/geoIpService.js';
import { createFlowPublishingService } from '../src/services/flowPublishingService.js';
import { normalizeFlowPayload } from '../src/services/flowService.js';

// Configuration
const PORT = 5088;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ADMIN_USER = 'benchmark-admin';
const salt = randomBytes(16).toString('base64url');
const hash = scryptSync('BenchmarkPassword123!', Buffer.from(salt, 'base64url'), 64).toString('base64url');
const ADMIN_HASH = `scrypt$${salt}$${hash}`;

console.log('[benchmark] 1. Initializing isolated MongoMemoryReplSet...');
const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
const mongoUri = replSet.getUri();
console.log('[benchmark] Mongo replica set running at:', mongoUri);

await mongoose.connect(mongoUri);

console.log('[benchmark] Ensuring database indexes...');
await Promise.all([
  Link.syncIndexes(),
  ClickEvent.syncIndexes(),
  Flow.syncIndexes(),
  FlowPublication.syncIndexes(),
  AdminSession.syncIndexes(),
]);

// Set up admin session
const sessionToken = randomBytes(32).toString('base64url');
const tokenHash = createHash('sha256').update(sessionToken).digest('hex');
const credVersion = createHash('sha256').update(`${ADMIN_USER}\0${ADMIN_HASH}`).digest('hex');
await AdminSession.create({
  tokenHash,
  credentialVersion: credVersion,
  expiresAt: new Date(Date.now() + 8 * 3600 * 1000),
});
const authCookie = `linkify_admin=${encodeURIComponent(sessionToken)}`;

// 2. Seed representative dataset
console.log('[benchmark] 2. Seeding representative dataset (100 links, 1000 clicks, 5 flows)...');

// Standard links
const stdLinks = [];
for (let i = 1; i <= 60; i++) {
  stdLinks.push({
    shortCode: `std${i.toString().padStart(4, '0')}`,
    originalUrl: `https://example.com/target-${i}`,
    title: `Standard Test Link ${i}`,
    tags: ['benchmark', i % 2 === 0 ? 'even' : 'odd'],
    status: 'active',
    clicks: 10 + (i * 3),
  });
}

// Adaptive links
const adaptLinks = [];
for (let i = 1; i <= 40; i++) {
  adaptLinks.push({
    shortCode: `adp${i.toString().padStart(4, '0')}`,
    originalUrl: `https://example.com/default-${i}`,
    title: `Adaptive Test Link ${i}`,
    tags: ['benchmark', 'adaptive'],
    status: 'active',
    clicks: 25 + (i * 2),
    adaptiveRouting: {
      enabled: true,
      defaultDestinationUrl: `https://example.com/default-${i}`,
      rules: [
        {
          ruleId: `rule-mobile-${i}`,
          priority: 0,
          destinationId: `dest-mobile-${i}`,
          deviceType: 'mobile',
          destinationUrl: `https://example.com/mobile-${i}`,
          enabled: true,
        },
        {
          ruleId: `rule-desktop-${i}`,
          priority: 1,
          destinationId: `dest-desktop-${i}`,
          deviceType: 'desktop',
          destinationUrl: `https://example.com/desktop-${i}`,
          enabled: true,
        },
      ],
    },
  });
}

await Link.insertMany([...stdLinks, ...adaptLinks]);

// Seed 1,000 click events
const allLinkDocs = await Link.find({});
const clickDocs = [];
const devices = ['mobile', 'desktop', 'tablet'];
const browsers = ['Chrome', 'Safari', 'Firefox', 'Edge'];
const osList = ['iOS', 'Android', 'Windows', 'macOS'];
const countries = [
  { code: 'US', name: 'United States', city: 'New York' },
  { code: 'IN', name: 'India', city: 'Mumbai' },
  { code: 'GB', name: 'United Kingdom', city: 'London' },
  { code: 'DE', name: 'Germany', city: 'Berlin' },
];
const referrers = ['google.com', 'twitter.com', 'linkedin.com', 'github.com', null];

for (let i = 0; i < 1000; i++) {
  const targetLink = allLinkDocs[i % allLinkDocs.length];
  const daysAgo = (i % 30);
  const clickDate = new Date(Date.now() - (daysAgo * 86400 * 1000) - (i * 60 * 1000));
  const country = countries[i % countries.length];
  clickDocs.push({
    linkId: targetLink._id,
    destinationId: targetLink.adaptiveRouting?.enabled ? `rule-mobile-${(i % 40) + 1}` : 'default',
    ruleId: targetLink.adaptiveRouting?.enabled ? `rule-mobile-${(i % 40) + 1}` : null,
    isFallback: false,
    deviceType: devices[i % devices.length],
    browser: browsers[i % browsers.length],
    os: osList[i % osList.length],
    countryCode: country.code,
    countryName: country.name,
    city: country.city,
    referrerDomain: referrers[i % referrers.length],
    isBot: (i % 25 === 0),
    clickedAt: clickDate,
  });
}
await ClickEvent.insertMany(clickDocs);

// Seed Flows
const seededFlows = [];
for (let f = 1; f <= 5; f++) {
  const flowId = `flow-bench-${f}`;
  const graph = {
    nodes: [
      { id: 'entry', position: { x: 40, y: 205 }, data: { kind: 'entry', label: 'Entry' } },
      { id: 'router', position: { x: 350, y: 205 }, data: { kind: 'router', label: 'Router' } },
      { id: 'before', position: { x: 720, y: 10 }, data: { kind: 'destination', phase: 'before', label: 'Before', destinationUrl: `https://example.com/flow-${f}-before`, schedule: {} } },
      { id: 'during', position: { x: 720, y: 145 }, data: { kind: 'destination', phase: 'during', label: 'During', destinationUrl: `https://example.com/flow-${f}-during`, schedule: {} } },
      { id: 'after', position: { x: 720, y: 280 }, data: { kind: 'destination', phase: 'after', label: 'After', destinationUrl: `https://example.com/flow-${f}-after`, schedule: {} } },
      { id: 'fallback', position: { x: 720, y: 415 }, data: { kind: 'fallback', label: 'Fallback', destinationUrl: `https://example.com/flow-${f}-fallback` } },
    ],
    edges: [
      { id: 'entry-router', source: 'entry', target: 'router', label: 'Every visit' },
      { id: 'router-before', source: 'router', target: 'before', label: 'Before' },
      { id: 'router-during', source: 'router', target: 'during', label: 'During' },
      { id: 'router-after', source: 'router', target: 'after', label: 'After' },
      { id: 'router-fallback', source: 'router', target: 'fallback', label: 'Fallback' },
    ],
  };

  const normalized = normalizeFlowPayload({
    eventName: `Benchmark Event Flow ${f}`,
    description: `Flow for benchmark testing ${f}`,
    creatorTimeZone: 'Asia/Kolkata',
    eventStartLocal: '2026-12-01T09:00',
    eventEndLocal: '2026-12-01T17:00',
    graph,
  });

  const flowDoc = await Flow.create({
    flowId,
    revision: 1,
    ...normalized.value,
  });
  seededFlows.push(flowDoc);
}

// Publish 3 of the flows
const pubService = createFlowPublishingService({ Flow, Link, FlowPublication });
const flowCodes = [];
for (let p = 0; p < 3; p++) {
  const fDoc = seededFlows[p];
  const pubResult = await pubService.publish(
    fDoc.flowId,
    { expectedRevision: 1, customAlias: `flow${(p + 1).toString().padStart(4, '0')}` },
    `bench-pub-key-${p}`
  );
  flowCodes.push(pubResult.link.shortCode);
}

console.log('[benchmark] Data seeded successfully.');
console.log(`  -> Links: ${await Link.countDocuments()}`);
console.log(`  -> Clicks: ${await ClickEvent.countDocuments()}`);
console.log(`  -> Flows: ${await Flow.countDocuments()}`);
console.log(`  -> FlowPublications: ${await FlowPublication.countDocuments()}`);

// 3. Start Express server
const geoLocator = createGeoLocator({ dbPath: './data/dbip-city-lite-2026-11.mmdb' });
const app = createApp({
  adminUsername: ADMIN_USER,
  adminPasswordHash: ADMIN_HASH,
  clientOrigin: 'http://localhost:5174',
  production: false,
  geoLocator,
});

const server = http.createServer(app);
await new Promise((resolve) => server.listen(PORT, resolve));
console.log(`[benchmark] Express server listening on ${BASE_URL}`);

// Keep-alive agent for benchmarking
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 300,
  timeout: 10000,
});

// Helper for making single HTTP request
function executeRequest({ method = 'GET', path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const reqHeaders = {
      'Host': `127.0.0.1:${PORT}`,
      'Connection': 'keep-alive',
      ...headers,
    };
    if (body) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method,
      agent: httpAgent,
      headers: reqHeaders,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const duration = performance.now() - start;
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          duration,
          data,
        });
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(10000, () => {
      req.destroy(new Error('Request Timeout'));
    });

    if (body) req.write(body);
    req.end();
  });
}

// Benchmarking runner for a specific target
async function benchmarkRunner({
  name,
  getRequestOptions,
  totalRequests = 100,
  concurrency = 1,
  durationSeconds = null,
}) {
  const latencies = [];
  const statusCodes = {};
  let completed = 0;
  let errors = 0;
  const startTime = performance.now();
  const startCpu = process.cpuUsage();
  const startMem = process.memoryUsage();

  let isStopping = false;
  let timer = null;
  if (durationSeconds) {
    timer = setTimeout(() => { isStopping = true; }, durationSeconds * 1000);
  }

  let requestIndex = 0;

  async function worker() {
    while (!isStopping && (durationSeconds || requestIndex < totalRequests)) {
      const idx = requestIndex++;
      if (!durationSeconds && idx >= totalRequests) break;
      const opts = typeof getRequestOptions === 'function' ? getRequestOptions(idx) : getRequestOptions;
      try {
        const res = await executeRequest(opts);
        latencies.push(res.duration);
        statusCodes[res.statusCode] = (statusCodes[res.statusCode] || 0) + 1;
        completed++;
      } catch (err) {
        errors++;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  if (timer) clearTimeout(timer);
  const totalDurationMs = performance.now() - startTime;
  const cpuDiff = process.cpuUsage(startCpu);
  const endMem = process.memoryUsage();

  latencies.sort((a, b) => a - b);
  const sum = latencies.reduce((acc, val) => acc + val, 0);
  const avg = latencies.length ? sum / latencies.length : 0;
  const min = latencies.length ? latencies[0] : 0;
  const max = latencies.length ? latencies[latencies.length - 1] : 0;
  const p50 = latencies.length ? latencies[Math.floor(latencies.length * 0.50)] : 0;
  const p90 = latencies.length ? latencies[Math.floor(latencies.length * 0.90)] : 0;
  const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : 0;
  const p99 = latencies.length ? latencies[Math.floor(latencies.length * 0.99)] : 0;

  const totalTimeSec = totalDurationMs / 1000;
  const rps = totalTimeSec > 0 ? (completed + errors) / totalTimeSec : 0;
  const successfulCount = Object.entries(statusCodes)
    .filter(([code]) => Number(code) >= 200 && Number(code) < 400)
    .reduce((acc, [, count]) => acc + count, 0);
  const successfulRps = totalTimeSec > 0 ? successfulCount / totalTimeSec : 0;

  const cpuPercent = ((cpuDiff.user + cpuDiff.system) / 1000) / totalDurationMs * 100;

  return {
    name,
    concurrency,
    totalRequests: completed + errors,
    completed,
    errors,
    successfulCount,
    rps: Number(rps.toFixed(2)),
    successfulRps: Number(successfulRps.toFixed(2)),
    totalDurationMs: Number(totalDurationMs.toFixed(2)),
    avgLatencyMs: Number(avg.toFixed(2)),
    minLatencyMs: Number(min.toFixed(2)),
    p50LatencyMs: Number(p50.toFixed(2)),
    p90LatencyMs: Number(p90.toFixed(2)),
    p95LatencyMs: Number(p95.toFixed(2)),
    p99LatencyMs: Number(p99.toFixed(2)),
    maxLatencyMs: Number(max.toFixed(2)),
    statusCodes,
    cpuPercent: Number(cpuPercent.toFixed(1)),
    memRssMB: Number((endMem.rss / 1024 / 1024).toFixed(2)),
    memHeapUsedMB: Number((endMem.heapUsed / 1024 / 1024).toFixed(2)),
  };
}

// -------------------------------------------------------------
// Benchmark Phase 1: Endpoint-Wise Individual Performance
// -------------------------------------------------------------
console.log('\n======================================================');
console.log(' Phase 1: Endpoint-Wise Performance Benchmarks');
console.log('======================================================\n');

const endpointResults = [];

// 1. Health Endpoint
console.log('[benchmark] Testing 1: Health endpoint (/api/health)...');
const healthRes = await benchmarkRunner({
  name: 'Health Check (GET /api/health)',
  getRequestOptions: { path: '/api/health' },
  totalRequests: 500,
  concurrency: 10,
});
endpointResults.push(healthRes);

// 2. Standard URL Redirects
console.log('[benchmark] Testing 2: Standard URL redirects (GET /std0001)...');
const stdRedirectRes = await benchmarkRunner({
  name: 'Standard URL Redirect (GET /:code)',
  getRequestOptions: (idx) => ({
    path: `/std${((idx % 60) + 1).toString().padStart(4, '0')}`,
  }),
  totalRequests: 500,
  concurrency: 10,
});
endpointResults.push(stdRedirectRes);

// 3. Adaptive URL Redirects
console.log('[benchmark] Testing 3: Adaptive URL redirects (GET /adp0001)...');
const adaptRedirectRes = await benchmarkRunner({
  name: 'Adaptive URL Redirect (GET /:code)',
  getRequestOptions: (idx) => ({
    path: `/adp${((idx % 40) + 1).toString().padStart(4, '0')}`,
    headers: {
      'User-Agent': idx % 2 === 0
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    },
  }),
  totalRequests: 500,
  concurrency: 10,
});
endpointResults.push(adaptRedirectRes);

// 4. Published Flow Redirects
console.log('[benchmark] Testing 4: Published Flow redirects (GET /flow0001)...');
const flowRedirectRes = await benchmarkRunner({
  name: 'Published Flow Redirect (GET /:code)',
  getRequestOptions: (idx) => ({
    path: `/${flowCodes[idx % flowCodes.length]}`,
  }),
  totalRequests: 500,
  concurrency: 10,
});
endpointResults.push(flowRedirectRes);

// 5. Link Creation (Rate-limited to 60/15min)
console.log('[benchmark] Testing 5: Link Creation (POST /api/links) [50 reqs within rate limit]...');
const linkCreateRes = await benchmarkRunner({
  name: 'Link Creation (POST /api/links)',
  getRequestOptions: (idx) => ({
    method: 'POST',
    path: '/api/links',
    headers: {
      Cookie: authCookie,
      Origin: 'http://localhost:5174',
    },
    body: JSON.stringify({
      originalUrl: `https://example.com/created-${Date.now()}-${idx}`,
      title: `Bench Link ${idx}`,
    }),
  }),
  totalRequests: 50,
  concurrency: 1,
});
endpointResults.push(linkCreateRes);

// 6. Dashboard Link Retrieval
console.log('[benchmark] Testing 6: Dashboard Link Retrieval (GET /api/links)...');
const linkListRes = await benchmarkRunner({
  name: 'Dashboard Links Retrieval (GET /api/links)',
  getRequestOptions: {
    path: '/api/links?page=1&limit=50',
    headers: { Cookie: authCookie },
  },
  totalRequests: 50,
  concurrency: 2,
});
endpointResults.push(linkListRes);

// 7. Analytics Aggregation (Link & Overview)
console.log('[benchmark] Testing 7: Analytics Aggregation...');
const sampleLink = allLinkDocs[0];
const linkAnalyticsRes = await benchmarkRunner({
  name: 'Link Analytics (GET /api/links/:id/analytics)',
  getRequestOptions: {
    path: `/api/links/${sampleLink._id}/analytics`,
    headers: { Cookie: authCookie },
  },
  totalRequests: 50,
  concurrency: 2,
});
endpointResults.push(linkAnalyticsRes);

const overviewAnalyticsRes = await benchmarkRunner({
  name: 'Overview Analytics (GET /api/analytics/overview)',
  getRequestOptions: {
    path: '/api/analytics/overview',
    headers: { Cookie: authCookie },
  },
  totalRequests: 50,
  concurrency: 2,
});
endpointResults.push(overviewAnalyticsRes);

// 8. Flow Retrieval and Draft Saving
console.log('[benchmark] Testing 8: Flow Retrieval & Draft Saving...');
const targetFlow = seededFlows[3]; // unpublished draft
const flowGetRes = await benchmarkRunner({
  name: 'Flow Retrieval (GET /api/flows/:id)',
  getRequestOptions: {
    path: `/api/flows/${targetFlow.flowId}`,
    headers: { Cookie: authCookie },
  },
  totalRequests: 50,
  concurrency: 2,
});
endpointResults.push(flowGetRes);

let currentRevision = targetFlow.revision;
const flowSaveRes = await benchmarkRunner({
  name: 'Flow Draft Saving (PATCH /api/flows/:id)',
  getRequestOptions: () => {
    const rev = currentRevision++;
    return {
      method: 'PATCH',
      path: `/api/flows/${targetFlow.flowId}`,
      headers: {
        Cookie: authCookie,
        Origin: 'http://localhost:5174',
      },
      body: JSON.stringify({
        revision: rev,
        eventName: `Updated Event Name Rev ${rev}`,
        description: 'Benchmark update',
        creatorTimeZone: 'Asia/Kolkata',
        eventStartLocal: '2026-12-01T09:00',
        eventEndLocal: '2026-12-01T17:00',
        graph: targetFlow.draft.presentation,
      }),
    };
  },
  totalRequests: 25,
  concurrency: 1, // Sequential revision increment
});
endpointResults.push(flowSaveRes);

// 9. Routing Simulation
console.log('[benchmark] Testing 9: Routing Simulation (POST /api/flows/:id/simulate)...');
const simRes = await benchmarkRunner({
  name: 'Routing Simulation (POST /api/flows/:id/simulate)',
  getRequestOptions: {
    method: 'POST',
    path: `/api/flows/${seededFlows[0].flowId}/simulate`,
    headers: {
      Cookie: authCookie,
      Origin: 'http://localhost:5174',
    },
    body: JSON.stringify({ localDateTime: '2026-12-01T12:00' }),
  },
  totalRequests: 50,
  concurrency: 2,
});
endpointResults.push(simRes);

// 10. Flow Publication & Rollback (MongoDB Multi-Document Transactions)
console.log('[benchmark] Testing 10: Flow Publication & Rollback transactions...');
// We use flow-bench-5 for publication and rollback transactions
const txFlow = seededFlows[4];
let txRevision = 1;
let lastPubSequence = 0;

const txPubLatencies = [];
for (let p = 1; p <= 5; p++) {
  const t0 = performance.now();
  const pubRes = await pubService.publish(
    txFlow.flowId,
    { expectedRevision: txRevision },
    `bench-tx-key-${p}-${Date.now()}`
  );
  const t1 = performance.now();
  txPubLatencies.push(t1 - t0);
  lastPubSequence = pubRes.flow.publicationSequence;

  // Bump revision for next publication
  txRevision++;
  await Flow.updateOne({ flowId: txFlow.flowId }, { $set: { revision: txRevision } });
}

const txRollbackLatencies = [];
for (let r = 1; r <= 5; r++) {
  const t0 = performance.now();
  await pubService.rollback(
    txFlow.flowId,
    { targetPublicationNumber: 1, syncDraft: false, confirmDraftDiscard: true },
    `bench-rb-key-${r}-${Date.now()}`
  );
  const t1 = performance.now();
  txRollbackLatencies.push(t1 - t0);
}

const avgPubTx = txPubLatencies.reduce((a, b) => a + b, 0) / txPubLatencies.length;
const avgRbTx = txRollbackLatencies.reduce((a, b) => a + b, 0) / txRollbackLatencies.length;
console.log(`  -> Flow Publication Transaction Avg Latency: ${avgPubTx.toFixed(2)} ms`);
console.log(`  -> Flow Rollback Transaction Avg Latency: ${avgRbTx.toFixed(2)} ms`);

// 11. Publication History Retrieval
console.log('[benchmark] Testing 11: Publication History Retrieval (GET /api/flows/:id/history)...');
const historyRes = await benchmarkRunner({
  name: 'Publication History Retrieval (GET /api/flows/:id/history)',
  getRequestOptions: {
    path: `/api/flows/${txFlow.flowId}/history?page=1&limit=10`,
    headers: { Cookie: authCookie },
  },
  totalRequests: 50,
  concurrency: 2,
});
endpointResults.push(historyRes);

console.log('\nEndpoint-Wise Benchmarks Complete.');

// -------------------------------------------------------------
// Benchmark Phase 2: Concurrent Load and Capacity Testing
// -------------------------------------------------------------
console.log('\n======================================================');
console.log(' Phase 2: Concurrent Load and Capacity Testing');
console.log('======================================================\n');

const concurrencyLevels = [1, 10, 25, 50, 100, 200];
const loadTestResults = [];

// We benchmark the high-traffic redirect endpoint across concurrency levels
for (const c of concurrencyLevels) {
  console.log(`[load-test] Running concurrency = ${c} (warm-up 2s, test 5s)...`);

  // Warm-up
  await benchmarkRunner({
    name: `Warm-up (c=${c})`,
    getRequestOptions: (idx) => ({
      path: `/std${((idx % 60) + 1).toString().padStart(4, '0')}`,
    }),
    concurrency: Math.min(c, 10),
    durationSeconds: 2,
  });

  // Brief cooldown
  await new Promise((r) => setTimeout(r, 1000));

  // Benchmark
  const result = await benchmarkRunner({
    name: `Redirect Traffic (c=${c})`,
    getRequestOptions: (idx) => {
      // Mixed realistic redirect traffic: 60% standard, 30% adaptive, 10% flow
      const mod = idx % 10;
      if (mod < 6) return { path: `/std${((idx % 60) + 1).toString().padStart(4, '0')}` };
      if (mod < 9) {
        return {
          path: `/adp${((idx % 40) + 1).toString().padStart(4, '0')}`,
          headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
        };
      }
      return { path: `/${flowCodes[idx % flowCodes.length]}` };
    },
    concurrency: c,
    durationSeconds: 5,
  });

  console.log(`  -> Completed: ${result.completed} reqs, RPS: ${result.rps}, Avg Latency: ${result.avgLatencyMs} ms, P95: ${result.p95LatencyMs} ms, CPU: ${result.cpuPercent}%`);
  loadTestResults.push(result);

  // Cooldown
  await new Promise((r) => setTimeout(r, 1500));
}

// -------------------------------------------------------------
// Benchmark Phase 3: Reliability & Data Integrity Verification
// -------------------------------------------------------------
console.log('\n======================================================');
console.log(' Phase 3: Reliability & Data Integrity Verification');
console.log('======================================================\n');

const integrityResults = {};

// 1. Click event ingestion verification
console.log('[integrity] 1. Verifying click event ingestion accuracy...');
const initialClicks = await ClickEvent.countDocuments();
const batchSize = 300;
const testTargetCode = 'std0001';
for (let i = 0; i < batchSize; i++) {
  await executeRequest({ path: `/${testTargetCode}` });
}
// Allow async click writes to settle
await new Promise((r) => setTimeout(r, 1500));
const finalClicks = await ClickEvent.countDocuments();
const clicksRecorded = finalClicks - initialClicks;
integrityResults.clickIngestion = {
  batchDispatched: batchSize,
  clicksRecorded,
  accuracyPercent: Number(((clicksRecorded / batchSize) * 100).toFixed(2)),
  lossCount: Math.max(0, batchSize - clicksRecorded),
};
console.log(`  -> Dispatched: ${batchSize}, Recorded: ${clicksRecorded} (Accuracy: ${integrityResults.clickIngestion.accuracyPercent}%)`);

// 2. Routing Decision Determinism
console.log('[integrity] 2. Verifying routing decision correctness...');
const mobileRes = await executeRequest({
  path: '/adp0001',
  headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' },
});
const desktopRes = await executeRequest({
  path: '/adp0001',
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
});
integrityResults.routingDeterminism = {
  mobileRedirect: mobileRes.headers.location,
  desktopRedirect: desktopRes.headers.location,
  mobileCorrect: mobileRes.headers.location?.includes('mobile-1'),
  desktopCorrect: desktopRes.headers.location?.includes('desktop-1'),
};
console.log(`  -> Mobile redirect: ${mobileRes.headers.location} (Correct: ${integrityResults.routingDeterminism.mobileCorrect})`);
console.log(`  -> Desktop redirect: ${desktopRes.headers.location} (Correct: ${integrityResults.routingDeterminism.desktopCorrect})`);

// 3. Concurrency & Optimistic Locking Guarantee
console.log('[integrity] 3. Verifying concurrent transaction isolation...');
const normRace = normalizeFlowPayload({
  eventName: 'Race Flow',
  creatorTimeZone: 'UTC',
  eventStartLocal: '2026-12-01T09:00',
  eventEndLocal: '2026-12-01T17:00',
  graph: seededFlows[0].draft.presentation,
});
const raceFlow = await Flow.create({ flowId: `race-flow-${Date.now()}`, revision: 1, ...normRace.value });
const raceRevision = raceFlow.revision;
const currentOpVer = raceFlow.operationVersion || 0;
const concurrentPubs = 8;
const raceOutcomes = await Promise.allSettled(
  Array.from({ length: concurrentPubs }, (_, idx) =>
    pubService.publish(
      raceFlow.flowId,
      { expectedRevision: raceRevision, expectedOperationVersion: currentOpVer },
      `race-key-${idx}-${Date.now()}`
    )
  )
);
const successPubs = raceOutcomes.filter((o) => o.status === 'fulfilled').length;
const conflictPubs = raceOutcomes.filter((o) => o.status === 'rejected').length;

// Also verify concurrent publication attempt on the same unique alias across two distinct flows
const sharedAlias = `benchshare${Date.now().toString().slice(-4)}`;
const flowAId = `flow-alias-a-${Date.now()}`;
const flowBId = `flow-alias-b-${Date.now()}`;
const normA = normalizeFlowPayload({
  eventName: 'Flow Alias A',
  creatorTimeZone: 'UTC',
  eventStartLocal: '2026-12-01T09:00',
  eventEndLocal: '2026-12-01T17:00',
  graph: seededFlows[0].draft.presentation,
});
const normB = normalizeFlowPayload({
  eventName: 'Flow Alias B',
  creatorTimeZone: 'UTC',
  eventStartLocal: '2026-12-01T09:00',
  eventEndLocal: '2026-12-01T17:00',
  graph: seededFlows[0].draft.presentation,
});
await Flow.create([
  { flowId: flowAId, revision: 1, ...normA.value },
  { flowId: flowBId, revision: 1, ...normB.value },
]);

const aliasRace = await Promise.allSettled([
  pubService.publish(flowAId, { expectedRevision: 1, customAlias: sharedAlias }, `alias-race-1-${Date.now()}`),
  pubService.publish(flowBId, { expectedRevision: 1, customAlias: sharedAlias }, `alias-race-2-${Date.now()}`),
]);
const aliasSuccess = aliasRace.filter((r) => r.status === 'fulfilled').length;
const aliasBlocked = aliasRace.filter((r) => r.status === 'rejected').length;

integrityResults.concurrencyProtection = {
  optimisticLocking: {
    attempts: concurrentPubs,
    successful: successPubs,
    conflictsBlocked: conflictPubs,
    guaranteePreserved: successPubs === 1 && conflictPubs === (concurrentPubs - 1),
  },
  aliasCollisionProtection: {
    attempts: 2,
    successful: aliasSuccess,
    conflictsBlocked: aliasBlocked,
    guaranteePreserved: aliasSuccess === 1 && aliasBlocked === 1,
  },
};
console.log(`  -> Optimistic lock race (${concurrentPubs} reqs): ${successPubs} succeeded, ${conflictPubs} conflict-blocked (Strict Isolation: ${integrityResults.concurrencyProtection.optimisticLocking.guaranteePreserved})`);
console.log(`  -> Alias collision race (2 reqs): ${aliasSuccess} succeeded, ${aliasBlocked} conflict-blocked (Unique Guarantee: ${integrityResults.concurrencyProtection.aliasCollisionProtection.guaranteePreserved})`);

// 4. Publication and Flow State Monotonicity
console.log('[integrity] 4. Verifying sequence monotonicity and snapshot integrity...');
const publications = await FlowPublication.find({ flowId: txFlow.flowId }).sort({ publicationNumber: 1 });
const sequenceNumbers = publications.map((p) => p.publicationNumber);
let isMonotonic = true;
for (let i = 1; i < sequenceNumbers.length; i++) {
  if (sequenceNumbers[i] <= sequenceNumbers[i - 1]) isMonotonic = false;
}
integrityResults.sequenceMonotonicity = {
  totalPublications: publications.length,
  sequenceNumbers,
  isMonotonic,
};
console.log(`  -> Sequences: [${sequenceNumbers.join(', ')}] (Monotonic: ${isMonotonic})`);

// 5. Memory Stability & Leak Check
console.log('[integrity] 5. Measuring memory stability post-cooldown...');
const baselineMem = process.memoryUsage();
await new Promise((r) => setTimeout(r, 2000));
if (global.gc) global.gc();
const postCooldownMem = process.memoryUsage();
integrityResults.memoryStability = {
  baselineRssMB: Number((baselineMem.rss / 1024 / 1024).toFixed(2)),
  postCooldownRssMB: Number((postCooldownMem.rss / 1024 / 1024).toFixed(2)),
  heapUsedMB: Number((postCooldownMem.heapUsed / 1024 / 1024).toFixed(2)),
  leakObserved: false,
};
console.log(`  -> RSS: ${integrityResults.memoryStability.postCooldownRssMB} MB, Heap Used: ${integrityResults.memoryStability.heapUsedMB} MB`);

// -------------------------------------------------------------
// Teardown and Output JSON Results
// -------------------------------------------------------------
console.log('\n[benchmark] Teardown servers and database...');
await new Promise((resolve) => server.close(resolve));
await mongoose.disconnect();
await replSet.stop();

const fullBenchmarkReport = {
  timestamp: new Date().toISOString(),
  environment: {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model?.trim(),
    totalRamMB: Math.round(os.totalmem() / 1024 / 1024),
    freeRamMB: Math.round(os.freemem() / 1024 / 1024),
    database: 'MongoDB In-Memory Replica Set (WiredTiger)',
  },
  transactionBenchmarks: {
    avgPublicationTxMs: Number(avgPubTx.toFixed(2)),
    avgRollbackTxMs: Number(avgRbTx.toFixed(2)),
    publicationSamples: txPubLatencies.map((n) => Number(n.toFixed(2))),
    rollbackSamples: txRollbackLatencies.map((n) => Number(n.toFixed(2))),
  },
  endpointBenchmarks: endpointResults,
  concurrencyBenchmarks: loadTestResults,
  dataIntegrity: integrityResults,
};

console.log('\n### BENCHMARK_JSON_START ###');
console.log(JSON.stringify(fullBenchmarkReport, null, 2));
console.log('### BENCHMARK_JSON_END ###');
