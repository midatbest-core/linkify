import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAnalyticsLabel, formatCountryName } from '../src/utils/analyticsDisplay.js';

test('analytics display labels normalize known categories and gracefully handle missing values', () => {
  assert.equal(formatAnalyticsLabel('unknown'), 'Unknown');
  assert.equal(formatAnalyticsLabel('mobile'), 'Mobile');
  assert.equal(formatAnalyticsLabel('desktop'), 'Desktop');
  assert.equal(formatAnalyticsLabel('tablet'), 'Tablet');
  assert.equal(formatAnalyticsLabel('chrome'), 'Chrome');
  assert.equal(formatAnalyticsLabel('macOS'), 'macOS');
  assert.equal(formatAnalyticsLabel(undefined), 'Unknown');
  assert.equal(formatAnalyticsLabel(undefined, '—'), '—');
});

test('country display names use canonical locale casing without altering proper-name casing', () => {
  assert.equal(formatCountryName('india', 'IN'), 'India');
  assert.equal(formatCountryName('United States', 'US'), 'United States');
  assert.equal(formatAnalyticsLabel('McAllen'), 'McAllen');
  assert.equal(formatAnalyticsLabel('Mountain View'), 'Mountain View');
});
