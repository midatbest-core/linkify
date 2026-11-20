import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { createGeoLocator } from '../src/services/geoIpService.js';
import { buildLinkAnalyticsPipeline, formatLinkAnalytics } from '../src/services/analyticsService.js';
import { parseDateRange } from '../src/utils/dateRange.js';
import { classifyClickRequest } from '../src/utils/clickClassification.js';
import { appendUtmParameters } from '../src/utils/utm.js';
import ClickEvent from '../src/models/ClickEvent.js';
import Link from '../src/models/Link.js';
import { createTestAuth } from './testAuth.js';

const LINK_ID = '64b000000000000000000001';
const localDbPath = fileURLToPath(new URL('../data/dbip-city-lite-2026-11.mmdb', import.meta.url));
const link = { _id: LINK_ID, id: LINK_ID, shortCode: 'hello1', originalUrl: 'https://example.com', status: 'active', createdAt: new Date('2025-01-01T00:00:00Z'), title: 'Example', tags: ['docs'] };
let events;
let analyticsFailure;
let loggerMessages;
let appServer;
let baseUrl;
let aggregateResult;
let lastPipeline;
let auth;
let adminFetch;
let observedIp;
let geoLookupFailure = false;
let geoLookupResult = { countryName: 'Unknown', countryCode: null, region: null, cityName: null };

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
  auth = createTestAuth();
  appServer = createApp({ linkModel, clickEventModel, ...auth, trustProxyHops: '0', geoLocator: async (ip) => { observedIp = ip; if (geoLookupFailure) throw new Error('simulated local GeoIP reader failure'); return geoLookupResult; }, logger: { error: (message) => loggerMessages.push(message) } }).listen(0);
  await new Promise((resolve) => appServer.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${appServer.address().port}`;
  adminFetch = auth.fetch(baseUrl, await auth.login(baseUrl));
});

after(() => new Promise((resolve, reject) => appServer.close((error) => error ? reject(error) : resolve())));

test('records a click, normalized referrer, and estimated request classifications', async () => {
  analyticsFailure = false;
  const response = await fetch(`${baseUrl}/${link.shortCode}`, { headers: {
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    referer: 'https://news.example/story?reader=private',
  }, redirect: 'manual' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), link.originalUrl);
  assert.equal(events.at(-1).linkId, LINK_ID);
  assert.equal(events.at(-1).referrer, 'news.example');
  assert.equal(events.at(-1).deviceType, 'mobile');
  assert.equal(events.at(-1).browser, 'Safari');
  assert.equal(events.at(-1).operatingSystem, 'iOS');
  assert.equal(Object.hasOwn(events.at(-1), 'ip'), false);
  assert.equal(Object.hasOwn(events.at(-1), 'userAgent'), false);
  assert.equal(loggerMessages.length, 0);
});

test('records safely when user agent or referrer is absent or malformed', async () => {
  const response = await fetch(`${baseUrl}/${link.shortCode}`, { redirect: 'manual' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(response.status, 302);
  assert.deepEqual(classifyClickRequest({ userAgent: null, referrer: 'not a url' }), {
    referrer: null, deviceType: 'unknown', browser: 'unknown', operatingSystem: 'unknown', isBot: false,
  });
  assert.equal(events.at(-1).referrer, null);
  assert.equal(events.at(-1).deviceType, 'unknown');
});

test('persists real local MMDB country, city and region without persisting IP or raw user agent', { skip: !existsSync(localDbPath) }, async () => {
  events = [];
  const geoApp = createApp({
    linkModel, clickEventModel, ...auth, trustProxyHops: '1',
    geoLocator: createGeoLocator({ dbPath: localDbPath, logger: { warn: () => {} } }),
  });
  assert.equal(await geoApp.locals.initializeGeoIp(), true);
  const geoServer = geoApp.listen(0);
  await new Promise((resolve) => geoServer.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${geoServer.address().port}/${link.shortCode}`, {
      headers: { 'user-agent': 'Private Test Agent/1.0', 'x-forwarded-for': '203.0.113.99', 'cf-connecting-ip': '8.8.8.8' },
      redirect: 'manual',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(response.status, 302);
    assert.equal(events.at(-1).countryName, 'United States');
    assert.equal(events.at(-1).countryCode, 'US');
    assert.equal(events.at(-1).cityName, 'Mountain View');
    assert.equal(events.at(-1).region, 'California');
    assert.equal(Object.hasOwn(events.at(-1), 'ip'), false);
    assert.equal(Object.hasOwn(events.at(-1), 'userAgent'), false);
  } finally {
    await new Promise((resolve, reject) => geoServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('estimates common bot traffic without fingerprinting', () => {
  const classified = classifyClickRequest({ userAgent: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' });
  assert.equal(classified.isBot, true);
  assert.equal(classified.deviceType, 'unknown');
  assert.equal(classifyClickRequest({ userAgent: 'Googlebot/2.1' }).isBot, true);
});

test('analytics and link models declare the query and retention indexes', () => {
  const clickIndexes = ClickEvent.schema.indexes();
  assert.equal(ClickEvent.schema.path('cityName').instance, 'String');
  assert.equal(ClickEvent.schema.path('ip'), undefined);
  assert.equal(ClickEvent.schema.path('userAgent'), undefined);
  assert.ok(clickIndexes.some(([keys]) => keys.linkId === 1 && keys.clickedAt === -1));
  assert.ok(clickIndexes.some(([keys, options]) => keys.clickedAt === 1 && options.expireAfterSeconds === 365 * 24 * 60 * 60));
  assert.ok(Link.schema.indexes().some(([keys]) => keys.createdAt === -1));
});

test('analytics write failure is logged and does not block the redirect', async () => {
  analyticsFailure = true;
  const response = await fetch(`${baseUrl}/${link.shortCode}`, { redirect: 'manual' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  analyticsFailure = false;
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), link.originalUrl);
  assert.match(loggerMessages[0], /analytics.*recording failed/);
});

test('management APIs reject anonymous requests while health and redirects stay public', async () => {
  const unauthorized = await fetch(`${baseUrl}/api/links`);
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).code, 'AUTH_REQUIRED');
  const health = await fetch(`${baseUrl}/api/health`);
  assert.notEqual(health.status, 401);
  const redirect = await fetch(`${baseUrl}/${link.shortCode}`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
});

test('GeoIP ignores caller-supplied X-Forwarded-For when the trusted client-IP header is absent', async () => {
  await fetch(`${baseUrl}/${link.shortCode}`, { headers: { 'x-forwarded-for': '8.8.8.8' }, redirect: 'manual' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(observedIp, undefined);
});

test('GeoIP uses Render and Cloudflare single-address client IP header instead of the X-Forwarded-For chain', async () => {
  let trustedIp;
  const proxyApp = createApp({ linkModel, clickEventModel, ...auth, trustProxyHops: '1', geoLocator: async (ip) => { trustedIp = ip; return { countryName: 'Unknown', countryCode: null, region: null, cityName: null }; } });
  const proxyServer = proxyApp.listen(0);
  await new Promise((resolve) => proxyServer.once('listening', resolve));
  try {
    const proxyUrl = `http://127.0.0.1:${proxyServer.address().port}`;
    const response = await fetch(`${proxyUrl}/${link.shortCode}`, { headers: { 'x-forwarded-for': '203.0.113.99, 192.0.2.44', 'cf-connecting-ip': '8.8.8.8' }, redirect: 'manual' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(response.status, 302);
    assert.equal(trustedIp, '8.8.8.8');
  } finally {
    await new Promise((resolve, reject) => proxyServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('GeoIP lookup failure does not fail a public redirect', async () => {
  geoLookupFailure = true;
  const response = await fetch(`${baseUrl}/${link.shortCode}`, { redirect: 'manual' });
  geoLookupFailure = false;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), link.originalUrl);
  assert.match(loggerMessages.at(-1), /click recording failed/);
});

test('login rejects bad passwords, sessions expire, and logout invalidates a session', async () => {
  const wrong = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { origin: 'http://localhost:5174', 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test-admin', password: 'incorrect' }) });
  assert.equal(wrong.status, 401);
  const expiryCookie = await auth.login(baseUrl);
  const session = auth.sessions.at(-1);
  session.expiresAt = new Date(Date.now() - 1000);
  const expired = await fetch(`${baseUrl}/api/links`, { headers: { cookie: expiryCookie } });
  assert.equal(expired.status, 401);
  const activeCookie = await auth.login(baseUrl);
  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { origin: 'http://localhost:5174', cookie: activeCookie } });
  assert.equal(logout.status, 200);
  const afterLogout = await fetch(`${baseUrl}/api/links`, { headers: { cookie: activeCookie } });
  assert.equal(afterLogout.status, 401);
});

test('re-login rotates and invalidates the previous session ID', async () => {
  const firstCookie = await auth.login(baseUrl);
  const secondCookie = await auth.login(baseUrl, firstCookie);
  assert.notEqual(firstCookie, secondCookie);
  const oldSession = await fetch(`${baseUrl}/api/analytics/overview`, { headers: { cookie: firstCookie } });
  const newSession = await fetch(`${baseUrl}/api/analytics/overview`, { headers: { cookie: secondCookie } });
  assert.equal(oldSession.status, 401);
  assert.equal(newSession.status, 200);
});

test('mutating management requests reject missing or foreign Origin headers', async () => {
  const cookie = await auth.login(baseUrl);
  const foreign = await fetch(`${baseUrl}/api/links`, { method: 'POST', headers: { origin: 'https://attacker.example', cookie, 'content-type': 'application/json' }, body: JSON.stringify({ originalUrl: 'https://example.com' }) });
  assert.equal(foreign.status, 403);
  const missing = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { cookie } });
  assert.equal(missing.status, 403);
  const stillAuthenticated = await fetch(`${baseUrl}/api/analytics/overview`, { headers: { cookie } });
  assert.equal(stillAuthenticated.status, 200);
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
    destinations: [{ _id: { destinationId: 'rule:mobile-first', matchedRuleId: 'mobile-first', usedFallback: false }, clicks: 3 }, { _id: { destinationId: 'default', matchedRuleId: null, usedFallback: true }, clicks: 2 }],
    bots: [{ _id: true, count: 1 }, { _id: false, count: 4 }],
  }];
  const response = await adminFetch(`${baseUrl}/api/links/${LINK_ID}/analytics?from=2025-03-01&to=2025-03-07`);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.analytics.totalClicks, 19);
  assert.equal(data.analytics.clicksInRange, 5);
  assert.equal(data.analytics.dailyClicks.length, 7);
  assert.equal(data.analytics.dailyClicks.find((row) => row._id === '2025-03-01').count, 0);
  assert.deepEqual(data.analytics.deviceBreakdown, { mobile: 4 });
  assert.deepEqual(data.analytics.destinations, [
    { destinationId: 'rule:mobile-first', matchedRuleId: 'mobile-first', usedFallback: false, clicks: 3 },
    { destinationId: 'default', matchedRuleId: null, usedFallback: true, clicks: 2 },
  ]);
  assert.equal(data.analytics.fallbackClicks, 2);
  assert.deepEqual(data.analytics.ruleClicks, [{ ruleId: 'mobile-first', clicks: 3 }]);
  assert.ok(lastPipeline[1].$facet.destinations);
  assert.deepEqual(data.analytics.botBreakdown, { bots: 1, nonBots: 4, estimated: true });
  const dailyFacet = lastPipeline[1].$facet.daily;
  assert.deepEqual(dailyFacet[0].$match.clickedAt, { $gte: new Date('2025-03-01T00:00:00Z'), $lt: new Date('2025-03-08T00:00:00Z') });
  assert.equal(dailyFacet[1].$group._id.$dateToString.timezone, 'UTC');
});

test('destination aggregation retains legacy, adaptive fallback, and deleted-rule click attribution', () => {
  const pipeline = buildLinkAnalyticsPipeline(LINK_ID, parseDateRange({ from: '2025-03-01', to: '2025-03-07' }));
  const destinationGroup = pipeline[1].$facet.destinations[1].$group._id;
  assert.deepEqual(destinationGroup.destinationId, { $ifNull: ['$selectedDestinationId', 'default'] });
  assert.deepEqual(destinationGroup.usedFallback, { $ifNull: ['$usedFallback', true] });
  const analytics = formatLinkAnalytics([{ destinations: [
    { _id: { destinationId: 'default', matchedRuleId: null, usedFallback: true }, clicks: 2 },
    { _id: { destinationId: 'archived-destination-id', matchedRuleId: 'deleted-rule', usedFallback: false }, clicks: 3 },
    { _id: { destinationId: 'adaptive-default-id', matchedRuleId: null, usedFallback: true }, clicks: 4 },
  ] }], parseDateRange({ from: '2025-03-01', to: '2025-03-07' }));
  assert.equal(analytics.fallbackClicks, 6);
  assert.deepEqual(analytics.ruleClicks, [{ ruleId: 'deleted-rule', clicks: 3 }]);
  assert.equal(analytics.destinations.find((row) => row.destinationId === 'archived-destination-id').clicks, 3);
});

test('analytics endpoints handle invalid IDs, missing links, and malformed date ranges', async () => {
  const invalid = await adminFetch(`${baseUrl}/api/links/nope/analytics`);
  assert.equal(invalid.status, 400);
  const missing = await adminFetch(`${baseUrl}/api/links/64b000000000000000000099/analytics`);
  assert.equal(missing.status, 404);
  const badDate = await adminFetch(`${baseUrl}/api/links/${LINK_ID}/analytics?from=yesterday`);
  assert.equal(badDate.status, 400);
  const malformedRange = await adminFetch(`${baseUrl}/api/analytics/overview?from=2025-02-01&to=2025-01-31`);
  assert.equal(malformedRange.status, 400);
});

test('overview returns date-bounded summaries, top links, and recent links', async () => {
  aggregateResult = [{ totals: [{ count: 8 }], daily: [{ _id: '2025-03-05', count: 8 }], devices: [{ _id: 'desktop', count: 5 }], referrers: [{ _id: 'newsletter.example', count: 4 }], topLinks: [{ linkId: LINK_ID, shortCode: link.shortCode, clicks: 8 }] }];
  const response = await adminFetch(`${baseUrl}/api/analytics/overview?from=2025-03-01&to=2025-03-31`);
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
