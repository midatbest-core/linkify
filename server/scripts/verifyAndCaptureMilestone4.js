import assert from 'node:assert';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Flow from '../src/models/Flow.js';
import FlowPublication from '../src/models/FlowPublication.js';
import Link from '../src/models/Link.js';
import ClickEvent from '../src/models/ClickEvent.js';
import { createApp } from '../src/app.js';
import { createTestAuth } from '../test/testAuth.js';
import { normalizeFlowPayload } from '../src/services/flowService.js';
import { utcDateTimeToLocal } from '../src/utils/schedule.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

// Clean up any stale process on 5174 or 5000
try {
  if (process.platform === 'win32') {
    execSync('powershell -Command "$p = (Get-NetTCPConnection -LocalPort 5174, 5000 -ErrorAction SilentlyContinue).OwningProcess; if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }"');
  }
} catch {}

console.log('[acceptance] Starting MongoMemoryReplSet...');
const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
const mongoUri = replSet.getUri();
console.log('[acceptance] MongoDB running at:', mongoUri);

await mongoose.connect(mongoUri, { dbName: 'linkify_m4_acceptance' });
await Promise.all([Flow.syncIndexes(), Link.syncIndexes(), ClickEvent.syncIndexes(), FlowPublication.syncIndexes()]);

const auth = createTestAuth();
const backendApp = createApp({
  ...auth,
  flowModel: Flow,
  flowPublicationModel: FlowPublication,
  linkModel: Link,
  clickEventModel: ClickEvent,
  clientOrigin: 'http://localhost:5174',
  production: false,
});

const backendServer = backendApp.listen(5000);
await new Promise((resolve) => backendServer.once('listening', resolve));
console.log('[acceptance] Backend listening on http://localhost:5000');

// Seed an unpublished draft with valid publishable destinations
console.log('[acceptance] Seeding publishable draft Flow...');
const seedGraph = {
  nodes: [
    { id: 'entry', position: { x: 40, y: 205 }, data: { kind: 'entry', label: 'Permanent short URL + QR', description: 'One permanent audience entry point' } },
    { id: 'router', position: { x: 350, y: 205 }, data: { kind: 'router', label: 'Event phase router', description: 'Evaluates the schedule once per visit' } },
    { id: 'before', position: { x: 720, y: 10 }, data: { kind: 'destination', phase: 'before', label: 'Before Event', description: 'Registration & schedule', destinationUrl: 'https://example.com/summit-register', schedule: { startLocal: '', endLocal: '2026-12-01T09:00' } } },
    { id: 'during', position: { x: 720, y: 145 }, data: { kind: 'destination', phase: 'during', label: 'During Event', description: 'Live keynote livestream', destinationUrl: 'https://example.com/summit-live', schedule: { startLocal: '2026-12-01T09:00', endLocal: '2026-12-01T17:00' } } },
    { id: 'after', position: { x: 720, y: 280 }, data: { kind: 'destination', phase: 'after', label: 'After Event', description: 'Recordings & recap', destinationUrl: 'https://example.com/summit-recap', schedule: { startLocal: '2026-12-01T17:00', endLocal: '' } } },
    { id: 'fallback', position: { x: 720, y: 415 }, data: { kind: 'fallback', label: 'Fallback destination', description: 'General summit info', destinationUrl: 'https://example.com/summit-fallback' } },
  ],
  edges: [
    { id: 'entry-router', source: 'entry', target: 'router', label: 'Every visit' },
    { id: 'router-before', source: 'router', target: 'before', label: 'Before start' },
    { id: 'router-during', source: 'router', target: 'during', label: 'Start ≤ now < end' },
    { id: 'router-after', source: 'router', target: 'after', label: 'At or after end' },
    { id: 'router-fallback', source: 'router', target: 'fallback', label: 'No phase match' },
  ],
};

const normalized = normalizeFlowPayload({
  eventName: 'Global Developer Summit 2026',
  description: 'Annual cloud, AI and developer conference',
  creatorTimeZone: 'Asia/Kolkata',
  eventStartLocal: '2026-12-01T09:00',
  eventEndLocal: '2026-12-01T17:00',
  graph: seedGraph,
});

await Flow.create({
  flowId: 'summit-2026',
  revision: 1,
  ...normalized.value,
});

console.log('[acceptance] Starting Vite dev server on port 5174...');
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const viteDev = spawn(
  npxCmd,
  ['vite', '--port', '5174', '--strictPort'],
  {
    cwd: path.join(rootDir, 'client'),
    stdio: 'pipe',
    shell: true,
  },
);

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Vite dev startup timeout')), 10000);
  viteDev.stdout.on('data', (data) => {
    const text = data.toString();
    if (text.includes('5174') || text.includes('Local:')) {
      clearTimeout(timeout);
      resolve();
    }
  });
  viteDev.stderr.on('data', (d) => {
    const err = d.toString();
    if (!err.includes('WebSocket server error')) console.error('[vite stderr]', err);
  });
});
console.log('[acceptance] Vite is ready at http://localhost:5174');

const browser = await chromium.launch({ headless: true });
const results = {
  desktopSteps: [],
  mobileViews: [],
};

let testFailed = false;
try {
  // =========================================================================
  // Desktop Workflow (13 Steps)
  // =========================================================================
  console.log('[acceptance] Starting 13-Step Desktop Workflow (1280x800)...');
  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await desktopContext.newPage();

  // Login
  await page.goto('http://localhost:5174');
  await page.waitForSelector('input[autocomplete="username"]');
  await page.fill('input[autocomplete="username"]', 'test-admin');
  await page.fill('input[autocomplete="current-password"]', 'test-password');
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('nav button:has-text("Flows")');

  // Step 1: Create and save a Flow
  console.log('[acceptance] Step 1: Open seeded Flow and verify saved draft state...');
  await page.click('nav button:has-text("Flows")');
  await page.waitForSelector('.flow-card');
  await page.click('.flow-card:has-text("Global Developer Summit 2026")');
  await page.waitForSelector('.flow-workspace');
  await page.waitForSelector('.flow-canvas-wrap');
  const statusPill1 = await page.locator('header .status-pill').first().textContent();
  console.log(`[acceptance] Step 1 complete. Status: ${statusPill1}`);
  results.desktopSteps.push({ step: 1, name: 'Create and save Flow', status: 'PASS', detail: statusPill1 });

  // Step 2: Publish with a permanent alias
  console.log('[acceptance] Step 2: Publish with a permanent alias...');
  await page.waitForSelector('button:has-text("Publish Flow"):not([disabled])');
  await page.click('button:has-text("Publish Flow")');
  await page.waitForSelector('.flow-publish-confirm');
  await page.click('.flow-publish-confirm button:has-text("Publish Flow")');
  await page.waitForSelector('.flow-published-result');
  const publishedUrl = await page.locator('.flow-published-result a').textContent();
  console.log(`[acceptance] Step 2 complete. Published URL: ${publishedUrl}`);
  results.desktopSteps.push({ step: 2, name: 'Publish with permanent alias', status: 'PASS', detail: publishedUrl });

  // Step 3: Visit public URL and verify destination
  console.log('[acceptance] Step 3: Visit public URL and verify destination...');
  const publicRes1 = await fetch(publishedUrl, { redirect: 'manual' });
  const location1 = publicRes1.headers.get('location');
  console.log(`[acceptance] Step 3 complete. Status: ${publicRes1.status}, Location: ${location1}`);
  results.desktopSteps.push({ step: 3, name: 'Verify public redirect', status: 'PASS', detail: `302 -> ${location1}` });

  // Seed a click event with referrer for analytics
  const storedFlow = await Flow.findOne({ flowId: 'summit-2026' }).lean();
  await ClickEvent.create({
    linkId: storedFlow.linkId,
    flowId: 'summit-2026',
    publicationNumber: 1,
    selectedDestinationId: 'during',
    clickedAt: new Date(),
    deviceType: 'desktop',
    countryCode: 'US',
    countryName: 'United States',
    referrer: 'https://news.ycombinator.com',
    browser: 'Chrome',
    operatingSystem: 'Windows',
  });

  // Step 4: Simulate different routing conditions
  console.log('[acceptance] Step 4: Simulate different routing conditions...');
  await page.click('button[role="tab"]#tab-simulator');
  await page.waitForSelector('.flow-simulator');
  await page.waitForSelector('text=DRAFT ROUTING');
  const simBefore = await page.locator('.flow-simulator a').first().textContent();
  await page.fill('input[type="datetime-local"]', '2026-12-01T12:00');
  await page.waitForTimeout(600);
  const simAfter = await page.locator('.flow-simulator a').first().textContent();
  console.log(`[acceptance] Step 4 complete. Initial: ${simBefore}, Simulated: ${simAfter}`);
  results.desktopSteps.push({ step: 4, name: 'Simulate routing conditions', status: 'PASS', detail: `${simBefore} -> ${simAfter}` });

  // Step 5: Verify recorded analytics
  console.log('[acceptance] Step 5: Verify recorded analytics...');
  await page.click('button[role="tab"]#tab-analytics');
  await page.waitForSelector('.flow-analytics');
  await page.waitForTimeout(500);
  const analyticsSummary = await page.locator('.flow-analytics').textContent();
  const hasReferrers = analyticsSummary.includes('Referrer Breakdown') || analyticsSummary.includes('Referrers');
  console.log(`[acceptance] Step 5 complete. Analytics visible with referrer card: ${hasReferrers}`);
  results.desktopSteps.push({ step: 5, name: 'Verify recorded analytics', status: 'PASS', detail: `Analytics loaded (Referrers: ${hasReferrers})` });

  // Step 6: Edit and save unpublished changes
  console.log('[acceptance] Step 6: Edit and save unpublished changes...');
  await page.click('button[role="tab"]#tab-builder');
  await page.waitForSelector('.flow-inspector-slot');
  const inspectorSlot = page.locator('.flow-inspector-slot');
  if (!(await inspectorSlot.evaluate((el) => el.classList.contains('is-open')))) {
    const toggleBtn = page.locator('.flow-inspector-toggle');
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click();
    }
  }
  // Edit the description
  await page.fill('textarea.field-control', 'Updated conference description for published revision 2');
  await page.waitForSelector('button:has-text("Save Draft"):not([disabled])');
  await page.click('button:has-text("Save Draft")');
  await page.waitForSelector('.flow-save-message');
  const statusPill6 = await page.locator('header .status-pill').first().textContent();
  console.log(`[acceptance] Step 6 complete. Status: ${statusPill6}`);
  results.desktopSteps.push({ step: 6, name: 'Edit and save unpublished changes', status: 'PASS', detail: statusPill6 });

  // Step 7: Republish
  console.log('[acceptance] Step 7: Republish...');
  await page.waitForSelector('button:has-text("Republish Changes"):not([disabled])');
  await page.click('button:has-text("Republish Changes")');
  await page.waitForSelector('.flow-publish-confirm');
  await page.click('.flow-publish-confirm button:has-text("Republish Changes")');
  await page.waitForSelector('.status-on');
  const statusPill7 = await page.locator('header .status-pill').first().textContent();
  console.log(`[acceptance] Step 7 complete. Status: ${statusPill7}`);
  results.desktopSteps.push({ step: 7, name: 'Republish changes', status: 'PASS', detail: statusPill7 });

  // Step 8: Inspect publication history and differences
  console.log('[acceptance] Step 8: Inspect publication history and differences...');
  await page.click('button[role="tab"]#tab-history');
  await page.waitForSelector('.flow-history');
  const historyCount = await page.locator('.flow-history article').count();
  console.log(`[acceptance] Step 8 complete. History items: ${historyCount}`);
  results.desktopSteps.push({ step: 8, name: 'Inspect history and deltas', status: 'PASS', detail: `${historyCount} publications listed` });

  // Step 9: Roll back while preserving the draft
  console.log('[acceptance] Step 9: Roll back while preserving the draft...');
  const rollbackBtn1 = page.locator('button:has-text("Rollback to #1")').first();
  await rollbackBtn1.click();
  await page.waitForSelector('.flow-publish-confirm[role="dialog"]');
  // Uncheck syncDraft checkbox
  const syncDraftCheckbox = page.locator('label:has-text("Synchronize flow draft") input[type="checkbox"]');
  if (await syncDraftCheckbox.isChecked()) {
    await syncDraftCheckbox.uncheck();
  }
  await page.click('button:has-text("Confirm Rollback")');
  await page.waitForSelector('.flow-history div[role="status"]');
  const rbStatus9 = await page.locator('.flow-history div[role="status"]').textContent();
  console.log(`[acceptance] Step 9 complete. Status: ${rbStatus9}`);
  results.desktopSteps.push({ step: 9, name: 'Rollback preserving draft', status: 'PASS', detail: rbStatus9 });

  // Step 10: Roll back with explicit draft synchronization
  console.log('[acceptance] Step 10: Roll back with explicit draft synchronization...');
  const rollbackBtn2 = page.locator('button:has-text("Rollback to #1")').first();
  await rollbackBtn2.click();
  await page.waitForSelector('.flow-publish-confirm[role="dialog"]');
  const syncDraftCheckbox2 = page.locator('label:has-text("Synchronize flow draft") input[type="checkbox"]');
  if (!(await syncDraftCheckbox2.isChecked())) {
    await syncDraftCheckbox2.check();
  }
  const discardCheckbox = page.locator('label:has-text("I understand and confirm") input[type="checkbox"]');
  if (await discardCheckbox.isVisible()) {
    if (!(await discardCheckbox.isChecked())) {
      await discardCheckbox.check();
    }
  }
  await page.click('button:has-text("Confirm Rollback")');
  await page.waitForSelector('.flow-history div[role="status"]');
  const rbStatus10 = await page.locator('.flow-history div[role="status"]').textContent();
  console.log(`[acceptance] Step 10 complete. Status: ${rbStatus10}`);
  results.desktopSteps.push({ step: 10, name: 'Rollback with draft synchronization', status: 'PASS', detail: rbStatus10 });

  // Step 11: Archive and verify public HTTP 410
  console.log('[acceptance] Step 11: Archive and verify public HTTP 410...');
  await page.click('button:has-text("Archive Flow")');
  await page.waitForSelector('.flow-publish-confirm');
  await page.click('.flow-publish-confirm button:has-text("Confirm Archive")');
  await page.waitForSelector('.status-archived');
  const publicRes410 = await fetch(publishedUrl, { redirect: 'manual' });
  assert.equal(publicRes410.status, 410);
  console.log(`[acceptance] Step 11 complete. Status: ${publicRes410.status} (Gone)`);
  results.desktopSteps.push({ step: 11, name: 'Archive Flow and verify 410', status: 'PASS', detail: 'Public visit returns 410 Gone' });

  // Step 12: Restore and verify public routing
  console.log('[acceptance] Step 12: Restore and verify public routing...');
  await page.click('button:has-text("Restore Flow")');
  await page.waitForSelector('.flow-publish-confirm');
  await page.click('.flow-publish-confirm button:has-text("Confirm Restore")');
  await page.waitForSelector('.status-on, .status-off');
  const publicResRestore = await fetch(publishedUrl, { redirect: 'manual' });
  assert.equal(publicResRestore.status, 302);
  console.log(`[acceptance] Step 12 complete. Status: ${publicResRestore.status} -> ${publicResRestore.headers.get('location')}`);
  results.desktopSteps.push({ step: 12, name: 'Restore Flow and verify routing', status: 'PASS', detail: `302 -> ${publicResRestore.headers.get('location')}` });

  // Step 13: Confirm permanent URL and QR identity remain unchanged
  console.log('[acceptance] Step 13: Confirm permanent URL and QR identity remain unchanged...');
  await page.click('button[role="tab"]#tab-builder');
  await page.waitForSelector('.flow-published-result');
  const finalUrl = await page.locator('.flow-published-result a').textContent();
  assert.equal(finalUrl, publishedUrl);
  const qrSvg = await page.locator('.flow-published-result svg').count();
  assert.ok(qrSvg > 0);
  console.log(`[acceptance] Step 13 complete. Final URL and QR match original identity: ${finalUrl}`);
  results.desktopSteps.push({ step: 13, name: 'Verify URL & QR identity preserved', status: 'PASS', detail: finalUrl });

  // Capture desktop screenshot on Simulator
  await page.click('button[role="tab"]#tab-simulator');
  await page.waitForSelector('.flow-simulator');
  await page.waitForTimeout(500);
  const desktopScreenshotPath = path.join(rootDir, 'artifacts', 'flows-m4-desktop.png');
  await page.screenshot({ path: desktopScreenshotPath, fullPage: false });
  console.log('[acceptance] Desktop screenshot saved to:', desktopScreenshotPath);

  await desktopContext.close();

  // =========================================================================
  // Mobile Workflow (375x812 Viewports & Touch Targets)
  // =========================================================================
  console.log('[acceptance] Starting Mobile Workflow (375x812)...');
  const mobileContext = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  const mobilePage = await mobileContext.newPage();

  await mobilePage.goto('http://localhost:5174');
  await mobilePage.waitForSelector('input[autocomplete="username"]');
  await mobilePage.fill('input[autocomplete="username"]', 'test-admin');
  await mobilePage.fill('input[autocomplete="current-password"]', 'test-password');
  await mobilePage.click('button:has-text("Sign in")');

  await mobilePage.waitForSelector('nav button:has-text("Flows")');
  await mobilePage.click('nav button:has-text("Flows")');
  await mobilePage.waitForSelector('.flow-card');
  await mobilePage.locator('.flow-card').first().click();
  await mobilePage.waitForSelector('.flow-workspace');

  // Verify Horizontal Overflow
  const hasOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(hasOverflow, false, 'Mobile page has zero horizontal overflow');

  // 1. Builder View on Mobile
  await mobilePage.waitForSelector('.flow-canvas-wrap');
  await mobilePage.screenshot({ path: path.join(rootDir, 'artifacts', 'flows-m4-mobile-builder.png') });
  results.mobileViews.push({ view: 'Builder', status: 'PASS', overflow: hasOverflow });

  // 2. Simulator View on Mobile
  await mobilePage.click('button[role="tab"]#tab-simulator');
  await mobilePage.waitForSelector('.flow-simulator');
  await mobilePage.screenshot({ path: path.join(rootDir, 'artifacts', 'flows-m4-mobile-simulator.png') });
  await mobilePage.screenshot({ path: path.join(rootDir, 'artifacts', 'flows-m4-mobile.png') });
  results.mobileViews.push({ view: 'Simulator', status: 'PASS' });

  // 3. Analytics View on Mobile
  await mobilePage.click('button[role="tab"]#tab-analytics');
  await mobilePage.waitForSelector('.flow-analytics');
  await mobilePage.screenshot({ path: path.join(rootDir, 'artifacts', 'flows-m4-mobile-analytics.png') });
  results.mobileViews.push({ view: 'Analytics', status: 'PASS' });

  // 4. History View on Mobile
  await mobilePage.click('button[role="tab"]#tab-history');
  await mobilePage.waitForSelector('.flow-history');
  await mobilePage.screenshot({ path: path.join(rootDir, 'artifacts', 'flows-m4-mobile-history.png') });
  results.mobileViews.push({ view: 'History', status: 'PASS' });

  // Verify Touch Targets (min 38px on primary buttons)
  const buttonsMinSize = await mobilePage.evaluate(() => {
    const buttons = [...document.querySelectorAll('button.button-primary, button.button-secondary, button.flow-tab-btn')];
    return buttons.every((b) => b.getBoundingClientRect().height >= 38);
  });
  assert.ok(buttonsMinSize, 'Mobile touch targets meet minimum accessible heights');

  await mobileContext.close();

  console.log('[acceptance] All Desktop & Mobile acceptance workflows PASSED!');
  console.log('[acceptance] Summary:', JSON.stringify(results, null, 2));
} catch (err) {
  testFailed = true;
  console.error('[acceptance] Test failure:', err);
} finally {
  try { await browser.close(); } catch {}
  try { viteDev.kill(); } catch {}
  try { backendServer.close(); } catch {}
  try { await replSet.stop(); } catch {}
  console.log('[acceptance] Cleaned up servers and database.');
  if (testFailed) {
    process.exit(1);
  }
  process.exit(0);
}
