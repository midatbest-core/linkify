import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildLinkAnalyticsPipeline, buildOverviewAnalyticsPipeline } from '../src/services/analyticsService.js';
import { parseDateRange } from '../src/utils/dateRange.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Mongo verification not run: MONGODB_URI is not configured.');
  process.exit(1);
}

let connection;
try {
  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
  connection = mongoose.connection;
  const links = connection.db.collection('links');
  const clickEvents = connection.db.collection('clickEvents');
  const sessionCollectionExists = await connection.db.listCollections({ name: 'adminSessions' }, { nameOnly: true }).hasNext();
  const sessionIndexes = sessionCollectionExists ? await connection.db.collection('adminSessions').indexes() : [];
  const [linkIndexes, clickIndexes, page, totalLinks] = await Promise.all([
    links.indexes(), clickEvents.indexes(), links.find({}).sort({ createdAt: -1 }).skip(0).limit(5).toArray(), links.countDocuments({}),
  ]);
  const shortCodeUniqueIndex = linkIndexes.some((index) => index.key?.shortCode === 1 && index.unique === true);
  const clickEventCompoundIndex = clickIndexes.some((index) => index.key?.linkId === 1 && index.key?.clickedAt === -1);
  const clickEventTtlIndex = clickIndexes.some((index) => index.key?.clickedAt === 1 && index.expireAfterSeconds === 365 * 24 * 60 * 60);
  const adminSessionTtlIndex = sessionIndexes.some((index) => index.key?.expiresAt === 1 && index.expireAfterSeconds === 0);
  const range = parseDateRange({});
  await clickEvents.aggregate(buildOverviewAnalyticsPipeline(range), { allowDiskUse: true }).toArray();
  let linkGeographicAggregationExecuted = false;
  if (page[0]?._id) {
    await clickEvents.aggregate(buildLinkAnalyticsPipeline(page[0]._id, range), { allowDiskUse: true }).toArray();
    linkGeographicAggregationExecuted = true;
  }
  let liveExercise = null;
  if (process.argv.includes('--exercise')) liveExercise = await runLiveExercise();
  console.log(JSON.stringify({
    connected: true,
    atlasUri: /^mongodb\+srv:\/\//i.test(uri) || /mongodb\.net/i.test(uri),
    shortCodeUniqueIndex,
    clickEventCompoundIndex,
    clickEventTtlIndex,
    adminSessionCollectionExists: sessionCollectionExists,
    adminSessionTtlIndex,
    overviewGeographicAggregationExecuted: true,
    linkGeographicAggregationExecuted,
    dateRangeAggregationExecuted: true,
    linkPaginationQueryExecuted: true,
    linksPresent: totalLinks > 0,
    ...(liveExercise ? { liveExercise } : {}),
  }, null, 2));
} catch (error) {
  const atlasUri = /^mongodb\+srv:\/\//i.test(uri) || /mongodb\.net/i.test(uri);
  console.error(`Mongo verification failed (${error.name ?? 'Error'}; Atlas URI: ${atlasUri ? 'yes' : 'no'}). URI and server details were suppressed.`);
  process.exitCode = 1;
} finally {
  await connection?.close().catch(() => {});
}

async function runLiveExercise() {
  const [{ default: Link }, { default: ClickEvent }, { default: AdminSession }, { createApp }, { isValidAdminPasswordHash }] = await Promise.all([
    import('../src/models/Link.js'), import('../src/models/ClickEvent.js'), import('../src/models/AdminSession.js'),
    import('../src/app.js'), import('../src/middleware/adminAuth.js'),
  ]);
  const fixtureUsername = 'atlas-audit';
  const fixturePassword = randomBytes(32).toString('base64url');
  const fixtureSalt = randomBytes(16);
  const fixturePasswordHash = `scrypt$${fixtureSalt.toString('base64url')}$${scryptSync(fixturePassword, fixtureSalt, 64).toString('base64url')}`;
  const fixtureCredentialVersion = createHash('sha256').update(`${fixtureUsername}\0${fixturePasswordHash}`).digest('hex');
  assert.equal(isValidAdminPasswordHash(fixturePasswordHash), true);
  const marker = `atlas-audit-${randomBytes(8).toString('hex')}`;
  const firstCode = randomBytes(8).toString('hex').slice(0, 7);
  const secondCode = randomBytes(8).toString('hex').slice(0, 7);
  const linkIds = [];
  const sessionHashes = [];
  let server;
  try {
    const first = await Link.create({ shortCode: firstCode, originalUrl: 'https://example.invalid/atlas-audit', title: `${marker}-first`, status: 'active' });
    linkIds.push(first._id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await Link.create({ shortCode: secondCode, originalUrl: 'https://example.invalid/atlas-audit', title: `${marker}-second`, status: 'active' });
    linkIds.push(second._id);

    const app = createApp({
      linkModel: Link, clickEventModel: ClickEvent, sessionModel: AdminSession,
      adminUsername: fixtureUsername, adminPasswordHash: fixturePasswordHash,
      clientOrigin: 'https://atlas-audit.invalid', trustProxyHops: '0', production: true,
      logger: { error() {} },
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const request = (path, { cookie, origin = 'https://atlas-audit.invalid', ...options } = {}) => fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { origin, ...(cookie ? { cookie } : {}), ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) },
    });

    const anonymous = await request('/api/links');
    assert.equal(anonymous.status, 401);
    const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: fixtureUsername, password: fixturePassword }) });
    assert.equal(login.status, 200);
    let cookieHeader = login.headers.get('set-cookie');
    assert.ok(cookieHeader);
    let cookie = cookieHeader.split(';')[0];
    const tokenHash = (value) => createHash('sha256').update(decodeURIComponent(value.slice(value.indexOf('=') + 1))).digest('hex');
    sessionHashes.push(tokenHash(cookie));
    assert.match(cookieHeader, /HttpOnly/);
    assert.match(cookieHeader, /Secure/);
    assert.match(cookieHeader, /SameSite=None/);
    assert.equal(login.headers.get('access-control-allow-origin'), 'https://atlas-audit.invalid');
    assert.equal(login.headers.get('access-control-allow-credentials'), 'true');
    const sessionIndexes = await AdminSession.collection.indexes();
    const sessionTtlIndex = sessionIndexes.some((index) => index.key?.expiresAt === 1 && index.expireAfterSeconds === 0);
    assert.equal(sessionTtlIndex, true);
    await AdminSession.updateOne({ tokenHash: tokenHash(cookie) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const expiredSession = await request('/api/analytics/overview', { cookie });
    assert.equal(expiredSession.status, 401);
    const relogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: fixtureUsername, password: fixturePassword }) });
    assert.equal(relogin.status, 200);
    cookieHeader = relogin.headers.get('set-cookie');
    assert.ok(cookieHeader);
    cookie = cookieHeader.split(';')[0];
    sessionHashes.push(tokenHash(cookie));

    const foreignWrite = await request('/api/links', { cookie, origin: 'https://attacker.invalid', method: 'POST', body: JSON.stringify({ originalUrl: 'https://example.invalid' }) });
    assert.equal(foreignWrite.status, 403);
    assert.equal(foreignWrite.headers.get('access-control-allow-origin'), null);
    assert.equal(foreignWrite.headers.get('access-control-allow-credentials'), null);
    const health = await request('/api/health');
    assert.equal(health.status, 200);

    const today = new Date();
    const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const yesterday = new Date(todayStart.getTime() - 12 * 60 * 60 * 1000);
    await ClickEvent.create([
      { linkId: first._id, clickedAt: new Date(todayStart.getTime() + 60000), countryName: 'United States', countryCode: 'US', region: 'California' },
      { linkId: first._id, clickedAt: new Date(todayStart.getTime() + 120000), countryName: 'United States', countryCode: 'US', region: 'California' },
      { linkId: first._id, clickedAt: yesterday, countryName: 'France', countryCode: 'FR', region: null },
      { linkId: second._id, clickedAt: new Date(todayStart.getTime() + 180000), countryName: 'India', countryCode: 'IN', region: 'Karnataka' },
    ]);

    const redirect = await request(`/${firstCode}`, { redirect: 'manual', headers: { 'user-agent': 'Atlas Audit Test Agent/1.0' } });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), 'https://example.invalid/atlas-audit');
    const deadline = Date.now() + 5000;
    let firstEvents = [];
    while (Date.now() < deadline) {
      firstEvents = await ClickEvent.find({ linkId: first._id }).lean();
      if (firstEvents.length === 4) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(firstEvents.length, 4);
    assert.ok(firstEvents.every((event) => !Object.hasOwn(event, 'ip') && !Object.hasOwn(event, 'userAgent')));

    const date = todayStart.toISOString().slice(0, 10);
    const linkAnalyticsResponse = await request(`/api/links/${first._id}/analytics?from=${date}&to=${date}`, { cookie });
    assert.equal(linkAnalyticsResponse.status, 200);
    const linkAnalytics = (await linkAnalyticsResponse.json()).analytics;
    assert.equal(linkAnalytics.totalClicks, 4);
    assert.equal(linkAnalytics.clicksInRange, 3);
    assert.equal(linkAnalytics.countries.find((row) => row.countryCode === 'US')?.clicks, 2);
    assert.equal(linkAnalytics.regions.find((row) => row.region === 'California')?.clicks, 2);
    const overviewResponse = await request(`/api/analytics/overview?from=${date}&to=${date}`, { cookie });
    assert.equal(overviewResponse.status, 200);

    const list = async (query) => {
      const response = await request(`/api/links?${new URLSearchParams({ q: marker, limit: '1', ...query })}`, { cookie });
      assert.equal(response.status, 200);
      return response.json();
    };
    const oldest = await list({ sort: 'createdAt', order: 'asc', page: '1' });
    const secondPage = await list({ sort: 'createdAt', order: 'asc', page: '2' });
    const newest = await list({ sort: 'createdAt', order: 'desc', page: '1' });
    assert.equal(oldest.pagination.total, 2);
    assert.equal(oldest.links[0].id, String(first._id));
    assert.equal(secondPage.links[0].id, String(second._id));
    assert.equal(newest.links[0].id, String(second._id));
    const clickSorted = await list({ sort: 'clicks', order: 'desc', page: '1' });
    const clickSortedAscending = await list({ sort: 'clicks', order: 'asc', page: '1' });
    assert.equal(clickSorted.links[0].id, String(first._id));
    assert.equal(clickSorted.links[0].clickCount, 4);
    assert.equal(clickSortedAscending.links[0].id, String(second._id));

    const archived = await request(`/api/links/${first._id}`, { cookie, method: 'PATCH', body: JSON.stringify({ status: 'archived' }) });
    assert.equal(archived.status, 200);
    const archivedRedirect = await request(`/${firstCode}`, { redirect: 'manual' });
    assert.equal(archivedRedirect.status, 410);
    const restored = await request(`/api/links/${first._id}`, { cookie, method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
    assert.equal(restored.status, 200);
    const activeRedirect = await request(`/${firstCode}`, { redirect: 'manual' });
    assert.equal(activeRedirect.status, 302);

    const logout = await request('/api/auth/logout', { cookie, method: 'POST' });
    assert.equal(logout.status, 200);
    const afterLogout = await request('/api/analytics/overview', { cookie });
    assert.equal(afterLogout.status, 401);
    return {
      temporaryLinksCleaned: true,
      realClickInserted: true,
      realLinkAndOverviewAggregations: true,
      countryAndDateFiltering: true,
      paginationAndBothSortModes: true,
      archiveRestoreAndRedirects: true,
      originCorsAndMongoSessionLifecycle: true,
      realSessionExpiration: true,
      adminCredentialsWereEphemeral: true,
    };
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (linkIds.length) await ClickEvent.deleteMany({ linkId: { $in: linkIds } });
    if (linkIds.length) await Link.deleteMany({ _id: { $in: linkIds } });
    await AdminSession.deleteMany({ $or: [
      ...(sessionHashes.length ? [{ tokenHash: { $in: sessionHashes } }] : []),
      { credentialVersion: fixtureCredentialVersion },
    ] });
    assert.equal(await Link.countDocuments({ _id: { $in: linkIds } }), 0);
    assert.equal(await ClickEvent.countDocuments({ linkId: { $in: linkIds } }), 0);
    assert.equal(await AdminSession.countDocuments({ credentialVersion: fixtureCredentialVersion }), 0);
  }
}
