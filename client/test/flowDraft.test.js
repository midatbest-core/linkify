import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEventLifecycleGraph, createFlowDraft, detectCreatorTimeZone, durationLabel, isSupportedFlowConnection } from '../src/utils/flowDraft.js';

test('event lifecycle template has one decision and four directional outcomes', () => {
  const graph = createEventLifecycleGraph();
  assert.equal(graph.nodes.length, 6);
  assert.equal(graph.edges.length, 5);
  assert.deepEqual(graph.edges.filter((edge) => edge.source === 'router').map((edge) => edge.target), ['before', 'during', 'after', 'fallback']);
  assert.ok(graph.edges.every((edge) => edge.label && edge.data.conditionLabel));
});

test('flow timezone is captured once at draft creation and supports an explicit zone', () => {
  const detected = detectCreatorTimeZone();
  assert.equal(typeof detected, 'string');
  assert.ok(detected.length > 0);
  const draft = createFlowDraft('Asia/Kolkata');
  assert.equal(draft.timeZone, 'Asia/Kolkata');
  assert.equal(draft.timeZoneSource, 'creator-at-creation');
  assert.equal(draft.scheduleStorage, 'utc-instants-with-iana-zone');
});

test('connections are limited to the routing shape and cycles or duplicates are rejected', () => {
  const { nodes, edges } = createEventLifecycleGraph();
  assert.equal(isSupportedFlowConnection({ source: 'before', target: 'router' }, nodes, []), false);
  assert.equal(isSupportedFlowConnection({ source: 'router', target: 'before' }, nodes, []), true);
  assert.equal(isSupportedFlowConnection({ source: 'router', target: 'before' }, nodes, edges), false);
  assert.equal(isSupportedFlowConnection({ source: 'router', target: 'router' }, nodes, []), false);
});

test('duration display describes valid schedule windows', () => {
  assert.equal(durationLabel('2026-11-24T10:00', '2026-11-25T12:30'), '1d 2h 30m');
  assert.equal(durationLabel('2026-11-24T12:00', '2026-11-24T10:00'), 'End must be after start');
});
