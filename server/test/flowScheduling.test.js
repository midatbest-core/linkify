import assert from 'node:assert/strict';
import { test } from 'node:test';
import Flow from '../src/models/Flow.js';
import { normalizeFlowPayload } from '../src/services/flowService.js';
import { localDateTimeToUtcCandidates, resolveLocalDateTime } from '../src/utils/schedule.js';

function graph({ fallback = 'https://example.com/fallback', duringSchedule, extra = [] } = {}) {
  const node = (id, kind, data = {}, y = 0) => ({ id, type: 'flowNode', position: { x: kind === 'destination' || kind === 'fallback' ? 700 : 100, y }, data: { kind, label: id, ...data } });
  const nodes = [
    node('entry', 'entry'), node('router', 'router'),
    node('before', 'destination', { phase: 'before', destinationUrl: 'https://example.com/before', schedule: {} }, 0),
    node('during', 'destination', { phase: 'during', destinationUrl: 'https://example.com/during', schedule: duringSchedule ?? {} }, 100),
    node('after', 'destination', { phase: 'after', destinationUrl: 'https://example.com/after', schedule: {} }, 200),
    node('fallback', 'fallback', { destinationUrl: fallback }, 300), ...extra,
  ];
  return { nodes, edges: [{ id: 'entry-router', source: 'entry', target: 'router', label: 'Every visit' }, ...nodes.filter((item) => ['destination', 'fallback'].includes(item.data.kind)).map((item) => ({ id: `router-${item.id}`, source: 'router', target: item.id, label: item.id }))] };
}
function payload(overrides = {}) { return { eventName: 'Conference', creatorTimeZone: 'Asia/Kolkata', eventStartLocal: '2026-12-01T09:00', eventEndLocal: '2026-12-01T17:00', graph: graph(), ...overrides }; }

test('Flow schema separates presentation from routing and provides revision and publication fields', () => {
  const paths = Flow.schema.paths;
  assert.ok(paths.flowId); assert.ok(paths.revision); assert.ok(paths['draft.presentation.nodes']); assert.ok(paths['draft.routing.stages']);
  assert.ok(paths.publishedRevision); assert.ok(paths.linkId);
});

test('default lifecycle uses inclusive start, exclusive end and open-ended before/after phases', () => {
  const { value, validation } = normalizeFlowPayload(payload());
  const stages = Object.fromEntries(value.draft.routing.stages.map((stage) => [stage.phase, stage]));
  assert.equal(stages.before.startAtUtc, null);
  assert.equal(stages.before.endAtUtc.toISOString(), value.eventStartAtUtc.toISOString());
  assert.equal(stages.during.startAtUtc.toISOString(), value.eventStartAtUtc.toISOString());
  assert.equal(stages.during.endAtUtc.toISOString(), value.eventEndAtUtc.toISOString());
  assert.equal(stages.after.startAtUtc.toISOString(), value.eventEndAtUtc.toISOString());
  assert.equal(stages.after.endAtUtc, null);
  assert.equal(validation.publishable, true);
  assert.equal(validation.timeline.find((item) => item.phase === 'before').openStart, true);
});

test('normalizes Asia/Kolkata and UTC schedules to authoritative UTC instants', () => {
  const india = normalizeFlowPayload(payload()).value;
  assert.equal(india.eventStartAtUtc.toISOString(), '2026-12-01T03:30:00.000Z');
  const utc = normalizeFlowPayload(payload({ creatorTimeZone: 'UTC' })).value;
  assert.equal(utc.eventStartAtUtc.toISOString(), '2026-12-01T09:00:00.000Z');
});

test('DST ambiguity is explicit and nonexistent wall times are rejected', () => {
  const candidates = localDateTimeToUtcCandidates('2026-11-01T01:30', 'America/New_York');
  assert.equal(candidates.length, 2);
  assert.notEqual(resolveLocalDateTime('2026-11-01T01:30', 'America/New_York', 'earlier').value.toISOString(), resolveLocalDateTime('2026-11-01T01:30', 'America/New_York', 'later').value.toISOString());
  assert.throws(() => normalizeFlowPayload(payload({ creatorTimeZone: 'America/New_York', eventStartLocal: '2026-11-01T01:30' })), /occurs twice/);
  assert.doesNotThrow(() => normalizeFlowPayload(payload({ creatorTimeZone: 'America/New_York', eventStartLocal: '2026-11-01T01:30', eventStartDisambiguation: 'later' })));
  assert.throws(() => normalizeFlowPayload(payload({ creatorTimeZone: 'America/New_York', eventStartLocal: '2026-03-08T02:30' })), /does not exist/);
});

test('overlaps, invalid event order and missing fallback block publishability while drafts remain normalizable', () => {
  const overlap = normalizeFlowPayload(payload({ graph: graph({ duringSchedule: { startLocal: '2026-12-01T08:00', endLocal: '2026-12-01T18:00' } }) })).validation;
  assert.equal(overlap.publishable, false);
  assert.ok(overlap.errors.some((item) => item.code === 'schedule_overlap'));
  const reversed = normalizeFlowPayload(payload({ eventEndLocal: '2026-12-01T08:00' })).validation;
  assert.ok(reversed.errors.some((item) => item.code === 'event_window_order'));
  const fallback = normalizeFlowPayload(payload({ graph: graph({ fallback: '' }) })).validation;
  assert.ok(fallback.errors.some((item) => item.code === 'fallback_required'));
});

test('uncovered custom stages produce schedule gap diagnostics and finite windows retain exact duration', () => {
  const custom = { id: 'break', type: 'flowNode', position: { x: 700, y: 400 }, data: { kind: 'destination', phase: 'custom', label: 'Break', destinationUrl: 'https://example.com/break', schedule: { startLocal: '2026-12-01T12:00', endLocal: '2026-12-01T12:30' } } };
  const result = normalizeFlowPayload(payload({ graph: graph({ extra: [custom] }) })).validation;
  assert.ok(result.errors.some((item) => item.code === 'schedule_overlap'));
  const timeline = result.timeline.find((item) => item.nodeId === 'break');
  assert.equal(new Date(timeline.endAtUtc) - new Date(timeline.startAtUtc), 30 * 60 * 1000);
});

test('invalid URLs and unsupported graph connections are rejected', () => {
  const invalidUrl = graph(); invalidUrl.nodes.find((node) => node.id === 'during').data.destinationUrl = 'javascript:alert(1)';
  assert.throws(() => normalizeFlowPayload(payload({ graph: invalidUrl })), /destination/);
  const invalidEdge = graph(); invalidEdge.edges.push({ id: 'cycle', source: 'during', target: 'router' });
  assert.throws(() => normalizeFlowPayload(payload({ graph: invalidEdge })), /not supported/);
});
