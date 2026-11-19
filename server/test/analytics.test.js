import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { buildLinkAnalyticsPipeline } from '../src/services/analyticsService.js';
import { parseDateRange } from '../src/utils/dateRange.js';
import { classifyClickRequest } from '../src/utils/clickClassification.js';
import { appendUtmParameters } from '../src/utils/utm.js';
import ClickEvent from '../src/models/ClickEvent.js';
import Link from '../src/models/Link.js';

const LINK_ID = '64b000000000000000000001';
const link = { _id: LINK_ID, id: LINK_ID, shortCode: 'hello1', originalUrl: 'https://example.com', status: 'active', createdAt: new Date('2025-01-01T00:00:00Z'), title: 'Example', tags: ['docs'] };
let events;
let analyticsFailure;
let loggerMessages;
let appServer;
let baseUrl;
let aggregateResult;
let lastPipeline;

const linkModel = {
  async findOne({ shortCode }) { return shortCode === link.shortCode ? link : null; },
  async findById(id) { return id === LINK_ID ? link : null; },
  find() { return { sort() { return { limit: async () => [link] }; } }; },
};
const clickEventModel = {
  collection: { name: 'clickEvents' },
  async create(record) { if (analyticsFailure) throw new Error('analytics unavailable'); events.push(record); return record; },
  async deleteMany({ linkId }) { const before = events.length; events = events.filter((event) => String(event.linkId) !== String(linkId)); return { deletedCount: before - events.length }; },
  async aggregate(pipeline) { lastPipeline = pipeline; return aggregateResult; },
};

before(async () => {
  events = [];
  loggerMessages = [];
  appServer = createApp({ linkModel, clickEventModel, logger: { error: (message) => loggerMessages.push(message) } }).listen(0);
  await new Promise((resolve) => appServer.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => new Promise((resolve, reject) => appServer.close((error) => error ? reject(error) : resolve())));

test('records a click, normalized referrer, and estimated request classifications', async () => {
  analyticsFailure = false;
  const response = await fetch(`${baseUrl}/${link.shortCode}`, { headers: {
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    referer: 'https://news.example/story?reader=private',
  }, redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), link.originalUrl);
  assert.equal(events.at(-1).linkId, LINK_ID);
  assert.equal(events.at(-1).referrer, 'news.example');
  assert.equal(events.at(-1).deviceType, 'mobile');
  assert.equal(events.at(-1).browser, 'Safari');
  assert.equal(events.at(-1).operatingSystem, 'iOS');
  assert.equal(Object.hasOwn(events.at(-1), 'ip'), false);
  assert.equal(loggerMessages.length, 0);
});

test('records safely when user agent or referrer is absent or malformed', async () => {
  const response = await fetch(`${baseUrl}/${link.shortCode}`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.deepEqual(classifyClickRequest({ userAgent: null, referrer: 'not a url' }), {
    referrer: null, deviceType: 'unknown', browser: 'unknown', operatingSystem: 'unknown', isBot: false,
  });
  assert.equal(events.at(-1).referrer, null);
  assert.equal(events.at(-1).deviceType, 'unknown');
});

test('estimates common bot traffic without fingerprinting', () => {
  const classified = classifyClickRequest({ userAgent: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' });
  assert.equal(classified.isBot, true);
  assert.equal(classified.deviceType, 'unknown');
  assert.equal(classifyClickRequest({ userAgent: 'Googlebot/2.1' }).isBot, true);
});

test('analytics and link models declare the query and retention indexes', () => {
  const clickIndexes = ClickEvent.schema.indexes();
  assert.ok(clickIndexes.some(([keys]) => keys.linkId === 1 && keys.clickedAt === -1));
  assert.ok(clickIndexes.some(([keys, options]) => keys.clickedAt === 1 && options.expireAfterSeconds === 365 * 24 * 60 * 60));
  assert.ok(Link.schema.indexes().some(([keys]) => keys.createdAt === -1));
});

test('analytics write failure is logged and does not block the redirect', async () => {
  analyticsFailure = true;
  const response = await fetch(`${baseUrl}/${link.shortCode}`, { redirect: 'manual' });
  analyticsFailure = false;
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), link.originalUrl);
  assert.match(loggerMessages[0], /analytics.*recording failed/);
});

test('archived links return 410 and do not add click events', async () => {
  const wasActive = link.status;
  link.status = 'archived';
  const beforeCount = events.length;
  const response = await fetch(`${baseUrl}/${link.shortCode}`, { redirect: 'manual' });
  link.status = wasActive;
  assert.equal(response.status, 410);
  assert.equal(events.length, beforeCount);
});

test('date filters use inclusive UTC calendar days and reject invalid or oversized ranges', () => {
  const range = parseDateRange({ from: '2025-03-01', to: '2025-03-07' });
  assert.equal(range.from.toISOString(), '2025-03-01T00:00:00.000Z');
  assert.equal(range.toExclusive.toISOString(), '2025-03-08T00:00:00.000Z');
  assert.throws(() => parseDateRange({ from: '2025-02-30' }), { status: 400 });
  assert.throws(() => parseDateRange({ from: '2024-01-01', to: '2025-01-02' }), { status: 400 });
});

test('link analytics API returns metrics and builds indexed date-group aggregation', async () => {
  aggregateResult = [{
    totals: [{ totalClicks: 19, clicksToday: 2, clicksLast7Days: 7, clicksLast30Days: 12 }],
    selectedTotal: [{ count: 5 }], daily: [{ _id: '2025-03-03', count: 5 }],
    devices: [{ _id: 'mobile', count: 4 }], browsers: [{ _id: 'Safari', count: 3 }],
    operatingSystems: [{ _id: 'iOS', count: 3 }], referrers: [{ _id: 'news.example', count: 4 }],
    bots: [{ _id: true, count: 1 }, { _id: false, count: 4 }],
  }];
  const response = await fetch(`${baseUrl}/api/links/${LINK_ID}/analytics?from=2025-03-01&to=2025-03-07`);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.analytics.totalClicks, 19);
  assert.equal(data.analytics.clicksInRange, 5);
  assert.equal(data.analytics.dailyClicks.length, 7);
  assert.equal(data.analytics.dailyClicks.find((row) => row._id === '2025-03-01').count, 0);
  assert.deepEqual(data.analytics.deviceBreakdown, { mobile: 4 });
  assert.deepEqual(data.analytics.botBreakdown, { bots: 1, nonBots: 4, estimated: true });
  const dailyFacet = lastPipeline[1].$facet.daily;
  assert.deepEqual(dailyFacet[0].$match.clickedAt, { $gte: new Date('2025-03-01T00:00:00Z'), $lt: new Date('2025-03-08T00:00:00Z') });
  assert.equal(dailyFacet[1].$group._id.$dateToString.timezone, 'UTC');
});

test('analytics endpoints handle invalid IDs, missing links, and malformed date ranges', async () => {
  const invalid = await fetch(`${baseUrl}/api/links/nope/analytics`);
  assert.equal(invalid.status, 400);
  const missing = await fetch(`${baseUrl}/api/links/64b000000000000000000099/analytics`);
  assert.equal(missing.status, 404);
  const badDate = await fetch(`${baseUrl}/api/links/${LINK_ID}/analytics?from=yesterday`);
  assert.equal(badDate.status, 400);
  const malformedRange = await fetch(`${baseUrl}/api/analytics/overview?from=2025-02-01&to=2025-01-31`);
  assert.equal(malformedRange.status, 400);
});

test('overview returns date-bounded summaries, top links, and recent links', async () => {
  aggregateResult = [{ totals: [{ count: 8 }], daily: [{ _id: '2025-03-05', count: 8 }], devices: [{ _id: 'desktop', count: 5 }], referrers: [{ _id: 'newsletter.example', count: 4 }], topLinks: [{ linkId: LINK_ID, shortCode: link.shortCode, clicks: 8 }] }];
  const response = await fetch(`${baseUrl}/api/analytics/overview?from=2025-03-01&to=2025-03-31`);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.analytics.totalClicks, 8);
  assert.equal(data.analytics.dailyClicks.length, 31);
  assert.equal(data.analytics.range.timezone, 'UTC');
  assert.equal(data.analytics.topLinks[0].shortCode, link.shortCode);
  assert.equal(data.analytics.recentlyCreatedLinks[0].id, LINK_ID);
  const selectedRange = lastPipeline[0].$match.clickedAt;
  assert.deepEqual(selectedRange, { $gte: new Date('2025-03-01T00:00:00Z'), $lt: new Date('2025-04-01T00:00:00Z') });
});

test('UTM builder preserves existing parameters and fragments, encodes values, and reports conflicts', () => {
  const result = appendUtmParameters('https://example.test/path?keep=yes&utm_source=old#section', {
    utm_source: 'new source', utm_medium: 'email & updates', utm_campaign: 'spring sale',
  });
  const resultUrl = new URL(result.url);
  assert.equal(resultUrl.searchParams.get('keep'), 'yes');
  assert.equal(resultUrl.searchParams.get('utm_source'), 'old');
  assert.equal(resultUrl.searchParams.get('utm_medium'), 'email & updates');
  assert.equal(resultUrl.hash, '#section');
  assert.deepEqual(result.conflicts, ['utm_source']);
});
