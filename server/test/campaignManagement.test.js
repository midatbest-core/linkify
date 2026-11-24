import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hashLinkPassword,
  verifyLinkPassword,
  generateUnlockCookie,
  verifyUnlockCookie,
  checkUnlockRateLimit,
  recordUnlockAttempt,
  clearUnlockAttemptsForTest,
  normalizeAndValidateProtection,
  sanitizeProtectionForClient,
} from '../src/services/linkProtectionService.js';
import {
  normalizeAndValidateExperiments,
  selectVariant,
} from '../src/services/experimentService.js';
import { generateCsv } from '../src/utils/csvExport.js';
import { compileFlowToAdaptiveRouting } from '../src/services/flowCompiler.js';
import { normalizeFlowPayload } from '../src/services/flowService.js';

test('linkProtectionService: hashes and verifies passwords using scrypt', async () => {
  const password = 'SuperSecretPassword123!';
  const hash = await hashLinkPassword(password);
  assert.ok(hash.startsWith('scrypt:'));

  const valid = await verifyLinkPassword(password, hash);
  assert.equal(valid, true);

  const invalid = await verifyLinkPassword('WrongPassword', hash);
  assert.equal(invalid, false);

  const empty = await verifyLinkPassword('', hash);
  assert.equal(empty, false);
});

test('linkProtectionService: generates and verifies unlock cookie, invalidating on password change', async () => {
  const shortCode = 'camp01';
  const secret = 'test-signing-secret';
  const initialHash = await hashLinkPassword('pass1');
  const cookie = generateUnlockCookie(shortCode, initialHash, secret);

  // Valid cookie with matching passwordHash
  assert.equal(verifyUnlockCookie(shortCode, initialHash, cookie, secret), true);

  // Fails if password hash changes
  const newHash = await hashLinkPassword('pass2');
  assert.equal(verifyUnlockCookie(shortCode, newHash, cookie, secret), false);

  // Fails if shortCode does not match
  assert.equal(verifyUnlockCookie('otherCode', initialHash, cookie, secret), false);

  // Fails if tampered
  assert.equal(verifyUnlockCookie(shortCode, initialHash, cookie + 'tampered', secret), false);
});

test('linkProtectionService: enforces rate limiting on unlock attempts (5 attempts / 15m)', () => {
  clearUnlockAttemptsForTest();
  const ip = '192.168.1.100';
  const shortCode = 'rlCode';

  for (let i = 0; i < 4; i += 1) {
    const check = checkUnlockRateLimit(ip, shortCode);
    assert.equal(check.allowed, true);
    recordUnlockAttempt(ip, shortCode);
  }

  // 5th check allowed
  const fifthCheck = checkUnlockRateLimit(ip, shortCode);
  assert.equal(fifthCheck.allowed, true);
  recordUnlockAttempt(ip, shortCode);

  // 6th attempt blocked
  const blocked = checkUnlockRateLimit(ip, shortCode);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);

  // Different IP is still allowed
  assert.equal(checkUnlockRateLimit('192.168.1.101', shortCode).allowed, true);
  clearUnlockAttemptsForTest();
});

test('linkProtectionService: normalizes and validates protection configurations and hides password hash from client', async () => {
  // Enabled with valid fields
  const norm = await normalizeAndValidateProtection({
    enabled: true,
    password: 'myPassword',
    expiresAt: '2026-12-31T23:59:59.000Z',
    maxClicks: 500,
  });
  assert.equal(norm.value.enabled, true);
  assert.ok(norm.value.passwordHash.startsWith('scrypt:'));
  assert.equal(norm.value.maxClicks, 500);

  // Sanitized output for client
  const clientView = sanitizeProtectionForClient(norm.value);
  assert.equal(clientView.enabled, true);
  assert.equal(clientView.hasPassword, true);
  assert.equal(clientView.maxClicks, 500);
  assert.equal(clientView.passwordHash, undefined); // NEVER expose hash

  // Invalid max clicks (< 1)
  const invalidClicks = await normalizeAndValidateProtection({ enabled: true, maxClicks: 0 });
  assert.ok(invalidClicks.error);

  // Invalid password (> 1024 chars)
  const hugePassword = 'a'.repeat(1025);
  const invalidPass = await normalizeAndValidateProtection({ enabled: true, password: hugePassword });
  assert.ok(invalidPass.error);
});

test('experimentService: validates exactly 2 variants with weights summing to 100%', () => {
  // Valid 2-variant config
  const valid = normalizeAndValidateExperiments({
    enabled: true,
    variants: [
      { variantId: 'var-a', label: 'Variant A', destinationUrl: 'https://example.com/a', weight: 60 },
      { variantId: 'var-b', label: 'Variant B', destinationUrl: 'https://example.com/b', weight: 40 },
    ],
  });
  assert.equal(valid.value.enabled, true);
  assert.equal(valid.value.variants.length, 2);
  assert.equal(valid.value.variants[0].weight, 60);
  assert.equal(valid.value.variants[1].weight, 40);

  // Invalid: weights don't sum to 100
  const invalidSum = normalizeAndValidateExperiments({
    enabled: true,
    variants: [
      { variantId: 'a', destinationUrl: 'https://example.com/a', weight: 50 },
      { variantId: 'b', destinationUrl: 'https://example.com/b', weight: 40 },
    ],
  });
  assert.ok(invalidSum.error);

  // Invalid: more or less than 2 variants
  const invalidCount = normalizeAndValidateExperiments({
    enabled: true,
    variants: [
      { variantId: 'a', destinationUrl: 'https://example.com/a', weight: 100 },
    ],
  });
  assert.ok(invalidCount.error);
});

test('experimentService: sticky variant selection honors existing cookie', () => {
  const experiment = {
    enabled: true,
    variants: [
      { variantId: 'var-a', label: 'Variant A', destinationUrl: 'https://example.com/a', weight: 70 },
      { variantId: 'var-b', label: 'Variant B', destinationUrl: 'https://example.com/b', weight: 30 },
    ],
  };

  const cookies = { linkify_ab_testLink_default: 'var-b' };
  const selection = selectVariant(experiment, cookies, { shortCode: 'testLink', stageId: 'default' });

  assert.equal(selection.variant.variantId, 'var-b');
  assert.equal(selection.isNewAssignment, false);
});

test('csvExport: protects against spreadsheet formula injection and respects RFC 4180', () => {
  const headers = [
    { label: 'Name', key: 'name' },
    { label: 'Payload', key: 'payload' },
  ];
  const rows = [
    { name: 'Normal', payload: '123' },
    { name: 'Formula Equals', payload: '=SUM(A1:A10)' },
    { name: 'Formula Plus', payload: '+cmd|"/C calc"!A0' },
    { name: 'Formula Minus', payload: '-1+1' },
    { name: 'Formula At', payload: '@SUM(1)' },
    { name: 'Commas and Quotes', payload: 'Hello, "World"' },
  ];

  const csv = generateCsv({ headers, rows });
  const lines = csv.split('\r\n');

  assert.equal(lines[0], 'Name,Payload');
  assert.equal(lines[1], 'Normal,123');
  assert.ok(lines[2].includes("'=SUM(A1:A10)")); // prefixed with single quote
  assert.ok(lines[3].includes("'+cmd|")); // prefixed with single quote
  assert.ok(lines[4].includes("'-1+1")); // prefixed with single quote
  assert.ok(lines[5].includes("'@SUM(1)")); // prefixed with single quote
  assert.ok(lines[6].includes('"Hello, ""World"""')); // RFC 4180 double-quote escaping
});

test('flowCompiler: compiles stage-level A/B experiments into adaptive routing rules', () => {
  const flowDoc = normalizeFlowPayload({
    eventName: 'Summer Kickoff',
    creatorTimeZone: 'UTC',
    eventStartLocal: '2026-12-01T10:00',
    eventEndLocal: '2026-12-01T18:00',
    graph: {
      nodes: [
        { id: 'entry', position: { x: 0, y: 0 }, data: { kind: 'entry', label: 'Entry' } },
        { id: 'router', position: { x: 100, y: 0 }, data: { kind: 'router', label: 'Router' } },
        { id: 'stage-before', position: { x: 200, y: 0 }, data: { kind: 'destination', phase: 'before', label: 'Before', destinationUrl: 'https://example.com/before-default' } },
        { id: 'fallback', position: { x: 200, y: 100 }, data: { kind: 'fallback', label: 'Fallback', destinationUrl: 'https://example.com/fallback' } },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'router' },
        { id: 'e2', source: 'router', target: 'stage-before' },
        { id: 'e3', source: 'router', target: 'fallback' },
      ],
    },
  }).value;

  flowDoc.draft.routing.stages[0].experiments = {
    enabled: true,
    variants: [
      { variantId: 'v1', label: 'V1', destinationUrl: 'https://example.com/v1', weight: 50 },
      { variantId: 'v2', label: 'V2', destinationUrl: 'https://example.com/v2', weight: 50 },
    ],
  };

  const compiled = compileFlowToAdaptiveRouting(flowDoc);
  assert.equal(compiled.enabled, true);
  assert.equal(compiled.rules.length, 1);
  const rule = compiled.rules[0];
  assert.equal(rule.ruleId, 'stage-before');
  assert.equal(rule.experiments.enabled, true);
  assert.equal(rule.experiments.variants.length, 2);
  assert.equal(rule.experiments.variants[0].variantId, 'v1');
});

test('redirect & protection integration: expired, capped, and password-protected links', async () => {
  const { createApp } = await import('../src/app.js');

  const links = new Map();
  const clickEvents = [];

  const linkModel = {
    async findOne({ shortCode }) {
      return links.get(shortCode) ?? null;
    },
    async findById(id) {
      return [...links.values()].find((l) => l._id === id || l.id === id) ?? null;
    },
    async findOneAndUpdate(filter, update) {
      const link = links.get(filter.shortCode) ?? [...links.values()].find((l) => l._id === filter._id);
      if (!link) return null;
      if (filter.$expr) {
        const [left, right] = filter.$expr.$lt;
        const currentCount = link.lifetimeRedirectCount ?? 0;
        const max = link.protection?.maxClicks ?? 0;
        if (!(currentCount < max)) return null;
      }
      if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) {
          link[k] = (link[k] ?? 0) + v;
        }
      }
      if (update.$set) {
        Object.assign(link, update.$set);
      }
      return link;
    },
  };

  const clickEventModel = {
    async create(event) {
      const record = { ...event, _id: `click_${clickEvents.length + 1}` };
      clickEvents.push(record);
      return record;
    },
    aggregate(pipeline) {
      const match = pipeline[0]?.$match ?? {};
      const linkId = match.linkId?.toString?.() ?? String(match.linkId);
      const linkClicks = clickEvents.filter((c) => String(c.linkId) === linkId);
      const allowedClicks = linkClicks.filter((c) => c.accessStatus === 'allowed');
      const blockedClicks = linkClicks.filter((c) => c.accessStatus && c.accessStatus.startsWith('blocked_'));
      return Promise.resolve([
        {
          lifetimeVisits: [{ count: linkClicks.length }],
          lifetimeAllowed: [{ count: allowedClicks.length }],
          lifetimeBlocked: [
            { _id: 'blocked_expired', count: linkClicks.filter((c) => c.accessStatus === 'blocked_expired').length },
            { _id: 'blocked_max_clicks', count: linkClicks.filter((c) => c.accessStatus === 'blocked_max_clicks').length },
            { _id: 'blocked_password', count: linkClicks.filter((c) => c.accessStatus === 'blocked_password').length },
          ],
          rangeVisits: [{ count: linkClicks.length }],
          rangeAllowed: [{ count: allowedClicks.length }],
          rangeBlocked: [
            { _id: 'blocked_expired', count: linkClicks.filter((c) => c.accessStatus === 'blocked_expired').length },
            { _id: 'blocked_max_clicks', count: linkClicks.filter((c) => c.accessStatus === 'blocked_max_clicks').length },
            { _id: 'blocked_password', count: linkClicks.filter((c) => c.accessStatus === 'blocked_password').length },
          ],
          experiments: [],
          daily: [],
          devices: [],
          countries: [],
          referrers: [],
        },
      ]);
    },
  };

  const app = createApp({ linkModel, clickEventModel });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Expired Link
    links.set('exp1', {
      _id: '507f1f77bcf86cd799439011',
      id: '507f1f77bcf86cd799439011',
      shortCode: 'exp1',
      originalUrl: 'https://example.com/dest',
      protection: { enabled: true, expiresAt: new Date(Date.now() - 3600000) },
      lifetimeRedirectCount: 0,
    });

    const resExpired = await fetch(`${baseUrl}/exp1`, { redirect: 'manual' });
    assert.equal(resExpired.status, 410);
    assert.ok(clickEvents.some((c) => c.shortCode === undefined && c.accessStatus === 'blocked_expired'));

    // 2. Capped Link (maxClicks: 2)
    links.set('cap1', {
      _id: '507f1f77bcf86cd799439012',
      id: '507f1f77bcf86cd799439012',
      shortCode: 'cap1',
      originalUrl: 'https://example.com/capped-dest',
      protection: { enabled: true, maxClicks: 2 },
      lifetimeRedirectCount: 0,
    });

    const resCap1 = await fetch(`${baseUrl}/cap1`, { redirect: 'manual' });
    assert.equal(resCap1.status, 302);
    assert.equal(links.get('cap1').lifetimeRedirectCount, 1);

    const resCap2 = await fetch(`${baseUrl}/cap1`, { redirect: 'manual' });
    assert.equal(resCap2.status, 302);
    assert.equal(links.get('cap1').lifetimeRedirectCount, 2);

    const resCap3 = await fetch(`${baseUrl}/cap1`, { redirect: 'manual' });
    assert.equal(resCap3.status, 410);
    assert.equal(links.get('cap1').lifetimeRedirectCount, 2); // capped!
    assert.ok(clickEvents.some((c) => c.accessStatus === 'blocked_max_clicks'));

    // 3. Password Protected Link
    const pwHash = await hashLinkPassword('pass123');
    links.set('pw1', {
      _id: '507f1f77bcf86cd799439013',
      id: '507f1f77bcf86cd799439013',
      shortCode: 'pw1',
      originalUrl: 'https://example.com/secret',
      protection: { enabled: true, passwordHash: pwHash },
      lifetimeRedirectCount: 0,
    });

    // 3a. GET without unlock cookie -> returns HTML unlock form (status 200)
    const resPwGet = await fetch(`${baseUrl}/pw1`, { redirect: 'manual' });
    assert.equal(resPwGet.status, 200);
    const htmlPw = await resPwGet.text();
    assert.ok(htmlPw.includes('Password Required'));

    // 3b. POST wrong password -> returns 401 with error message
    const resUnlockBad = await fetch(`${baseUrl}/pw1/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=wrong',
      redirect: 'manual',
    });
    assert.equal(resUnlockBad.status, 401);
    const htmlBad = await resUnlockBad.text();
    assert.ok(htmlBad.includes('Incorrect password'));
    assert.ok(clickEvents.some((c) => c.accessStatus === 'blocked_password'));

    // 3c. POST correct password -> 302 redirect with unlock cookie
    const resUnlockOk = await fetch(`${baseUrl}/pw1/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=pass123',
      redirect: 'manual',
    });
    assert.equal(resUnlockOk.status, 302);
    const setCookie = resUnlockOk.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.includes('linkify_unlocked_pw1='));

    // Extract cookie value
    const match = setCookie.match(/linkify_unlocked_pw1=([^;]+)/);
    const cookieHeader = `linkify_unlocked_pw1=${match[1]}`;

    // 3d. Subsequent GET with cookie -> 302 to destination
    const resUnlocked = await fetch(`${baseUrl}/pw1`, {
      headers: { Cookie: cookieHeader },
      redirect: 'manual',
    });
    assert.equal(resUnlocked.status, 302);
    assert.equal(resUnlocked.headers.get('location'), 'https://example.com/secret');

    // 4. A/B Experiment Traffic & Cookie Assignment
    links.set('ab1', {
      _id: '507f1f77bcf86cd799439014',
      id: '507f1f77bcf86cd799439014',
      shortCode: 'ab1',
      originalUrl: 'https://example.com/fallback',
      experiments: {
        enabled: true,
        variants: [
          { variantId: 'var-a', label: 'Variant A', destinationUrl: 'https://example.com/variant-a', weight: 100 },
          { variantId: 'var-b', label: 'Variant B', destinationUrl: 'https://example.com/variant-b', weight: 0 },
        ],
      },
      lifetimeRedirectCount: 0,
    });

    const resAbFirst = await fetch(`${baseUrl}/ab1`, { redirect: 'manual' });
    assert.equal(resAbFirst.status, 302);
    assert.equal(resAbFirst.headers.get('location'), 'https://example.com/variant-a');
    const abCookie = resAbFirst.headers.get('set-cookie');
    assert.ok(abCookie && abCookie.includes('linkify_ab_ab1_default=var-a'));

    // Sticky test: if visitor has cookie for var-b, honors var-b
    const resAbSticky = await fetch(`${baseUrl}/ab1`, {
      headers: { Cookie: 'linkify_ab_ab1_default=var-b' },
      redirect: 'manual',
    });
    assert.equal(resAbSticky.status, 302);
    assert.equal(resAbSticky.headers.get('location'), 'https://example.com/variant-b');
  } finally {
    server.close();
  }
});
