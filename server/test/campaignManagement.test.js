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
import { createApp } from '../src/app.js';

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

test('experimentService: 1,000 independent visitor assignments at 50/50 split are statistically balanced', () => {
  const experiment = {
    enabled: true,
    variants: [
      { variantId: 'var-a', label: 'Variant A', destinationUrl: 'https://example.com/a', weight: 50 },
      { variantId: 'var-b', label: 'Variant B', destinationUrl: 'https://example.com/b', weight: 50 },
    ],
  };

  let countA = 0;
  let countB = 0;
  for (let i = 0; i < 1000; i++) {
    const selection = selectVariant(experiment, {}, { shortCode: 'statLink', stageId: 'default' });
    assert.equal(selection.isNewAssignment, true);
    if (selection.variant.variantId === 'var-a') countA++;
    else if (selection.variant.variantId === 'var-b') countB++;
  }

  assert.equal(countA + countB, 1000);
  assert.ok(countA >= 430 && countA <= 570, `Count A (${countA}) should be reasonably balanced around 500`);
  assert.ok(countB >= 430 && countB <= 570, `Count B (${countB}) should be reasonably balanced around 500`);
});

test('experimentService: supports 80/20, 100/0, and 0/100 weight configurations', () => {
  // 1. 80/20 split
  const exp8020 = {
    enabled: true,
    variants: [
      { variantId: 'var-a', label: 'Variant A', destinationUrl: 'https://example.com/a', weight: 80 },
      { variantId: 'var-b', label: 'Variant B', destinationUrl: 'https://example.com/b', weight: 20 },
    ],
  };
  let count80 = 0;
  for (let i = 0; i < 1000; i++) {
    const s = selectVariant(exp8020, {}, { shortCode: 'link8020', stageId: 'default' });
    if (s.variant.variantId === 'var-a') count80++;
  }
  assert.ok(count80 >= 740 && count80 <= 860, `Count A (${count80}) should be reasonably close to 800 for 80/20 split`);

  // 2. 100/0 split (Variant A gets 100% of traffic)
  const norm100 = normalizeAndValidateExperiments({
    enabled: true,
    variants: [
      { variantId: 'var-a', destinationUrl: 'https://example.com/a', weight: 100 },
      { variantId: 'var-b', destinationUrl: 'https://example.com/b', weight: 0 },
    ],
  });
  assert.equal(norm100.error, undefined);
  for (let i = 0; i < 1000; i++) {
    const s = selectVariant(norm100.value, {}, { shortCode: 'link100', stageId: 'default' });
    assert.equal(s.variant.variantId, 'var-a', '100/0 split must always select Variant A');
  }

  // 3. 0/100 split (Variant B gets 100% of traffic)
  const norm0 = normalizeAndValidateExperiments({
    enabled: true,
    variants: [
      { variantId: 'var-a', destinationUrl: 'https://example.com/a', weight: 0 },
      { variantId: 'var-b', destinationUrl: 'https://example.com/b', weight: 100 },
    ],
  });
  assert.equal(norm0.error, undefined);
  for (let i = 0; i < 1000; i++) {
    const s = selectVariant(norm0.value, {}, { shortCode: 'link0', stageId: 'default' });
    assert.equal(s.variant.variantId, 'var-b', '0/100 split must always select Variant B');
  }
});

test('experimentService: sticky assignment persists across repeated visits', () => {
  const experiment = {
    enabled: true,
    variants: [
      { variantId: 'var-a', label: 'Variant A', destinationUrl: 'https://example.com/a', weight: 50 },
      { variantId: 'var-b', label: 'Variant B', destinationUrl: 'https://example.com/b', weight: 50 },
    ],
  };

  const initial = selectVariant(experiment, {}, { shortCode: 'repeatLink', stageId: 'default' });
  assert.equal(initial.isNewAssignment, true);
  const assignedId = initial.variant.variantId;
  const clientCookies = { [initial.cookieName]: initial.cookieValue };

  for (let i = 0; i < 50; i++) {
    const repeat = selectVariant(experiment, clientCookies, { shortCode: 'repeatLink', stageId: 'default' });
    assert.equal(repeat.isNewAssignment, false);
    assert.equal(repeat.variant.variantId, assignedId, 'Returning visitor must stick to assigned variant');
  }
});

test('experimentService: isolates experiments across links and Flow stages', () => {
  const expLink1 = {
    enabled: true,
    variants: [
      { variantId: 'v-alpha', label: 'Alpha', destinationUrl: 'https://example.com/alpha', weight: 50 },
      { variantId: 'v-beta', label: 'Beta', destinationUrl: 'https://example.com/beta', weight: 50 },
    ],
  };
  const expLink2 = {
    enabled: true,
    variants: [
      { variantId: 'v-one', label: 'One', destinationUrl: 'https://example.com/1', weight: 50 },
      { variantId: 'v-two', label: 'Two', destinationUrl: 'https://example.com/2', weight: 50 },
    ],
  };

  const cookies = {
    linkify_ab_link1_default: 'v-beta',
    linkify_ab_flow1_stageBefore: 'v-alpha',
  };

  const resLink1 = selectVariant(expLink1, cookies, { shortCode: 'link1', stageId: 'default' });
  assert.equal(resLink1.isNewAssignment, false);
  assert.equal(resLink1.variant.variantId, 'v-beta');

  const resLink2 = selectVariant(expLink2, cookies, { shortCode: 'link2', stageId: 'default' });
  assert.equal(resLink2.isNewAssignment, true);
  assert.equal(resLink2.cookieName, 'linkify_ab_link2_default');

  const resStageDuring = selectVariant(expLink1, cookies, { shortCode: 'flow1', stageId: 'stageDuring' });
  assert.equal(resStageDuring.isNewAssignment, true);
  assert.equal(resStageDuring.cookieName, 'linkify_ab_flow1_stageDuring');
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

test('combined campaign workflow: password unlock, rejection, expiration, concurrent cap enforcement, A/B routing, and report accuracy', async () => {
  const links = new Map();
  const clickEvents = [];

  const linkModel = {
    async findOne(filter) {
      if (filter.shortCode) return links.get(filter.shortCode) ?? null;
      if (filter._id) return [...links.values()].find((l) => l._id === filter._id) ?? null;
      return null;
    },
    async findOneAndUpdate(filter, update) {
      const link = links.get(filter.shortCode) ?? [...links.values()].find((l) => l._id === filter._id);
      if (!link) return null;
      if (filter.$expr) {
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
      const record = { ...event, _id: `clk_${clickEvents.length + 1}` };
      clickEvents.push(record);
      return record;
    },
  };

  const app = createApp({ linkModel, clickEventModel });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Password Protection Workflow: rejection -> successful unlock -> cookie access
    const pwHash = await hashLinkPassword('CampaignPass2026!');
    links.set('pwflow', {
      _id: '507f1f77bcf86cd799439021',
      shortCode: 'pwflow',
      originalUrl: 'https://example.com/pw-target',
      protection: { enabled: true, passwordHash: pwHash },
      lifetimeRedirectCount: 0,
    });

    // 1a. Unauthenticated GET -> 200 HTML challenge
    const resChallenge = await fetch(`${baseUrl}/pwflow`, { redirect: 'manual' });
    assert.equal(resChallenge.status, 200);
    const htmlChallenge = await resChallenge.text();
    assert.ok(htmlChallenge.includes('Password Required'));

    // 1b. Incorrect password -> 401 with error message
    const resBadPw = await fetch(`${baseUrl}/pwflow/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=wrongPass',
      redirect: 'manual',
    });
    assert.equal(resBadPw.status, 401);
    const htmlBadPw = await resBadPw.text();
    assert.ok(htmlBadPw.includes('Incorrect password'));
    assert.ok(clickEvents.some((c) => c.linkId === '507f1f77bcf86cd799439021' && c.accessStatus === 'blocked_password'));

    // 1c. Correct password -> 302 redirect with unlock cookie
    const resGoodPw = await fetch(`${baseUrl}/pwflow/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=CampaignPass2026!',
      redirect: 'manual',
    });
    assert.equal(resGoodPw.status, 302);
    const cookieHeader = resGoodPw.headers.get('set-cookie');
    assert.ok(cookieHeader && cookieHeader.includes('linkify_unlocked_pwflow='));

    // 1d. Access with unlock cookie -> 302 redirect to originalUrl
    const match = cookieHeader.match(/linkify_unlocked_pwflow=([^;]+)/);
    const resUnlocked = await fetch(`${baseUrl}/pwflow`, {
      headers: { Cookie: `linkify_unlocked_pwflow=${match[1]}` },
      redirect: 'manual',
    });
    assert.equal(resUnlocked.status, 302);
    assert.equal(resUnlocked.headers.get('location'), 'https://example.com/pw-target');

    // 2. Expiration Enforcement Workflow
    links.set('expflow', {
      _id: '507f1f77bcf86cd799439022',
      shortCode: 'expflow',
      originalUrl: 'https://example.com/exp-target',
      protection: { enabled: true, expiresAt: new Date(Date.now() - 60000) },
      lifetimeRedirectCount: 0,
    });
    const resExp = await fetch(`${baseUrl}/expflow`, { redirect: 'manual' });
    assert.equal(resExp.status, 410);
    assert.ok(clickEvents.some((c) => c.linkId === '507f1f77bcf86cd799439022' && c.accessStatus === 'blocked_expired'));

    // 3. Concurrent Redirect-Cap Enforcement Workflow (10 concurrent requests for cap: 3)
    links.set('capflow', {
      _id: '507f1f77bcf86cd799439023',
      shortCode: 'capflow',
      originalUrl: 'https://example.com/cap-target',
      protection: { enabled: true, maxClicks: 3 },
      lifetimeRedirectCount: 0,
    });

    const concurrentRequests = Array.from({ length: 10 }, () =>
      fetch(`${baseUrl}/capflow`, { redirect: 'manual' })
    );
    const responses = await Promise.all(concurrentRequests);
    const statusCodes = responses.map((r) => r.status);
    const successes = statusCodes.filter((s) => s === 302).length;
    const blocked = statusCodes.filter((s) => s === 410).length;

    assert.equal(successes, 3, 'Exactly 3 requests must succeed before the cap is reached');
    assert.equal(blocked, 7, 'Remaining 7 concurrent requests must receive 410 Gone');
    assert.equal(links.get('capflow').lifetimeRedirectCount, 3, 'Counter must stop exactly at cap');

    // Verify click event logging accuracy: 3 allowed, 7 blocked_max_clicks
    const capClicks = clickEvents.filter((c) => c.linkId === '507f1f77bcf86cd799439023');
    assert.equal(capClicks.filter((c) => c.accessStatus === 'allowed').length, 3);
    assert.equal(capClicks.filter((c) => c.accessStatus === 'blocked_max_clicks').length, 7);

    // 4. A/B Routing Workflow with Sticky Cookie
    links.set('abflow', {
      _id: '507f1f77bcf86cd799439024',
      shortCode: 'abflow',
      originalUrl: 'https://example.com/default-target',
      experiments: {
        enabled: true,
        variants: [
          { variantId: 'v-alpha', label: 'Alpha', destinationUrl: 'https://example.com/alpha', weight: 50 },
          { variantId: 'v-beta', label: 'Beta', destinationUrl: 'https://example.com/beta', weight: 50 },
        ],
      },
      lifetimeRedirectCount: 0,
    });

    const resAbInit = await fetch(`${baseUrl}/abflow`, { redirect: 'manual' });
    assert.equal(resAbInit.status, 302);
    const assignedLocation = resAbInit.headers.get('location');
    assert.ok(assignedLocation === 'https://example.com/alpha' || assignedLocation === 'https://example.com/beta');
    const abSetCookie = resAbInit.headers.get('set-cookie');
    assert.ok(abSetCookie && abSetCookie.includes('linkify_ab_abflow_default='));

    // Sticky visitor verification
    const resSticky = await fetch(`${baseUrl}/abflow`, {
      headers: { Cookie: 'linkify_ab_abflow_default=v-beta' },
      redirect: 'manual',
    });
    assert.equal(resSticky.status, 302);
    assert.equal(resSticky.headers.get('location'), 'https://example.com/beta');
  } finally {
    server.close();
  }
});
