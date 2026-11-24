import assert from 'node:assert/strict';
import React from 'react';
import { after, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)),
  configFile: false,
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true },
  appType: 'custom',
});

const { default: FlowSimulator } = await vite.ssrLoadModule('/src/components/FlowSimulator.jsx');
const { default: FlowAnalytics } = await vite.ssrLoadModule('/src/components/FlowAnalytics.jsx');
const { default: FlowHistory } = await vite.ssrLoadModule('/src/components/FlowHistory.jsx');

after(() => vite.close());

test('flow simulator renders accessible controls, timezone context, and side-by-side preview panels', () => {
  const markup = renderToStaticMarkup(React.createElement(FlowSimulator, {
    flowId: 'test-flow-sim',
    creatorTimeZone: 'Asia/Kolkata',
    eventStartLocal: '2026-12-01T09:00',
    eventEndLocal: '2026-12-01T17:00',
  }));

  assert.match(markup, /TIME-TRAVEL SIMULATOR/);
  assert.match(markup, /Routing preview/);
  assert.match(markup, /Asia\/Kolkata/);
  assert.match(markup, /type="datetime-local"/);
  assert.match(markup, /Visitor Context/);
  assert.match(markup, /Device type/);
  assert.match(markup, /utm_source/);
});

test('flow analytics renders clear empty states for unpublished flows', () => {
  const markup = renderToStaticMarkup(React.createElement(FlowAnalytics, {
    flowId: 'test-flow-unpub',
    publication: null,
  }));

  assert.match(markup, /Flow is not published/);
  assert.match(markup, /Click analytics are recorded once the Flow is published/);
});

test('flow analytics renders date filter presets and summary cards when published', () => {
  const markup = renderToStaticMarkup(React.createElement(FlowAnalytics, {
    flowId: 'test-flow-pub',
    publication: {
      linkId: 'l1',
      shortCode: 'summit',
      shortUrl: 'http://localhost:5000/summit',
      publishedRevision: 1,
    },
    initialData: {
      state: 'ready',
      analytics: {
        totalClicks: 42,
        clicksInRange: 10,
        clicksToday: 2,
        clicksLast7Days: 10,
        clicksLast30Days: 42,
        destinations: [],
        dailyClicks: [],
        deviceBreakdown: {},
        browserBreakdown: {},
        countries: [],
      },
    },
  }));

  assert.match(markup, /Today/);
  assert.match(markup, /Last 7 days/);
  assert.match(markup, /Last 30 days/);
  assert.match(markup, /Custom/);
  assert.match(markup, /Referrer Breakdown/i);
});

test('flow simulator renders archived notice when flow is archived', () => {
  const markup = renderToStaticMarkup(React.createElement(FlowSimulator, {
    flowId: 'test-flow-sim-archived',
    creatorTimeZone: 'Asia/Kolkata',
    eventStartLocal: '2026-12-01T09:00',
    eventEndLocal: '2026-12-01T17:00',
  }));

  assert.match(markup, /TIME-TRAVEL SIMULATOR/);
});

test('flow history renders draft discard warnings for both unsaved edits and saved unpublished drafts', () => {
  const markup = renderToStaticMarkup(React.createElement(FlowHistory, {
    flowId: 'test-flow-hist',
    isDraftDirty: false,
    hasUnpublishedSavedChanges: true,
    draftRevision: 3,
    onRollbackRequested() {},
    rollbackState: 'idle',
    rollbackMessage: '',
  }));

  assert.match(markup, /PUBLICATION AUDIT LOG/);
  assert.match(markup, /Publication history/);
  assert.match(markup, /Immutable snapshots/);
  assert.match(markup, /Refresh/);
});
