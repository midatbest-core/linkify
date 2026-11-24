import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileFlowToAdaptiveRouting } from '../src/services/flowCompiler.js';
import { normalizeFlowPayload } from '../src/services/flowService.js';
import { resolveAdaptiveDestination } from '../src/services/adaptiveRoutingService.js';

function graph({ duringUrl = 'https://example.com/live', includeDuring = true, custom } = {}) {
  const nodes = [
    { id: 'entry', position: { x: 10, y: 20 }, data: { kind: 'entry', label: 'Entry' } },
    { id: 'router', position: { x: 200, y: 20 }, data: { kind: 'router', label: 'Router' } },
    { id: 'before', position: { x: 500, y: 0 }, data: { kind: 'destination', phase: 'before', label: 'Before', destinationUrl: 'https://example.com/register', schedule: {} } },
    ...(includeDuring ? [{ id: 'during', position: { x: 500, y: 100 }, data: { kind: 'destination', phase: 'during', label: 'During', destinationUrl: duringUrl, schedule: {} } }] : []),
    ...(custom ? [{ id: 'workshop', position: { x: 500, y: 150 }, data: { kind: 'destination', phase: 'custom', label: 'Workshop', destinationUrl: 'https://example.com/workshop', schedule: custom } }] : []),
    { id: 'after', position: { x: 500, y: 200 }, data: { kind: 'destination', phase: 'after', label: 'After', destinationUrl: 'https://example.com/replay', schedule: {} } },
    { id: 'fallback', position: { x: 500, y: 300 }, data: { kind: 'fallback', label: 'Fallback', destinationUrl: 'https://example.com/event' } },
  ];
  return { nodes, edges: [{ id: 'entry-router', source: 'entry', target: 'router' }, ...nodes.slice(2).map((node) => ({ id: `router-${node.id}`, source: 'router', target: node.id }))] };
}
function flow(options = {}) { return normalizeFlowPayload({ eventName: 'Summit', creatorTimeZone: options.creatorTimeZone ?? 'UTC', eventStartLocal: options.start ?? '2026-12-01T09:00', eventEndLocal: options.end ?? '2026-12-01T17:00', eventStartDisambiguation: options.disambiguation ?? 'earlier', eventEndDisambiguation: options.disambiguation ?? 'earlier', graph: options.graph ?? graph() }).value; }

test('compiler output uses the existing resolver with inclusive start and exclusive end boundaries', () => {
  const source = flow(); const routing = compileFlowToAdaptiveRouting(source); const link = { originalUrl: routing.defaultDestinationUrl, adaptiveRouting: routing };
  assert.equal(resolveAdaptiveDestination(link, { now: new Date('2026-12-01T08:59:59.999Z') }).matchedRuleId, 'before');
  assert.equal(resolveAdaptiveDestination(link, { now: new Date('2026-12-01T09:00:00.000Z') }).matchedRuleId, 'during');
  assert.equal(resolveAdaptiveDestination(link, { now: new Date('2026-12-01T16:59:59.999Z') }).matchedRuleId, 'during');
  assert.equal(resolveAdaptiveDestination(link, { now: new Date('2026-12-01T17:00:00.000Z') }).matchedRuleId, 'after');
  assert.equal(routing.rules.find((rule) => rule.ruleId === 'before').startAt, undefined);
  assert.equal(routing.rules.find((rule) => rule.ruleId === 'after').endAt, undefined);
});

test('custom stages compile with gaps routed to fallback and creator timezone retained', () => {
  const source = flow({ graph: graph({ includeDuring: false, custom: { startLocal: '2026-12-01T11:00', endLocal: '2026-12-01T12:00' } }) });
  const routing = compileFlowToAdaptiveRouting(source); const link = { originalUrl: routing.defaultDestinationUrl, adaptiveRouting: routing };
  assert.equal(resolveAdaptiveDestination(link, { now: new Date('2026-12-01T11:30:00.000Z') }).matchedRuleId, 'workshop');
  const gap = resolveAdaptiveDestination(link, { now: new Date('2026-12-01T13:00:00.000Z') });
  assert.equal(gap.usedFallback, true); assert.equal(gap.destinationUrl, 'https://example.com/event');
  assert.ok(routing.rules.every((rule) => rule.timeZone === 'UTC'));
});

test('compiler excludes presentation layout and preserves stable historical destination attribution', () => {
  const firstFlow = flow(); const first = compileFlowToAdaptiveRouting(firstFlow);
  const moved = structuredClone(firstFlow); moved.draft.presentation.nodes.forEach((node, index) => { node.position = { x: index * 900, y: index * -700 }; });
  const movedRouting = compileFlowToAdaptiveRouting(moved, { previousRouting: first });
  assert.deepEqual(movedRouting.rules.map(({ ruleId, startAt, endAt, destinationUrl }) => ({ ruleId, startAt, endAt, destinationUrl })), first.rules.map(({ ruleId, startAt, endAt, destinationUrl }) => ({ ruleId, startAt, endAt, destinationUrl })));
  const changedFlow = flow({ graph: graph({ duringUrl: 'https://example.com/new-live' }) }); const changed = compileFlowToAdaptiveRouting(changedFlow, { previousRouting: first });
  const oldDuring = first.rules.find((rule) => rule.ruleId === 'during'); const newDuring = changed.rules.find((rule) => rule.ruleId === 'during');
  assert.notEqual(oldDuring.destinationId, newDuring.destinationId);
  assert.ok(changed.destinations.some((destination) => destination.destinationId === oldDuring.destinationId && destination.destinationUrl === 'https://example.com/live'));
  assert.ok(changed.destinations.some((destination) => destination.destinationId === newDuring.destinationId && destination.destinationUrl === 'https://example.com/new-live'));
});

test('compiler rejects incomplete and unsupported publishable shapes', () => {
  const source = flow(); source.draft.routing.fallbackDestinationUrl = '';
  assert.throws(() => compileFlowToAdaptiveRouting(source), /fallback/i);
  const tooMany = flow();
  for (let index = 0; index < 21; index += 1) tooMany.draft.routing.stages.push({ nodeId: `extra-${index}`, phase: 'custom', destinationUrl: 'https://example.com', startAtUtc: new Date(`2027-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`), endAtUtc: new Date(`2027-01-${String(index + 1).padStart(2, '0')}T01:00:00Z`) });
  assert.throws(() => compileFlowToAdaptiveRouting(tooMany), /20 scheduled stages/);
});

test('DST-observing creator instants compile without reinterpreting UTC', () => {
  const source = flow({ creatorTimeZone: 'America/New_York', start: '2026-11-01T01:30', end: '2026-11-01T02:30', disambiguation: 'later' });
  const routing = compileFlowToAdaptiveRouting(source); const during = routing.rules.find((rule) => rule.ruleId === 'during');
  assert.equal(new Date(during.startAt).toISOString(), '2026-11-01T06:30:00.000Z');
  assert.equal(new Date(during.endAt).toISOString(), '2026-11-01T07:30:00.000Z');
});
