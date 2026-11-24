export const FLOW_NODE_TYPES = Object.freeze({
  ENTRY: 'entry',
  ROUTER: 'router',
  DESTINATION: 'destination',
  FALLBACK: 'fallback',
});

export function detectCreatorTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function createEventLifecycleGraph() {
  const nodes = [
    { id: 'entry', type: 'flowNode', position: { x: 40, y: 205 }, data: { kind: FLOW_NODE_TYPES.ENTRY, eyebrow: 'ENTRY', label: 'Permanent short URL + QR', description: 'One permanent audience entry point' } },
    { id: 'router', type: 'flowNode', position: { x: 350, y: 205 }, data: { kind: FLOW_NODE_TYPES.ROUTER, eyebrow: 'DECISION', label: 'Event phase router', description: 'Evaluates the schedule once per visit' } },
    { id: 'before', type: 'flowNode', position: { x: 720, y: 10 }, data: { kind: FLOW_NODE_TYPES.DESTINATION, phase: 'before', eyebrow: 'OUTCOME', label: 'Before Event', description: 'Before the event begins', destinationUrl: '', schedule: { startLocal: '', endLocal: '', startAtUtc: null, endAtUtc: null } } },
    { id: 'during', type: 'flowNode', position: { x: 720, y: 145 }, data: { kind: FLOW_NODE_TYPES.DESTINATION, phase: 'during', eyebrow: 'OUTCOME', label: 'During Event', description: 'While the event is live', destinationUrl: '', schedule: { startLocal: '', endLocal: '', startAtUtc: null, endAtUtc: null } } },
    { id: 'after', type: 'flowNode', position: { x: 720, y: 280 }, data: { kind: FLOW_NODE_TYPES.DESTINATION, phase: 'after', eyebrow: 'OUTCOME', label: 'After Event', description: 'After the event concludes', destinationUrl: '', schedule: { startLocal: '', endLocal: '', startAtUtc: null, endAtUtc: null } } },
    { id: 'fallback', type: 'flowNode', position: { x: 720, y: 415 }, data: { kind: FLOW_NODE_TYPES.FALLBACK, eyebrow: 'DEFAULT', label: 'Fallback destination', description: 'Used when no scheduled phase matches', destinationUrl: '' } },
  ];
  const edge = (id, target, label) => ({ id, source: 'router', target, label, type: 'smoothstep', data: { conditionLabel: label } });
  return {
    nodes,
    edges: [
      { id: 'entry-router', source: 'entry', target: 'router', label: 'Every visit', type: 'smoothstep', data: { conditionLabel: 'Every visit' } },
      edge('router-before', 'before', 'Before start'),
      edge('router-during', 'during', 'Start ≤ now < end'),
      edge('router-after', 'after', 'At or after end'),
      edge('router-fallback', 'fallback', 'No phase match'),
    ],
  };
}

export function createFlowDraft(timeZone = detectCreatorTimeZone(), withTemplate = true) {
  const graph = withTemplate ? createEventLifecycleGraph() : { nodes: [], edges: [] };
  return {
    schemaVersion: 1,
    title: 'Untitled event flow',
    status: 'local-draft',
    timeZone,
    timeZoneSource: 'creator-at-creation',
    scheduleStorage: 'utc-instants-with-iana-zone',
    ...graph,
  };
}

export function hasDirectedPath(edges, start, target) {
  const pending = [start];
  const visited = new Set();
  while (pending.length) {
    const node = pending.pop();
    if (node === target) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const edge of edges) if (edge.source === node) pending.push(edge.target);
  }
  return false;
}

export function isSupportedFlowConnection(connection, nodes, edges) {
  if (!connection?.source || !connection?.target || connection.source === connection.target) return false;
  if (edges.some((edge) => edge.source === connection.source && edge.target === connection.target)) return false;
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  if (!source || !target) return false;
  const supported = (source.data.kind === FLOW_NODE_TYPES.ENTRY && target.data.kind === FLOW_NODE_TYPES.ROUTER)
    || (source.data.kind === FLOW_NODE_TYPES.ROUTER && [FLOW_NODE_TYPES.DESTINATION, FLOW_NODE_TYPES.FALLBACK].includes(target.data.kind));
  return supported && !hasDirectedPath(edges, connection.target, connection.source);
}

export function durationLabel(startLocal, endLocal) {
  if (!startLocal || !endLocal) return 'Set both times to see duration';
  const milliseconds = new Date(endLocal).getTime() - new Date(startLocal).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'End must be after start';
  const minutes = Math.round(milliseconds / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainder = minutes % 60;
  return [days && `${days}d`, hours && `${hours}h`, remainder && `${remainder}m`].filter(Boolean).join(' ') || '< 1m';
}
