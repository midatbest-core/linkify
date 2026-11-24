import { FLOW_NODE_TYPES, durationLabel } from '../utils/flowDraft.js';
import ProtectionSettings from './ProtectionSettings.jsx';
import ExperimentEditor from './ExperimentEditor.jsx';

const TIME_ZONES = ['UTC', ...(Intl.supportedValuesOf?.('timeZone') ?? [])].filter((zone, index, values) => values.indexOf(zone) === index);

function Field({ label, hint, children }) {
  return <label className="block text-xs font-semibold text-ink">{label}{children}{hint && <span className="mt-1 block text-[11px] font-normal leading-4 text-muted">{hint}</span>}</label>;
}

export default function FlowInspector({ draft, selectedNode, selectedEdge, onDraftChange, onNodeChange, onSelectNode, onTimeZoneRequest, onRemoveNode }) {
  const schedule = selectedNode?.data.schedule;
  return <aside className="flow-inspector" aria-label="Flow inspector">
    <div className="flow-inspector__heading"><div><p className="eyebrow">INSPECTOR</p><h2 className="mt-1 text-base font-semibold">{selectedNode ? 'Node settings' : selectedEdge ? 'Connection' : 'Flow settings'}</h2></div><span className="status-pill status-off">Local draft</span></div>
    <div className="flow-inspector__body">
      <Field label="Event name"><input className="field-control" value={draft.eventName} maxLength={120} onChange={(event) => onDraftChange({ eventName: event.target.value })} /></Field>
      <Field label="Description"><textarea className="field-control min-h-20 py-2" value={draft.description} maxLength={1000} onChange={(event) => onDraftChange({ description: event.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"><Field label="Event start"><input type="datetime-local" className="field-control" value={draft.eventStartLocal} onChange={(event) => onDraftChange({ eventStartLocal: event.target.value, eventStartAtUtc: null })} /></Field><Field label="Event end"><input type="datetime-local" className="field-control" value={draft.eventEndLocal} onChange={(event) => onDraftChange({ eventEndLocal: event.target.value, eventEndAtUtc: null })} /></Field></div>
      <Field label="DST overlap choice" hint="Used only if an event time occurs twice when clocks move backward."><select className="field-control" value={draft.eventStartDisambiguation} onChange={(event) => onDraftChange({ eventStartDisambiguation: event.target.value, eventEndDisambiguation: event.target.value })}><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option></select></Field>
      <Field label="Flow timezone" hint="Changing timezone requires an explicit wall-time or absolute-instant choice."><select className="field-control" value={draft.creatorTimeZone} onChange={(event) => onTimeZoneRequest(event.target.value)}>{TIME_ZONES.map((zone) => <option key={zone}>{zone}</option>)}</select></Field>
      <div className="rounded-xl border border-line bg-canvas-subtle p-3"><p className="text-[11px] font-bold uppercase tracking-[.09em] text-muted">Saved timezone</p><p className="mt-1 break-words text-sm font-semibold text-brand-strong">{draft.creatorTimeZone}</p></div>
      {draft.nodes.length > 0 && <Field label="Accessible node outline" hint="Form-based navigation alternative for small screens and keyboard editing."><select className="field-control" value={selectedNode?.id ?? ''} onChange={(event) => onSelectNode(event.target.value)}><option value="">Choose a node</option>{draft.nodes.map((node) => <option value={node.id} key={node.id}>{node.data.label}</option>)}</select></Field>}
      {selectedNode && <div className="flow-inspector__section">
        <p className="eyebrow">{selectedNode.data.eyebrow}</p>
        <Field label="Node label"><input className="field-control" value={selectedNode.data.label} maxLength={80} onChange={(event) => onNodeChange({ label: event.target.value })} /></Field>
        {[FLOW_NODE_TYPES.DESTINATION, FLOW_NODE_TYPES.FALLBACK].includes(selectedNode.data.kind) && <Field label="Destination URL" hint="Draft only. Use a complete http:// or https:// URL."><input className="field-control" type="url" inputMode="url" placeholder="https://example.com/event" value={selectedNode.data.destinationUrl ?? ''} onChange={(event) => onNodeChange({ destinationUrl: event.target.value })} /></Field>}
        {selectedNode.data.kind === FLOW_NODE_TYPES.DESTINATION && (
          <div className="mt-3">
            <ExperimentEditor
              value={selectedNode.data.experiments ?? { enabled: false, variants: [] }}
              onChange={(exp) => onNodeChange({ experiments: exp })}
              defaultDestinationUrl={selectedNode.data.destinationUrl}
            />
          </div>
        )}
        {schedule && <>
          <Field label="Start date and time" hint="Leave blank to use the phase default."><input className="field-control" type="datetime-local" value={schedule.startLocal} onChange={(event) => onNodeChange({ schedule: { ...schedule, startLocal: event.target.value, startAtUtc: null } })} /></Field>
          <Field label="End date and time" hint="Leave blank to use the phase default."><input className="field-control" type="datetime-local" value={schedule.endLocal} onChange={(event) => onNodeChange({ schedule: { ...schedule, endLocal: event.target.value, endAtUtc: null } })} /></Field>
          <Field label="DST overlap choice"><select className="field-control" value={schedule.startDisambiguation ?? 'earlier'} onChange={(event) => onNodeChange({ schedule: { ...schedule, startDisambiguation: event.target.value, endDisambiguation: event.target.value } })}><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option></select></Field>
          <div className="rounded-xl bg-brand-soft p-3 text-xs"><span className="font-semibold">Duration</span><span className="ml-2 text-brand-strong">{durationLabel(schedule.startLocal, schedule.endLocal)}</span><p className="mt-1 text-[11px] leading-4 text-muted">Local wall times in {draft.creatorTimeZone}; the server stores validated UTC instants.</p></div>
          {selectedNode.data.phase === 'custom' && <button className="button-danger min-h-11 px-3" type="button" onClick={onRemoveNode}>Remove scheduled stage</button>}
        </>}
      </div>}
      {selectedEdge && <div className="flow-inspector__section"><p className="eyebrow">CONDITION</p><p className="rounded-xl border border-line bg-white p-3 text-sm font-semibold">{selectedEdge.data?.conditionLabel ?? selectedEdge.label}</p><p className="text-xs leading-5 text-muted">Directional routing outcome. Connections are limited to Entry → Decision → Destination and cycles are rejected.</p></div>}
      {!selectedNode && !selectedEdge && (
        <div className="flow-inspector__section">
          <ProtectionSettings
            value={draft.protection ?? { enabled: false }}
            onChange={(prot) => onDraftChange({ protection: prot })}
          />
        </div>
      )}
      {!selectedNode && !selectedEdge && <p className="rounded-xl border border-dashed border-line p-4 text-sm leading-6 text-muted">Select a node or connection to edit its draft details.</p>}
    </div>
  </aside>;
}
