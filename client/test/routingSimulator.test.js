import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beginLatestRequest, finishLatestRequest, isLatestRequest } from '../src/utils/latestRequest.js';
import { getServerConditionSummary } from '../src/utils/routingSimulation.js';

test('simulator cancels superseded requests and ignores stale responses', () => {
  const reference = { current: null };
  const first = beginLatestRequest(reference);
  const second = beginLatestRequest(reference);
  assert.equal(first.signal.aborted, true);
  assert.equal(isLatestRequest(reference, first), false);
  assert.equal(isLatestRequest(reference, second), true);
  assert.equal(finishLatestRequest(reference, first), false);
  assert.equal(finishLatestRequest(reference, second), true);
  assert.equal(reference.current, null);
});

test('simulator displays the server-authoritative condition summary', () => {
  const simulation = {
    matchedRule: {
      conditionSummary: 'mobile device AND country IN',
      conditions: { deviceType: 'desktop', countryCode: 'US' },
    },
  };
  assert.equal(getServerConditionSummary(simulation), 'mobile device AND country IN');
  assert.equal(getServerConditionSummary({ matchedRule: null }), '');
});
