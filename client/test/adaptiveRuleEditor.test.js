import assert from 'node:assert/strict';
import React from 'react';
import { after, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });
const { default: AdaptiveRuleEditor } = await vite.ssrLoadModule('/src/components/AdaptiveRuleEditor.jsx');
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
