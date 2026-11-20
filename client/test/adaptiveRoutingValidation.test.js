import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstInvalidAdaptiveRule, getAdaptiveRuleSummary, getAdaptiveRuleUrlError, serializeAdaptiveRule } from '../src/utils/adaptiveRoutingValidation.js';

test('adaptive rule URL validation rejects blank and non-web URLs with actionable messages', () => {
  assert.equal(getAdaptiveRuleUrlError(''), 'Enter a destination URL for this rule.');
  assert.match(getAdaptiveRuleUrlError('javascript:alert(1)'), /http:\/\/ or https:\/\//);
  assert.equal(getAdaptiveRuleUrlError('https://example.com/path'), '');
});

test('adaptive form validation reports the first invalid rule and accepts an empty rule list', () => {
  assert.deepEqual(firstInvalidAdaptiveRule([
    { deviceType: 'desktop', destinationUrl: 'https://valid.example' },
    { deviceType: 'mobile', destinationUrl: '' },
    { deviceType: 'tablet', destinationUrl: 'http://also-valid.example' },
  ]), { index: 1, message: 'Enter a destination URL for this rule.' });
  assert.equal(firstInvalidAdaptiveRule([]), null);
});

test('smart routing rules serialize only configured conditions and describe AND precedence', () => {
  const rule = { ruleId: 'smart', deviceType: '', countryCode: 'IN', startAt: '2025-01-01T09:00', endAt: '', timeZone: 'Asia/Kolkata', campaign: { source: 'Spring', medium: '' }, destinationUrl: 'https://example.com/in', enabled: true };
  assert.deepEqual(serializeAdaptiveRule(rule), { ruleId: 'smart', countryCode: 'IN', startAt: '2025-01-01T09:00', timeZone: 'Asia/Kolkata', campaign: { source: 'Spring' }, destinationUrl: 'https://example.com/in', enabled: true });
  assert.match(getAdaptiveRuleSummary(rule), /country IN AND active/);
  assert.match(getAdaptiveRuleSummary(rule), /utm_source = “Spring”/);
  assert.equal(firstInvalidAdaptiveRule([rule]), null);
  assert.match(firstInvalidAdaptiveRule([{ ...rule, endAt: '2024-01-01T00:00' }]).message, /end time must be after/);
  assert.match(firstInvalidAdaptiveRule([{ ...rule, campaign: { source: 'bad\ninput' } }]).message, /Check/);
});
