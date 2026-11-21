import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beginLatestRequest, cancelLatestRequest, finishLatestRequest, isLatestRequest } from '../src/utils/latestRequest.js';

test('alias checks cancel superseded requests and reject stale response ownership', () => {
  const reference = { current: null };
  const first = beginLatestRequest(reference);
  const second = beginLatestRequest(reference);
  assert.equal(first.signal.aborted, true);
  assert.equal(isLatestRequest(reference, first), false);
  assert.equal(isLatestRequest(reference, second), true);
  assert.equal(finishLatestRequest(reference, first), false);
  cancelLatestRequest(reference);
  assert.equal(second.signal.aborted, true);
  assert.equal(reference.current, null);
});
