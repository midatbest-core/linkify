import { FLOW_NODE_TYPES, durationLabel, isDstRelevant } from '../utils/flowDraft.js';
import ProtectionSettings from './ProtectionSettings.jsx';
import ExperimentEditor from './ExperimentEditor.jsx';

function Field({ label, hint, children }) {
  return (
    <label className="block text-xs font-semibold text-ink">
      {label}
      {children}
      {hint && <span className="mt-1 block text-[11px] font-normal leading-4 text-muted">{hint}</span>}
    </label>
  );
}

export default function FlowInspector({
  draft,
  selectedNode,
  selectedEdge,
  onDraftChange,
  onNodeChange,
  onSelectNode,
  onRemoveNode,
  onOpenEventSettings,
}) {
  const schedule = selectedNode?.data.schedule;
  const isDestination = selectedNode?.data.kind === FLOW_NODE_TYPES.DESTINATION;
  const isFallback = selectedNode?.data.kind === FLOW_NODE_TYPES.FALLBACK;
  const isEntry = selectedNode?.data.kind === FLOW_NODE_TYPES.ENTRY;
  const isRouter = selectedNode?.data.kind === FLOW_NODE_TYPES.ROUTER;

  const nodeHeading = isEntry
    ? 'Entry point settings'
    : isRouter
    ? 'Phase router settings'
    : isDestination
    ? 'Destination stage settings'
    : isFallback
    ? 'Fallback settings'
    : selectedNode
    ? 'Node settings'
    : selectedEdge
    ? 'Connection condition'
    : 'Flow configuration';

  return (
    <aside className="flow-inspector" aria-label="Flow inspector">
      <div className="flow-inspector__heading">
        <div>
          <p className="eyebrow">INSPECTOR</p>
          <h2 className="mt-1 text-base font-semibold">{nodeHeading}</h2>
        </div>
        <span className="status-pill status-off">Local draft</span>
      </div>

      <div className="flow-inspector__body">
        {/* CASE 1: Node Selected */}
        {selectedNode && (
          <div className="flow-inspector__section border-t-0 pt-0">
            <p className="eyebrow">{selectedNode.data.eyebrow || 'NODE'}</p>

            <Field label="Node label">
              <input
                className="field-control"
                value={selectedNode.data.label}
                maxLength={80}
                onChange={(event) => onNodeChange({ label: event.target.value })}
              />
            </Field>

            {/* Entry Node Settings: Permanent URL & QR details + Protection */}
            {isEntry && (
              <>
                <p className="text-xs leading-5 text-muted">
                  The permanent entrance for audience traffic. Visitors to your short link or QR code are directed here before scheduled evaluation.
                </p>
                <div className="mt-2 border-t border-line pt-3">
                  <p className="eyebrow mb-2">CAMPAIGN ACCESS PROTECTION</p>
                  <ProtectionSettings
                    value={draft.protection ?? { enabled: false }}
                    onChange={(prot) => onDraftChange({ protection: prot })}
                  />
                </div>
              </>
            )}

            {/* Router Node Settings: Event Schedule Summary */}
            {isRouter && (
              <div className="rounded-xl border border-line bg-canvas-subtle p-3.5 space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-[.09em] text-muted">Active Event Schedule</p>
                <p className="text-xs text-ink">
                  <span className="font-semibold">Timezone: </span>
                  <span className="text-brand-strong font-medium">{draft.creatorTimeZone}</span>
                </p>
                <p className="text-xs text-ink">
                  <span className="font-semibold">Window: </span>
                  <span>{draft.eventStartLocal || 'Not set'} → {draft.eventEndLocal || 'Not set'}</span>
                </p>
                {onOpenEventSettings && (
                  <button
                    type="button"
                    className="button-secondary text-xs min-h-9 px-3 mt-2"
                    onClick={onOpenEventSettings}
                  >
                    Edit Event Settings
                  </button>
                )}
              </div>
            )}

            {/* Destination & Fallback URL Fields */}
            {(isDestination || isFallback) && (
              <Field label="Destination URL" hint="Draft only. Use a complete http:// or https:// URL.">
                <input
                  className="field-control"
                  type="url"
                  inputMode="url"
                  placeholder="https://example.com/event"
                  value={selectedNode.data.destinationUrl ?? ''}
                  onChange={(event) => onNodeChange({ destinationUrl: event.target.value })}
                />
              </Field>
            )}

            {/* A/B Experimentation (Destination stages) */}
            {isDestination && (
              <div className="mt-2">
                <ExperimentEditor
                  value={selectedNode.data.experiments ?? { enabled: false, variants: [] }}
                  onChange={(exp) => onNodeChange({ experiments: exp })}
                  defaultDestinationUrl={selectedNode.data.destinationUrl}
                />
              </div>
            )}

            {/* Scheduled Stage Details */}
            {schedule && (
              <div className="mt-3 space-y-3 border-t border-line pt-3">
                <p className="eyebrow">STAGE SCHEDULE</p>
                <div className="grid gap-3">
                  <Field label="Start date and time" hint="Leave blank to use the phase default.">
                    <input
                      className="field-control"
                      type="datetime-local"
                      value={schedule.startLocal}
                      onChange={(event) =>
                        onNodeChange({
                          schedule: { ...schedule, startLocal: event.target.value, startAtUtc: null },
                        })
                      }
                    />
                  </Field>
                  <Field label="End date and time" hint="Leave blank to use the phase default.">
                    <input
                      className="field-control"
                      type="datetime-local"
                      value={schedule.endLocal}
                      onChange={(event) =>
                        onNodeChange({
                          schedule: { ...schedule, endLocal: event.target.value, endAtUtc: null },
                        })
                      }
                    />
                  </Field>
                </div>

                {/* Progressive DST disclosure: only show if timezone & dates observe DST */}
                {isDstRelevant(draft.creatorTimeZone, schedule.startLocal || schedule.endLocal) && (
                  <Field
                    label="DST overlap choice"
                    hint="Used if this time occurs twice when clocks move backward."
                  >
                    <select
                      className="field-control"
                      value={schedule.startDisambiguation ?? 'earlier'}
                      onChange={(event) =>
                        onNodeChange({
                          schedule: {
                            ...schedule,
                            startDisambiguation: event.target.value,
                            endDisambiguation: event.target.value,
                          },
                        })
                      }
                    >
                      <option value="earlier">Earlier occurrence</option>
                      <option value="later">Later occurrence</option>
                    </select>
                  </Field>
                )}

                <div className="rounded-xl bg-brand-soft p-3 text-xs">
                  <span className="font-semibold text-ink">Duration: </span>
                  <span className="text-brand-strong font-medium">
                    {durationLabel(schedule.startLocal, schedule.endLocal)}
                  </span>
                  <p className="mt-1 text-[11px] leading-4 text-muted">
                    Local wall times in {draft.creatorTimeZone}; the server stores validated UTC instants.
                  </p>
                </div>

                {selectedNode.data.phase === 'custom' && (
                  <button
                    className="button-danger min-h-11 px-3 w-full"
                    type="button"
                    onClick={onRemoveNode}
                  >
                    Remove scheduled stage
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* CASE 2: Edge Selected */}
        {selectedEdge && (
          <div className="flow-inspector__section border-t-0 pt-0">
            <p className="eyebrow">CONDITION</p>
            <p className="rounded-xl border border-line bg-white p-3 text-sm font-semibold text-ink">
              {selectedEdge.data?.conditionLabel ?? selectedEdge.label}
            </p>
            <p className="text-xs leading-5 text-muted">
              Directional routing outcome. Connections are limited to Entry → Decision → Destination and cycles are rejected.
            </p>
          </div>
        )}

        {/* CASE 3: No Node or Edge Selected (Flow Configuration & Global Protection) */}
        {!selectedNode && !selectedEdge && (
          <>
            <div className="space-y-3">
              <Field label="Event name">
                <input
                  className="field-control"
                  value={draft.eventName}
                  maxLength={120}
                  onChange={(event) => onDraftChange({ eventName: event.target.value })}
                />
              </Field>

              <Field label="Description">
                <textarea
                  className="field-control min-h-20 py-2"
                  value={draft.description}
                  maxLength={1000}
                  onChange={(event) => onDraftChange({ description: event.target.value })}
                />
              </Field>

              <div className="rounded-xl border border-line bg-canvas-subtle p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-[.09em] text-muted">Event Schedule</p>
                  {onOpenEventSettings && (
                    <button
                      type="button"
                      className="text-xs font-semibold text-brand hover:underline"
                      onClick={onOpenEventSettings}
                    >
                      Edit Schedule
                    </button>
                  )}
                </div>
                <p className="text-xs text-ink">
                  <span className="font-semibold">Timezone: </span>
                  <span className="text-brand-strong font-medium">{draft.creatorTimeZone}</span>
                </p>
                <p className="text-xs text-ink">
                  <span className="font-semibold">Schedule: </span>
                  <span>{draft.eventStartLocal || 'Not set'} → {draft.eventEndLocal || 'Not set'}</span>
                </p>
              </div>

              {draft.nodes.length > 0 && (
                <Field
                  label="Accessible node outline"
                  hint="Form-based navigation alternative for small screens and keyboard editing."
                >
                  <select
                    className="field-control"
                    value={selectedNode?.id ?? ''}
                    onChange={(event) => onSelectNode(event.target.value)}
                  >
                    <option value="">Choose a node</option>
                    {draft.nodes.map((node) => (
                      <option value={node.id} key={node.id}>
                        {node.data.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>

            <div className="flow-inspector__section">
              <p className="eyebrow">LINK ACCESS PROTECTION</p>
              <ProtectionSettings
                value={draft.protection ?? { enabled: false }}
                onChange={(prot) => onDraftChange({ protection: prot })}
              />
            </div>

            <p className="rounded-xl border border-dashed border-line p-4 text-xs leading-5 text-muted">
              Select a node or connection on the canvas to configure its routing rules, A/B experiments, or scheduled stage times.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
