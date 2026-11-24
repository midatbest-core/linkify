import { FLOW_NODE_TYPES, durationLabel } from '../utils/flowDraft.js';

const TIME_ZONES = ['UTC', ...(Intl.supportedValuesOf?.('timeZone') ?? [])].filter((zone, index, values) => values.indexOf(zone) === index);

function Field({ label, hint, children }) {
  return <label className="block text-xs font-semibold text-ink">{label}{children}{hint && <span className="mt-1 block text-[11px] font-normal leading-4 text-muted">{hint}</span>}</label>;
}

export default function FlowInspector({ draft, selectedNode, selectedEdge, onDraftChange, onNodeChange, onSelectNode }) {
  const schedule = selectedNode?.data.schedule;
  return <aside className="flow-inspector" aria-label="Flow inspector">
    <div className="flow-inspector__heading"><div><p className="eyebrow">INSPECTOR</p><h2 className="mt-1 text-base font-semibold">{selectedNode ? 'Node settings' : selectedEdge ? 'Connection' : 'Flow settings'}</h2></div><span className="status-pill status-off">Local draft</span></div>
    <div className="flow-inspector__body">
      <Field label="Flow title"><input className="field-control" value={draft.title} maxLength={120} onChange={(event) => onDraftChange({ title: event.target.value })} /></Field>
      <Field label="Flow timezone" hint="Captured when this draft was created. It will not change automatically on another device."><select className="field-control" value={draft.timeZone} onChange={(event) => onDraftChange({ timeZone: event.target.value, timeZoneSource: 'explicit' })}>{TIME_ZONES.map((zone) => <option key={zone}>{zone}</option>)}</select></Field>
      <div className="rounded-xl border border-line bg-canvas-subtle p-3"><p className="text-[11px] font-bold uppercase tracking-[.09em] text-muted">Timezone</p><p className="mt-1 break-words text-sm font-semibold text-brand-strong">{draft.timeZone}</p></div>
      {draft.nodes.length > 0 && <Field label="Accessible node outline" hint="Form-based navigation alternative for small screens and keyboard editing."><select className="field-control" value={selectedNode?.id ?? ''} onChange={(event) => onSelectNode(event.target.value)}><option value="">Choose a node</option>{draft.nodes.map((node) => <option value={node.id} key={node.id}>{node.data.label}</option>)}</select></Field>}
      {selectedNode && <div className="flow-inspector__section">
        <p className="eyebrow">{selectedNode.data.eyebrow}</p>
        <Field label="Node label"><input className="field-control" value={selectedNode.data.label} maxLength={80} onChange={(event) => onNodeChange({ label: event.target.value })} /></Field>
        {[FLOW_NODE_TYPES.DESTINATION, FLOW_NODE_TYPES.FALLBACK].includes(selectedNode.data.kind) && <Field label="Destination URL" hint="Draft only. Use a complete http:// or https:// URL."><input className="field-control" type="url" inputMode="url" placeholder="https://example.com/event" value={selectedNode.data.destinationUrl ?? ''} onChange={(event) => onNodeChange({ destinationUrl: event.target.value })} /></Field>}
        {schedule && <>
          <Field label="Start date and time"><input className="field-control" type="datetime-local" value={schedule.startLocal} onChange={(event) => onNodeChange({ schedule: { ...schedule, startLocal: event.target.value, startAtUtc: null } })} /></Field>
          <Field label="End date and time"><input className="field-control" type="datetime-local" value={schedule.endLocal} onChange={(event) => onNodeChange({ schedule: { ...schedule, endLocal: event.target.value, endAtUtc: null } })} /></Field>
          <div className="rounded-xl bg-brand-soft p-3 text-xs"><span className="font-semibold">Duration</span><span className="ml-2 text-brand-strong">{durationLabel(schedule.startLocal, schedule.endLocal)}</span><p className="mt-1 text-[11px] leading-4 text-muted">Local wall times in {draft.timeZone}. UTC instants are reserved for validated persistence in Milestone 2.</p></div>
        </>}
      </div>}
      {selectedEdge && <div className="flow-inspector__section"><p className="eyebrow">CONDITION</p><p className="rounded-xl border border-line bg-white p-3 text-sm font-semibold">{selectedEdge.data?.conditionLabel ?? selectedEdge.label}</p><p className="text-xs leading-5 text-muted">Directional routing outcome. Connections are limited to Entry → Decision → Destination and cycles are rejected.</p></div>}
      {!selectedNode && !selectedEdge && <p className="rounded-xl border border-dashed border-line p-4 text-sm leading-6 text-muted">Select a node or connection to edit its draft details.</p>}
    </div>
  </aside>;
}
