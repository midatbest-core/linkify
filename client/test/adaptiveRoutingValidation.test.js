import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstInvalidAdaptiveRule, getAdaptiveRuleUrlError } from '../src/utils/adaptiveRoutingValidation.js';

test('adaptive rule URL validation rejects blank and non-web URLs with actionable messages', () => {
  assert.equal(getAdaptiveRuleUrlError(''), 'Enter a destination URL for this rule.');
  assert.match(getAdaptiveRuleUrlError('javascript:alert(1)'), /http:\/\/ or https:\/\//);
  assert.equal(getAdaptiveRuleUrlError('https://example.com/path'), '');
});

test('adaptive form validation reports the first invalid rule and accepts an empty rule list', () => {
  assert.deepEqual(firstInvalidAdaptiveRule([
    { destinationUrl: 'https://valid.example' },
    { destinationUrl: '' },
    { destinationUrl: 'http://also-valid.example' },
  ]), { index: 1, message: 'Enter a destination URL for this rule.' });
  assert.equal(firstInvalidAdaptiveRule([]), null);
});
