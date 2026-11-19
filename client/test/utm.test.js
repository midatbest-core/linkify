import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUtmPreview } from '../src/utils/utm.js';

test('UTM preview preserves existing values, query data, and URL fragments', () => {
  const result = buildUtmPreview('https://example.test/shop?utm_source=old&ref=hero#plans', {
    utm_source: 'new source', utm_medium: 'email & social', utm_campaign: 'spring sale',
  });
  const url = new URL(result.url);
  assert.equal(url.searchParams.get('utm_source'), 'old');
  assert.equal(url.searchParams.get('utm_medium'), 'email & social');
  assert.equal(url.searchParams.get('ref'), 'hero');
  assert.equal(url.hash, '#plans');
  assert.deepEqual(result.conflicts, ['utm_source']);
});
