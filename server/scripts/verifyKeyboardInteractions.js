import assert from 'node:assert/strict';
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
import { selectVariant, normalizeAndValidateExperiments } from '../src/services/experimentService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

// Clean up stale processes on 5174 or 5000
try {
  if (process.platform === 'win32') {
    execSync('powershell -Command "$p = (Get-NetTCPConnection -LocalPort 5174, 5000 -ErrorAction SilentlyContinue).OwningProcess; if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }"');
  }
} catch {}

console.log('[test-run] 1. Initializing MongoMemoryReplSet...');
const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
const mongoUri = replSet.getUri();
await mongoose.connect(mongoUri, { dbName: 'linkify_keyboard_test' });
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
console.log('[test-run] Backend listening on http://localhost:5000');

// Seed a standard test link for dashboard input verification
await Link.create({
  shortCode: 'dashlink1',
  originalUrl: 'https://example.com/initial-target',
  title: 'Dashboard Test Link',
  tags: ['testing', 'keyboard'],
  status: 'active',
  lifetimeRedirectCount: 0,
});

console.log('[test-run] Starting Vite dev server on port 5174...');
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
console.log('[test-run] Vite dev server ready at http://localhost:5174');

// ============================================================================
// PART 1: Playwright Browser Keyboard Verification
// ============================================================================
console.log('\n[test-run] Launching Chromium browser for Playwright keyboard testing...');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

try {
  // Login
  await page.goto('http://localhost:5174');
  await page.waitForSelector('input[autocomplete="username"]');
  await page.fill('input[autocomplete="username"]', 'test-admin');
  await page.fill('input[autocomplete="current-password"]', 'test-password');
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('nav button:has-text("Flows")');
  console.log('✓ Signed in successfully.');

  // Navigate to Flows tab
  await page.click('nav button:has-text("Flows")');
  await page.waitForSelector('[data-testid="create-flow-button"], [data-testid="create-first-flow-button"]');

  // Open Create Flow modal
  await page.click('[data-testid="create-flow-button"], [data-testid="create-first-flow-button"]');
  await page.waitForSelector('[data-testid="event-name-input"]');
  console.log('✓ Create Flow dialog opened.');

  const eventInput = page.locator('[data-testid="event-name-input"]');

  // Test 1a: Real keyboard typing character-by-character
  await eventInput.focus();
  await page.keyboard.type('Annual Tech Summit 2026');
  let val = await eventInput.inputValue();
  assert.equal(val, 'Annual Tech Summit 2026', `Typing failed: expected "Annual Tech Summit 2026", got "${val}"`);
  console.log('✓ Keyboard typing verified:', val);

  // Test 1b: Editing with Backspace and typing replacement text
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Backspace');
  }
  await page.keyboard.type('Global');
  val = await eventInput.inputValue();
  assert.equal(val, 'Annual Tech Summit Global', `Editing failed: expected "Annual Tech Summit Global", got "${val}"`);
  console.log('✓ Keyboard editing with backspace verified:', val);

  // Test 1c: Deleting text with Select All (Control+A) and Backspace
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  val = await eventInput.inputValue();
  assert.equal(val, '', `Deleting failed: expected empty string, got "${val}"`);
  console.log('✓ Keyboard Select-All and delete verified: field is empty.');

  // Test 1d: Pasting text or re-typing final event name
  await page.keyboard.type('DeepCytes Developer Conference');
  val = await eventInput.inputValue();
  assert.equal(val, 'DeepCytes Developer Conference');

  // Test description typing
  const descInput = page.locator('[data-testid="event-description-input"]');
  await descInput.focus();
  await page.keyboard.type('Comprehensive full-stack engineering conference.');
  const descVal = await descInput.inputValue();
  assert.equal(descVal, 'Comprehensive full-stack engineering conference.');
  console.log('✓ Description input typing verified.');

  // Save Event Settings to proceed to Flow Builder
  const saveBtn = page.locator('[data-testid="event-settings-save-button"]');
  await saveBtn.click();
  await page.waitForSelector('.flow-workspace');
  console.log('✓ Successfully saved event settings and entered Flow workspace.');

  // Step 1e: Test Event Settings button in builder toolbar
  await page.waitForSelector('[data-testid="event-settings-toolbar-button"]');
  await page.click('[data-testid="event-settings-toolbar-button"]');
  await page.waitForSelector('[data-testid="event-name-input"]');

  const editEventInput = page.locator('[data-testid="event-name-input"]');
  const existingVal = await editEventInput.inputValue();
  assert.equal(existingVal, 'DeepCytes Developer Conference');

  // Append text via keyboard in edit mode
  await editEventInput.focus();
  await page.keyboard.type(' - Europe');
  const editedVal = await editEventInput.inputValue();
  assert.equal(editedVal, 'DeepCytes Developer Conference - Europe');

  // Save edited settings
  await page.click('[data-testid="event-settings-save-button"]');
  await page.waitForSelector('.flow-workspace');
  console.log('✓ Event Settings modal edit and re-save verified inside Flow Builder.');

  // Step 1f: Test Dashboard input fields (search, tag filter, link edit)
  await page.click('nav button:has-text("Dashboard")');
  await page.waitForSelector('input[placeholder*="Search links"]');
  console.log('✓ Navigated back to Links Dashboard.');

  // Search input typing
  const searchInput = page.locator('input[placeholder*="Search links"]');
  await searchInput.focus();
  await page.keyboard.type('Dashboard');
  let searchVal = await searchInput.inputValue();
  assert.equal(searchVal, 'Dashboard');
  console.log('✓ Dashboard search input typing verified:', searchVal);

  // Clear search input
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  searchVal = await searchInput.inputValue();
  assert.equal(searchVal, '');

  // Tag filter input typing
  const tagInput = page.locator('input[placeholder*="Filter by tag"]');
  await tagInput.focus();
  await page.keyboard.type('keyboard');
  let tagVal = await tagInput.inputValue();
  assert.equal(tagVal, 'keyboard');
  console.log('✓ Dashboard tag filter typing verified:', tagVal);

  // Clear tag input
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');

  // Open Edit form on the seeded link
  await page.waitForSelector('summary:has-text("More actions")');
  await page.click('summary:has-text("More actions")');
  await page.waitForSelector('button:has-text("Edit")');
  await page.click('button:has-text("Edit")');
  await page.waitForSelector('.link-card label:has-text("Title") input');

  const titleInput = page.locator('.link-card label:has-text("Title") input');
  await titleInput.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Updated Dashboard Link Title');
  const newTitle = await titleInput.inputValue();
  assert.equal(newTitle, 'Updated Dashboard Link Title');
  console.log('✓ Link edit Title typing verified:', newTitle);

  // Test A/B Traffic Experimentation toggle in link edit
  const abToggle = page.locator('label:has-text("A/B Traffic Experimentation") input[type="checkbox"]');
  await abToggle.click();
  await page.waitForSelector('input[placeholder="Variant B label"]');
  console.log('✓ A/B Experimentation enabled in dashboard edit form.');

  // Verify helper text is visible
  const helperText = await page.locator('text=Returning visitors retain their assigned variant for 24 hours').isVisible();
  assert.ok(helperText, 'Helper text about 24-hour sticky variant retention must be visible');
  console.log('✓ A/B 24-hour sticky cookie helper text verified in UI.');

  // Type in Variant B destination URL
  const varBUrl = page.locator('input[placeholder="https://example.com/page-b"]');
  await varBUrl.focus();
  await page.keyboard.type('https://example.com/page-b-tested');
  const varBVal = await varBUrl.inputValue();
  assert.equal(varBVal, 'https://example.com/page-b-tested');
  console.log('✓ Variant B URL keyboard typing verified.');

} finally {
  await browser.close();
  viteDev.kill();
  backendServer.close();
  await mongoose.disconnect();
  await replSet.stop();
}

// ============================================================================
// PART 2: Comprehensive A/B Distribution and Sticky Verification
// ============================================================================
console.log('\n[test-run] Starting Part 2: A/B Distribution and Isolation Tests...');

// 2a. 1,000 independent visitor assignments with 50/50 split
{
  const exp5050 = {
    enabled: true,
    variants: [
      { variantId: 'v-alpha', label: 'Variant A', destinationUrl: 'https://example.com/a', weight: 50 },
      { variantId: 'v-beta', label: 'Variant B', destinationUrl: 'https://example.com/b', weight: 50 },
    ],
  };

  let countA = 0;
  let countB = 0;
  for (let i = 0; i < 1000; i++) {
    const s = selectVariant(exp5050, {}, { shortCode: `test50_${i}`, stageId: 'default' });
    assert.equal(s.isNewAssignment, true);
    if (s.variant.variantId === 'v-alpha') countA++;
    else countB++;
  }
  console.log(`✓ 50/50 split over 1,000 runs: Variant A = ${countA} (${(countA/10).toFixed(1)}%), Variant B = ${countB} (${(countB/10).toFixed(1)}%)`);
  assert.ok(countA >= 430 && countA <= 570, `Count A (${countA}) must be within statistical tolerance of 500`);
}

// 2b. 80/20 configuration
{
  const exp8020 = {
    enabled: true,
    variants: [
      { variantId: 'v-alpha', label: 'Variant A', destinationUrl: 'https://example.com/a', weight: 80 },
      { variantId: 'v-beta', label: 'Variant B', destinationUrl: 'https://example.com/b', weight: 20 },
    ],
  };
  let count80 = 0;
  for (let i = 0; i < 1000; i++) {
    const s = selectVariant(exp8020, {}, { shortCode: `test80_${i}`, stageId: 'default' });
    if (s.variant.variantId === 'v-alpha') count80++;
  }
  console.log(`✓ 80/20 split over 1,000 runs: Variant A = ${count80} (${(count80/10).toFixed(1)}%), Variant B = ${1000 - count80} (${((1000 - count80)/10).toFixed(1)}%)`);
  assert.ok(count80 >= 740 && count80 <= 860, `Count A (${count80}) must be within statistical tolerance of 800`);
}

// 2c. 100/0 configuration
{
  const norm100 = normalizeAndValidateExperiments({
    enabled: true,
    variants: [
      { variantId: 'v-alpha', destinationUrl: 'https://example.com/a', weight: 100 },
      { variantId: 'v-beta', destinationUrl: 'https://example.com/b', weight: 0 },
    ],
  });
  assert.equal(norm100.error, undefined);
  for (let i = 0; i < 1000; i++) {
    const s = selectVariant(norm100.value, {}, { shortCode: `test100_${i}`, stageId: 'default' });
    assert.equal(s.variant.variantId, 'v-alpha');
  }
  console.log('✓ 100/0 split over 1,000 runs: exactly 1,000 Variant A (100.0%) and 0 Variant B (0.0%).');
}

// 2d. 0/100 configuration
{
  const norm0 = normalizeAndValidateExperiments({
    enabled: true,
    variants: [
      { variantId: 'v-alpha', destinationUrl: 'https://example.com/a', weight: 0 },
      { variantId: 'v-beta', destinationUrl: 'https://example.com/b', weight: 100 },
    ],
  });
  assert.equal(norm0.error, undefined);
  for (let i = 0; i < 1000; i++) {
    const s = selectVariant(norm0.value, {}, { shortCode: `test0_${i}`, stageId: 'default' });
    assert.equal(s.variant.variantId, 'v-beta');
  }
  console.log('✓ 0/100 split over 1,000 runs: exactly 0 Variant A (0.0%) and 1,000 Variant B (100.0%).');
}

// 2e. Sticky assignment across 100 repeated visits
{
  const expSticky = {
    enabled: true,
    variants: [
      { variantId: 'v-alpha', label: 'Variant A', destinationUrl: 'https://example.com/a', weight: 50 },
      { variantId: 'v-beta', label: 'Variant B', destinationUrl: 'https://example.com/b', weight: 50 },
    ],
  };
  const firstVisit = selectVariant(expSticky, {}, { shortCode: 'stickyTest', stageId: 'default' });
  const assigned = firstVisit.variant.variantId;
  const cookieJar = { [firstVisit.cookieName]: firstVisit.cookieValue };

  for (let repeat = 1; repeat <= 100; repeat++) {
    const nextVisit = selectVariant(expSticky, cookieJar, { shortCode: 'stickyTest', stageId: 'default' });
    assert.equal(nextVisit.isNewAssignment, false);
    assert.equal(nextVisit.variant.variantId, assigned, `Repeat visit #${repeat} must stick to ${assigned}`);
  }
  console.log(`✓ Sticky cookie verified: 100 repeated visits consistently returned assigned variant ${assigned}.`);
}

// 2f. Experiment isolation across links and Flow stages
{
  const expLinkA = {
    enabled: true,
    variants: [
      { variantId: 'linkA_alpha', destinationUrl: 'https://example.com/a1', weight: 50 },
      { variantId: 'linkA_beta', destinationUrl: 'https://example.com/a2', weight: 50 },
    ],
  };
  const expLinkB = {
    enabled: true,
    variants: [
      { variantId: 'linkB_one', destinationUrl: 'https://example.com/b1', weight: 50 },
      { variantId: 'linkB_two', destinationUrl: 'https://example.com/b2', weight: 50 },
    ],
  };

  const cookies = {
    linkify_ab_linkA_default: 'linkA_beta',
    linkify_ab_eventFlow_beforeStage: 'linkA_alpha',
  };

  // linkA honors its cookie
  const resA = selectVariant(expLinkA, cookies, { shortCode: 'linkA', stageId: 'default' });
  assert.equal(resA.variant.variantId, 'linkA_beta');
  assert.equal(resA.isNewAssignment, false);

  // linkB is NOT affected by linkA's cookie
  const resB = selectVariant(expLinkB, cookies, { shortCode: 'linkB', stageId: 'default' });
  assert.equal(resB.isNewAssignment, true);
  assert.equal(resB.cookieName, 'linkify_ab_linkB_default');

  // Flow stageAfter is NOT affected by beforeStage's cookie
  const resStageAfter = selectVariant(expLinkA, cookies, { shortCode: 'eventFlow', stageId: 'afterStage' });
  assert.equal(resStageAfter.isNewAssignment, true);
  assert.equal(resStageAfter.cookieName, 'linkify_ab_eventFlow_afterStage');

  console.log('✓ Experiment isolation across links and Flow stages verified.');
}

console.log('\n[test-run] ALL KEYBOARD INTERACTION AND A/B TESTS PASSED SUCCESSFULLY!\n');
