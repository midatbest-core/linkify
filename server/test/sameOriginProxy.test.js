import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createTestAuth } from './testAuth.js';

const FRONTEND_ORIGIN = 'https://linkify-3jnh.vercel.app';
const RENDER_ORIGIN = 'https://linkify-whvp.onrender.com';
const LINK_ID = '64b000000000000000000001';
async function loadVercelConfig(environment) {
  const previousEnvironment = process.env.VERCEL_ENV;
  if (environment === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = environment;
  try {
    return (await import(`../../vercel.mjs?environment=${environment ?? 'unset'}`)).config;
  } finally {
    if (previousEnvironment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnvironment;
  }
}

const links = new Map();
const linkModel = {
  async exists({ shortCode }) { return links.has(shortCode) ? { _id: LINK_ID } : null; },
  async findOne({ shortCode }) { return links.get(shortCode) ?? null; },
  async create(record) {
    const saved = { ...record, _id: LINK_ID, id: LINK_ID, createdAt: new Date(), status: 'active' };
    links.set(saved.shortCode, saved);
    return saved;
  },
  async findById(id) { return id === LINK_ID ? [...links.values()][0] ?? null : null; },
  async findByIdAndUpdate(id, update) {
    const saved = id === LINK_ID ? [...links.values()][0] : null;
    if (!saved) return null;
    Object.assign(saved, update.$set);
    return saved;
  },
  find() {
    const query = { sort() { return query; }, async limit() { return [...links.values()]; } };
    return query;
  },
};

const clickEventModel = {
  collection: { name: 'clickEvents' },
  async create(record) { return record; },
  async aggregate(pipeline) {
    if (pipeline[0]?.$match?.linkId) {
      return [{ totals: [{ totalClicks: 1, clicksToday: 1, clicksLast7Days: 1, clicksLast30Days: 1 }], selectedTotal: [{ count: 1 }], daily: [], devices: [], browsers: [], operatingSystems: [], referrers: [], countries: [], regions: [], bots: [] }];
    }
    return [{ totals: [{ count: 1 }], daily: [], devices: [], countries: [], regions: [], referrers: [], topLinks: [] }];
  },
};

let backendServer;
let proxyServer;
let backendOrigin;
let proxyOrigin;
let previousShortBaseUrl;
const forwardedRequests = [];

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

before(async () => {
  previousShortBaseUrl = process.env.SHORT_BASE_URL;
  process.env.SHORT_BASE_URL = RENDER_ORIGIN;
  links.clear();
  const auth = createTestAuth();
  backendServer = createApp({ ...auth, clientOrigin: FRONTEND_ORIGIN, production: true, linkModel, clickEventModel }).listen(0);
  await new Promise((resolve) => backendServer.once('listening', resolve));
  backendOrigin = `http://127.0.0.1:${backendServer.address().port}`;

  proxyServer = createServer(async (request, response) => {
    if (!request.url.startsWith('/api/')) {
      response.writeHead(404).end();
      return;
    }
    forwardedRequests.push({ url: request.url, origin: request.headers.origin, cookie: request.headers.cookie });
    try {
      const body = ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? undefined : await readRequestBody(request);
      const forwardedHeaders = {};
      for (const name of ['origin', 'cookie', 'content-type', 'accept']) {
        if (request.headers[name]) forwardedHeaders[name] = request.headers[name];
      }
      const upstream = await fetch(`${backendOrigin}${request.url}`, {
        method: request.method,
        headers: forwardedHeaders,
        ...(body ? { body } : {}),
      });
      const headers = {};
      for (const name of ['content-type', 'cache-control', 'access-control-allow-origin', 'access-control-allow-credentials']) {
        const value = upstream.headers.get(name);
        if (value) headers[name] = value;
      }
      const cookie = upstream.headers.get('set-cookie');
      if (cookie) headers['set-cookie'] = cookie;
      response.writeHead(upstream.status, headers).end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      response.writeHead(502).end();
    }
  }).listen(0);
  await new Promise((resolve) => proxyServer.once('listening', resolve));
  proxyOrigin = `http://127.0.0.1:${proxyServer.address().port}`;
});

after(async () => {
  await Promise.all([backendServer, proxyServer].map((server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
  if (previousShortBaseUrl === undefined) delete process.env.SHORT_BASE_URL;
  else process.env.SHORT_BASE_URL = previousShortBaseUrl;
});

test('same-origin proxy preserves login sessions and protected Linkify operations', async () => {
  const productionConfig = await loadVercelConfig('production');
  assert.deepEqual(productionConfig.rewrites, [{ source: '/api/:path*', destination: `${RENDER_ORIGIN}/api/:path*` }]);
  assert.ok(productionConfig.headers.some(({ source, headers }) => source === '/api/:path*'
    && headers.some(({ key, value }) => key.toLowerCase() === 'cache-control' && value === 'no-store')
    && headers.some(({ key, value }) => key.toLowerCase() === 'x-vercel-enable-rewrite-caching' && value === '0')));

  for (const environment of ['preview', 'development', undefined]) {
    const config = await loadVercelConfig(environment);
    assert.deepEqual(config, {}, `${environment ?? 'unset'} deployments must not proxy to production`);
  }

  const request = (path, options = {}, cookie) => fetch(`${proxyOrigin}${path}`, {
    ...options,
    headers: { origin: FRONTEND_ORIGIN, ...(cookie ? { cookie } : {}), ...(options.headers ?? {}) },
  });
  const fixture = createTestAuth();
  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: fixture.adminUsername, password: 'test-password' }),
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Path=\//);
  assert.doesNotMatch(setCookie, /Domain=/i);
  const sessionCookie = setCookie.split(';')[0];

  const session = await request('/api/auth/session', {}, sessionCookie);
  assert.equal(session.status, 200);
  assert.equal((await session.json()).authenticated, true);
  assert.equal(forwardedRequests.at(-1).cookie, sessionCookie);

  const alias = await request('/api/aliases/spring-launch/availability', {}, sessionCookie);
  assert.equal(alias.status, 200);
  assert.equal((await alias.json()).available, true);

  const createdResponse = await request('/api/links', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ originalUrl: 'https://example.com/article', customAlias: 'spring-launch' }),
  }, sessionCookie);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(new URL(created.shortUrl).origin, RENDER_ORIGIN);

  const updatedResponse = await request(`/api/links/${created.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Updated through proxy' }),
  }, sessionCookie);
  assert.equal(updatedResponse.status, 200);
  assert.equal((await updatedResponse.json()).link.title, 'Updated through proxy');

  const overview = await request('/api/analytics/overview', {}, sessionCookie);
  assert.equal(overview.status, 200);
  assert.equal((await overview.json()).analytics.totalClicks, 1);
  const linkAnalytics = await request(`/api/links/${created.id}/analytics`, {}, sessionCookie);
  assert.equal(linkAnalytics.status, 200);
  assert.equal((await linkAnalytics.json()).analytics.totalClicks, 1);

  const foreignOrigin = await request('/api/links', {
    method: 'POST',
    headers: { origin: 'https://untrusted-preview.vercel.app', 'content-type': 'application/json' },
    body: JSON.stringify({ originalUrl: 'https://attacker.example', customAlias: 'foreign-link' }),
  }, sessionCookie);
  assert.equal(foreignOrigin.status, 403);
  assert.equal(links.has('foreign-link'), false);

  const directRedirect = await fetch(`${backendOrigin}/spring-launch`, { redirect: 'manual' });
  assert.equal(directRedirect.status, 302);
  assert.equal(directRedirect.headers.get('location'), 'https://example.com/article');
  const nonApiThroughProxy = await fetch(`${proxyOrigin}/spring-launch`, { redirect: 'manual' });
  assert.equal(nonApiThroughProxy.status, 404);
});
