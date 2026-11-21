import assert from 'node:assert/strict';
import React from 'react';
import { after, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });
const { default: AdaptiveRuleEditor } = await vite.ssrLoadModule('/src/components/AdaptiveRuleEditor.jsx');
const { DailyChart, OverviewAnalytics } = await vite.ssrLoadModule('/src/components/AnalyticsViews.jsx');
const { default: QrCode } = await vite.ssrLoadModule('/src/components/QrCode.jsx');
after(() => vite.close());

test('adaptive rule editor renders a concise accessible IF/THEN rule summary and priority controls', () => {
  const markup = renderToStaticMarkup(React.createElement(AdaptiveRuleEditor, {
    rule: { ruleId: 'country-mobile', deviceType: 'mobile', countryCode: 'IN', destinationUrl: 'https://example.com/mobile', enabled: true },
    index: 0, count: 2, onChange() {}, onMove() {}, onRemove() {},
  }));
  assert.match(markup, /IF/);
  assert.match(markup, /THEN/);
  assert.match(markup, /country IN/);
  assert.match(markup, /Priority 1/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /Move rule 1 up/);
  assert.match(markup, /Edit rule/);
});


test('recent links remain visible with zero clicks and during analytics refresh', () => {
  const analytics = { totalClicks: 0, recentlyCreatedLinks: [{ id: 'recent', title: 'Recent campaign' }] };
  for (const loading of [false, true]) {
    const markup = renderToStaticMarkup(React.createElement(OverviewAnalytics, { analytics, loading }));
    assert.match(markup, /Recent campaign/);
    assert.match(markup, /No clicks in this date range/);
  }
});

test('charts expose keyboard instructions and a complete screen-reader data table', () => {
  const markup = renderToStaticMarkup(React.createElement(DailyChart, { rows: [
    { _id: '2026-11-20', count: 0 }, { _id: '2026-11-21', count: 3 },
  ] }));
  assert.match(markup, /tabindex="0"/);
  assert.match(markup, /Use Left and Right Arrow, Home, or End/);
  assert.match(markup, /<caption>Daily clicks data<\/caption>/);
  assert.match(markup, /2026-11-21/);
});

test('QR codes have an accessible name containing their destination', () => {
  const markup = renderToStaticMarkup(React.createElement(QrCode, { value: 'https://short.example/release' }));
  assert.match(markup, /role="img"/);
  assert.match(markup, /aria-label="QR code for https:\/\/short.example\/release"/);
});
