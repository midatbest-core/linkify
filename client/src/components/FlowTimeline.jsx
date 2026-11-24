import { durationLabel, instantDurationLabel } from '../utils/flowDraft.js';

function displayTime(value, openLabel) { return value ? value.replace('T', ' ') : openLabel; }
function invalidDestination(value) { try { const url = new URL(value); return !['http:', 'https:'].includes(url.protocol) || !url.hostname; } catch { return Boolean(value); } }

export default function FlowTimeline({ draft, nodes, validation, selectedNodeId, onSelectNode }) {
  const diagnostics = [...(validation?.errors ?? []), ...(validation?.warnings ?? [])];
  const serverRows = new Map((validation?.timeline ?? []).map((row) => [row.nodeId, row]));
  const rows = nodes.filter((node) => ['destination', 'fallback'].includes(node.data.kind)).map((node) => {
    const server = serverRows.get(node.id); const phase = node.data.phase ?? 'fallback'; const schedule = node.data.schedule ?? {};
    let startLocal = server?.startLocal ?? schedule.startLocal ?? ''; let endLocal = server?.endLocal ?? schedule.endLocal ?? '';
    if (!schedule.startLocal && phase === 'during') startLocal = draft.eventStartLocal;
    if (!schedule.startLocal && phase === 'after') startLocal = draft.eventEndLocal;
    if (!schedule.endLocal && phase === 'before') endLocal = draft.eventStartLocal;
    if (!schedule.endLocal && phase === 'during') endLocal = draft.eventEndLocal;
    const issues = diagnostics.filter((item) => item.nodeId === node.id);
    if (invalidDestination(node.data.destinationUrl)) issues.push({ code: 'destination_invalid', message: 'Destination URL must use HTTP or HTTPS.' });
    return { node, phase, startLocal, endLocal, startAtUtc: server?.startAtUtc, endAtUtc: server?.endAtUtc, openStart: phase === 'before' && !schedule.startLocal, openEnd: phase === 'after' && !schedule.endLocal, issues };
  });
  return <section className="flow-timeline" aria-labelledby="timeline-title">
    <div className="flow-timeline__header"><div><p className="eyebrow">EVENT TIMELINE</p><h2 id="timeline-title" className="mt-1 text-base font-semibold">Schedule validation</h2></div><span className={`status-pill ${validation?.publishable ? 'status-on' : 'status-off'}`}>{validation?.publishable ? 'Publishable draft' : 'Needs attention'}</span></div>
    <div className="flow-timeline__event"><span><strong>Starts</strong> {displayTime(draft.eventStartLocal, 'Not set')}</span><span><strong>Ends</strong> {displayTime(draft.eventEndLocal, 'Not set')}</span><span><strong>Timezone</strong> {draft.creatorTimeZone}</span></div>
    <div className="flow-timeline__track">{rows.map(({ node, phase, startLocal, endLocal, startAtUtc, endAtUtc, openStart, openEnd, issues }) => <button type="button" key={node.id} className={`flow-timeline__phase ${selectedNodeId === node.id ? 'is-selected' : ''} ${issues.length ? 'has-issue' : ''}`} onClick={() => onSelectNode(node.id)} aria-pressed={selectedNodeId === node.id}>
      <span className="flow-timeline__dot" aria-hidden="true"/><span className="min-w-0"><span className="flow-timeline__phase-name">{node.data.label}</span><span className="flow-timeline__range">{openStart ? 'Open start' : displayTime(startLocal, 'Start not set')} → {openEnd ? 'Open end' : displayTime(endLocal, 'End not set')}</span><span className="flow-timeline__destination">{node.data.destinationUrl || 'Missing destination URL'}</span>{phase !== 'fallback' && <span className="flow-timeline__duration">{openStart || openEnd ? 'Open-ended phase' : startAtUtc && endAtUtc ? instantDurationLabel(startAtUtc, endAtUtc) : durationLabel(startLocal, endLocal)}</span>}{issues.map((item) => <span key={`${item.code}-${item.message}`} className="flow-timeline__issue">{item.message}</span>)}</span>
    </button>)}</div>
    {(validation?.errors?.filter((item) => !item.nodeId).length > 0 || validation?.warnings?.length > 0) && <div className="flow-timeline__summary">{validation.errors.filter((item) => !item.nodeId).map((item) => <p key={item.code} className="text-danger">{item.message}</p>)}{validation.warnings.map((item) => <p key={item.message}>{item.message}</p>)}</div>}
  </section>;
}
