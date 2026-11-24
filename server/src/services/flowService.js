import { randomUUID } from 'node:crypto';
import { isValidTimeZone, resolveLocalDateTime, utcDateTimeToLocal } from '../utils/schedule.js';
import { normalizeAndValidateUrl } from '../utils/validation.js';
import { sanitizeProtectionForClient } from './linkProtectionService.js';

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const KINDS = new Set(['entry', 'router', 'destination', 'fallback']);
const PHASES = new Set(['before', 'during', 'after', 'custom']);
const MAX_NODES = 50;
const MAX_EDGES = 100;

function bad(message) { throw Object.assign(new Error(message), { status: 400 }); }
function cleanText(value, label, max, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > max) bad(`${label} must be a string of up to ${max} characters.`);
  return value.trim();
}
function normalizeWallTime(value, timeZone, disambiguation, label) {
  if (value === undefined || value === null || value === '') return { local: '', instant: null, disambiguation: disambiguation ?? 'earlier' };
  if (typeof value !== 'string') bad(`${label} must be a local date and time.`);
  if (disambiguation !== undefined && !['earlier', 'later'].includes(disambiguation)) bad(`${label} ambiguity choice must be earlier or later.`);
  const resolved = resolveLocalDateTime(value, timeZone, disambiguation);
  if (resolved.error) bad(`${label}: ${resolved.error}`);
  return { local: value, instant: resolved.value, disambiguation: disambiguation ?? 'earlier' };
}
function hasPath(edges, start, target) {
  const pending = [start]; const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (current === target) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of edges) if (edge.source === current) pending.push(edge.target);
  }
  return false;
}

function normalizeGraph(graph, timeZone, event) {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) bad('Flow graph must be an object.');
  const nodes = graph.nodes ?? []; const edges = graph.edges ?? [];
  if (!Array.isArray(nodes) || nodes.length > MAX_NODES) bad(`Flows support up to ${MAX_NODES} nodes.`);
  if (!Array.isArray(edges) || edges.length > MAX_EDGES) bad(`Flows support up to ${MAX_EDGES} edges.`);
  const nodeIds = new Set(); const presentationNodes = []; const stages = []; let fallbackNodeId = null; let fallbackDestinationUrl = '';
  for (const [index, node] of nodes.entries()) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) bad(`Node ${index + 1} is invalid.`);
    const nodeId = node.id ?? node.nodeId; const data = node.data ?? node;
    const kind = data.kind;
    if (typeof nodeId !== 'string' || !ID.test(nodeId) || nodeIds.has(nodeId)) bad('Node identifiers must be unique and contain only letters, numbers, underscores, or hyphens.');
    if (!KINDS.has(kind)) bad(`Node ${nodeId} has an unsupported type.`);
    nodeIds.add(nodeId);
    const x = Number(node.position?.x); const y = Number(node.position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100000 || Math.abs(y) > 100000) bad(`Node ${nodeId} must have a valid position.`);
    const label = cleanText(data.label, `Node ${nodeId} label`, 80);
    const description = cleanText(data.description, `Node ${nodeId} description`, 240);
    const phase = kind === 'destination' ? (data.phase ?? 'custom') : undefined;
    if (phase && !PHASES.has(phase)) bad(`Node ${nodeId} has an unsupported lifecycle phase.`);
    presentationNodes.push({ nodeId, kind, label, description, ...(phase ? { phase } : {}), position: { x, y } });
    if (kind === 'destination' || kind === 'fallback') {
      const rawUrl = data.destinationUrl ?? '';
      let destinationUrl = '';
      if (rawUrl) {
        const destination = normalizeAndValidateUrl(rawUrl);
        if (destination.error) bad(`Node ${nodeId} destination: ${destination.error}`);
        destinationUrl = destination.value;
      }
      if (kind === 'fallback') { if (fallbackNodeId) bad('A flow can contain only one fallback node.'); fallbackNodeId = nodeId; fallbackDestinationUrl = destinationUrl; }
      else {
        const schedule = data.schedule ?? {};
        if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) bad(`Node ${nodeId} schedule is invalid.`);
        const start = normalizeWallTime(schedule.startLocal, timeZone, schedule.startDisambiguation, `Node ${nodeId} start`);
        const end = normalizeWallTime(schedule.endLocal, timeZone, schedule.endDisambiguation, `Node ${nodeId} end`);
        const effectiveStart = start.instant ?? (phase === 'during' ? event.startAt : phase === 'after' ? event.endAt : null);
        const effectiveEnd = end.instant ?? (phase === 'before' ? event.startAt : phase === 'during' ? event.endAt : null);
        const experiments = data.experiments?.enabled && Array.isArray(data.experiments.variants) && data.experiments.variants.length === 2 ? {
          enabled: true,
          variants: data.experiments.variants.map((v) => ({
            variantId: v.variantId,
            label: v.label,
            destinationUrl: v.destinationUrl,
            weight: v.weight,
          })),
        } : undefined;
        stages.push({ nodeId, phase, destinationUrl, ...(experiments ? { experiments } : {}), startLocal: start.local, endLocal: end.local, startDisambiguation: start.disambiguation, endDisambiguation: end.disambiguation, startAtUtc: effectiveStart, endAtUtc: effectiveEnd });
      }
    }
  }
  const edgeIds = new Set(); const pairs = new Set(); const normalizedEdges = [];
  for (const [index, edge] of edges.entries()) {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) bad(`Edge ${index + 1} is invalid.`);
    const edgeId = edge.id ?? edge.edgeId; const { source, target } = edge;
    if (typeof edgeId !== 'string' || !ID.test(edgeId) || edgeIds.has(edgeId)) bad('Edge identifiers must be unique valid identifiers.');
    if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) bad(`Edge ${edgeId} has invalid endpoints.`);
    const pair = `${source}\0${target}`;
    if (pairs.has(pair)) bad('Duplicate graph connections are not supported.');
    const sourceNode = presentationNodes.find((node) => node.nodeId === source); const targetNode = presentationNodes.find((node) => node.nodeId === target);
    const supported = (sourceNode.kind === 'entry' && targetNode.kind === 'router') || (sourceNode.kind === 'router' && ['destination', 'fallback'].includes(targetNode.kind));
    if (!supported) bad(`Edge ${edgeId} is not supported by the event lifecycle model.`);
    if (hasPath(normalizedEdges, target, source)) bad('Flow graphs cannot contain cycles.');
    edgeIds.add(edgeId); pairs.add(pair);
    normalizedEdges.push({ edgeId, source, target, label: cleanText(edge.label ?? edge.data?.conditionLabel, `Edge ${edgeId} label`, 100) });
  }
  return { presentation: { nodes: presentationNodes, edges: normalizedEdges }, routing: { stages, fallbackNodeId, fallbackDestinationUrl } };
}

function issue(code, message, nodeId, field) { return { code, message, ...(nodeId ? { nodeId } : {}), ...(field ? { field } : {}) }; }
function validateNormalized(flow) {
  const errors = []; const warnings = []; const nodes = flow.draft.presentation.nodes; const edges = flow.draft.presentation.edges; const stages = flow.draft.routing.stages;
  const entries = nodes.filter((node) => node.kind === 'entry'); const routers = nodes.filter((node) => node.kind === 'router');
  if (entries.length !== 1) errors.push(issue('entry_required', 'Exactly one entry node is required.'));
  if (routers.length !== 1) errors.push(issue('router_required', 'Exactly one event phase router is required.'));
  if (!flow.eventStartAtUtc || !flow.eventEndAtUtc) errors.push(issue('event_window_required', 'Event start and end are required.', null, 'eventWindow'));
  else if (flow.eventEndAtUtc <= flow.eventStartAtUtc) errors.push(issue('event_window_order', 'Event end must be after event start.', null, 'eventWindow'));
  for (const stage of stages) {
    if (!stage.destinationUrl) errors.push(issue('destination_required', `${stage.phase} needs a destination URL.`, stage.nodeId, 'destinationUrl'));
    if (stage.startAtUtc && stage.endAtUtc && stage.endAtUtc <= stage.startAtUtc) errors.push(issue('stage_window_order', `${stage.phase} end must be after its start.`, stage.nodeId, 'schedule'));
    if (stage.phase === 'custom' && !stage.startAtUtc && !stage.endAtUtc) errors.push(issue('custom_window_required', 'Custom stages need a start, an end, or both.', stage.nodeId, 'schedule'));
    if (!edges.some((edge) => edge.target === stage.nodeId)) errors.push(issue('stage_disconnected', `${stage.phase} is not connected to the router.`, stage.nodeId));
  }
  if (!flow.draft.routing.fallbackNodeId || !flow.draft.routing.fallbackDestinationUrl) errors.push(issue('fallback_required', 'A connected fallback with a valid destination is required.'));
  else if (!edges.some((edge) => edge.target === flow.draft.routing.fallbackNodeId)) errors.push(issue('fallback_disconnected', 'The fallback must be connected to the router.', flow.draft.routing.fallbackNodeId));
  const ranged = stages.filter((stage) => stage.startAtUtc || stage.endAtUtc).map((stage) => ({ ...stage, startMs: stage.startAtUtc ? new Date(stage.startAtUtc).getTime() : -Infinity, endMs: stage.endAtUtc ? new Date(stage.endAtUtc).getTime() : Infinity })).sort((a, b) => a.startMs - b.startMs);
  for (let index = 0; index < ranged.length; index += 1) for (let other = index + 1; other < ranged.length; other += 1) {
    if (ranged[other].startMs >= ranged[index].endMs) break;
    if (Math.max(ranged[index].startMs, ranged[other].startMs) < Math.min(ranged[index].endMs, ranged[other].endMs)) errors.push(issue('schedule_overlap', `${ranged[index].phase} overlaps ${ranged[other].phase}.`, ranged[other].nodeId, 'schedule'));
  }
  if (ranged.length) {
    if (ranged[0].startMs !== -Infinity) warnings.push(issue('schedule_gap', `No scheduled stage covers time before ${new Date(ranged[0].startMs).toISOString()}.`));
    let coverageEnd = ranged[0].endMs;
    for (let index = 1; index < ranged.length; index += 1) { if (ranged[index].startMs > coverageEnd) warnings.push(issue('schedule_gap', `There is an uncovered schedule gap before ${new Date(ranged[index].startMs).toISOString()}.`)); coverageEnd = Math.max(coverageEnd, ranged[index].endMs); }
    if (coverageEnd !== Infinity) warnings.push(issue('schedule_gap', `No scheduled stage covers time after ${new Date(coverageEnd).toISOString()}.`));
  }
  const timeline = stages.map((stage) => ({ nodeId: stage.nodeId, phase: stage.phase, destinationUrl: stage.destinationUrl, startAtUtc: stage.startAtUtc, endAtUtc: stage.endAtUtc, startLocal: stage.startAtUtc ? utcDateTimeToLocal(stage.startAtUtc, flow.creatorTimeZone) : '', endLocal: stage.endAtUtc ? utcDateTimeToLocal(stage.endAtUtc, flow.creatorTimeZone) : '', openStart: !stage.startAtUtc, openEnd: !stage.endAtUtc }));
  return { publishable: errors.length === 0, errors, warnings, timeline };
}

export function normalizeFlowPayload(input = {}, existing) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) bad('Flow payload must be an object.');
  const timeZone = input.creatorTimeZone ?? existing?.creatorTimeZone;
  if (!isValidTimeZone(timeZone)) bad('Creator timezone must be a valid IANA timezone.');
  const eventStart = normalizeWallTime(input.eventStartLocal ?? existing?.eventStartLocal, timeZone, input.eventStartDisambiguation ?? existing?.eventStartDisambiguation, 'Event start');
  const eventEnd = normalizeWallTime(input.eventEndLocal ?? existing?.eventEndLocal, timeZone, input.eventEndDisambiguation ?? existing?.eventEndDisambiguation, 'Event end');
  const event = { startAt: eventStart.instant, endAt: eventEnd.instant };
  const graph = input.graph ?? (existing ? serializeFlow(existing).graph : { nodes: [], edges: [] });
  const draftProtection = input.protection ? {
    enabled: Boolean(input.protection.enabled),
    passwordHash: input.protection.passwordHash ?? null,
    expiresAt: input.protection.expiresAt ? new Date(input.protection.expiresAt) : null,
    maxClicks: input.protection.maxClicks ? Number(input.protection.maxClicks) : null,
  } : (existing?.draft?.protection ?? { enabled: false, passwordHash: null, expiresAt: null, maxClicks: null });
  const value = {
    eventName: cleanText(input.eventName ?? existing?.eventName, 'Event name', 120, 'Untitled event flow') || 'Untitled event flow',
    description: cleanText(input.description ?? existing?.description, 'Description', 1000), creatorTimeZone: timeZone,
    eventStartLocal: eventStart.local, eventEndLocal: eventEnd.local, eventStartDisambiguation: eventStart.disambiguation, eventEndDisambiguation: eventEnd.disambiguation,
    eventStartAtUtc: eventStart.instant, eventEndAtUtc: eventEnd.instant,
    draft: { ...normalizeGraph(graph, timeZone, event), protection: draftProtection },
  };
  return { value, validation: validateNormalized(value) };
}

export function serializeFlow(flow) {
  const plain = flow?.toObject?.() ?? flow;
  const routing = new Map((plain.draft?.routing?.stages ?? []).map((stage) => [stage.nodeId, stage]));
  const nodes = (plain.draft?.presentation?.nodes ?? []).map((node) => {
    const stage = routing.get(node.nodeId); const isFallback = node.kind === 'fallback';
    return {
      id: node.nodeId,
      type: 'flowNode',
      position: node.position,
      data: {
        kind: node.kind,
        label: node.label,
        description: node.description,
        ...(node.phase ? { phase: node.phase } : {}),
        ...((stage || isFallback) ? { destinationUrl: stage?.destinationUrl ?? plain.draft.routing.fallbackDestinationUrl ?? '' } : {}),
        ...(stage?.experiments ? { experiments: stage.experiments } : {}),
        ...(stage ? { schedule: { startLocal: stage.startLocal ?? '', endLocal: stage.endLocal ?? '', startDisambiguation: stage.startDisambiguation ?? 'earlier', endDisambiguation: stage.endDisambiguation ?? 'earlier', startAtUtc: stage.startAtUtc ?? null, endAtUtc: stage.endAtUtc ?? null } } : {}),
      },
    };
  });
  const edges = (plain.draft?.presentation?.edges ?? []).map((edge) => ({ id: edge.edgeId, source: edge.source, target: edge.target, label: edge.label, type: 'smoothstep', data: { conditionLabel: edge.label } }));
  const base = {
    id: plain.flowId,
    flowId: plain.flowId,
    eventName: plain.eventName,
    description: plain.description ?? '',
    creatorTimeZone: plain.creatorTimeZone,
    eventStartLocal: plain.eventStartLocal ?? '',
    eventEndLocal: plain.eventEndLocal ?? '',
    eventStartDisambiguation: plain.eventStartDisambiguation ?? 'earlier',
    eventEndDisambiguation: plain.eventEndDisambiguation ?? 'earlier',
    eventStartAtUtc: plain.eventStartAtUtc ?? null,
    eventEndAtUtc: plain.eventEndAtUtc ?? null,
    revision: plain.revision,
    publishedRevision: plain.publishedRevision ?? null,
    publicationSequence: plain.publicationSequence ?? 0,
    publishedAt: plain.publishedAt ?? null,
    lifecycleStatus: plain.lifecycleStatus ?? 'active',
    lifecycleChangedAt: plain.lifecycleChangedAt ?? null,
    operationVersion: plain.operationVersion ?? 0,
    linkId: plain.linkId ?? null,
    graph: { nodes, edges },
    protection: sanitizeProtectionForClient(plain.draft?.protection),
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
  return base;
}

export function createFlowService(Flow) {
  return {
    async create(input) { const normalized = normalizeFlowPayload(input); const flow = await Flow.create({ flowId: randomUUID(), revision: 1, ...normalized.value }); return { flow, validation: validateNormalized(flow.toObject?.() ?? flow) }; },
    async list() { const query = Flow.find({}); const flows = typeof query.sort === 'function' ? await query.sort({ updatedAt: -1 }) : await query; return flows.map(serializeFlow); },
    async get(flowId) { return Flow.findOne({ flowId }); },
    async update(flowId, input) {
      if (!Number.isInteger(input.revision) || input.revision < 1) bad('A valid revision is required to save a flow.');
      const current = await Flow.findOne({ flowId }); if (!current) return null;
      const normalized = normalizeFlowPayload(input, current.toObject?.() ?? current);
      const updated = await Flow.findOneAndUpdate({ flowId, revision: input.revision }, { $set: normalized.value, $inc: { revision: 1 } }, { new: true, runValidators: true });
      if (!updated) throw Object.assign(new Error('This flow changed while you were editing it. Reload it before saving again.'), { status: 409, code: 'REVISION_CONFLICT' });
      return { flow: updated, validation: validateNormalized(updated.toObject?.() ?? updated) };
    },
    async validate(input, existing) { const normalized = normalizeFlowPayload(input, existing); return normalized.validation; },
    async remove(flowId) { const current = await Flow.findOne({ flowId }); if (!current) return null; if (current.publishedRevision || current.linkId) throw Object.assign(new Error('Published or linked flows cannot be deleted yet.'), { status: 409 }); return Flow.findOneAndDelete({ flowId }); },
  };
}

export { validateNormalized as validateFlowConfiguration };
