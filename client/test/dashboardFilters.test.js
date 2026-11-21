import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { scheduleDashboardFilters } from '../src/utils/dashboardFilters.js';

test('dashboard tag filtering waits for the debounce and cancels superseded values', async () => {
  const applied = [];
  const cancelFirst = scheduleDashboardFilters({ query: '', tag: 'spr', delay: 5, apply: (value) => applied.push(value) });
  cancelFirst();
  scheduleDashboardFilters({ query: 'launch', tag: 'spring', delay: 5, apply: (value) => applied.push(value) });
  assert.deepEqual(applied, []);
  await delay(20);
  assert.deepEqual(applied, [{ search: 'launch', filterTag: 'spring' }]);
});
