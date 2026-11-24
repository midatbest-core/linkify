import { useEffect, useState } from 'react';
import { flowApi } from '../utils/flowApi.js';

function formatTimestamp(value) {
  if (!value) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function FlowHistory({
  flowId,
  isDraftDirty,
  hasUnpublishedSavedChanges = false,
  draftRevision,
  onRollbackRequested,
  rollbackState,
  rollbackMessage,
}) {
  const [historyData, setHistoryData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  // Diff comparison modal state
  const [compareFrom, setCompareFrom] = useState(null);
  const [compareTo, setCompareTo] = useState(null);
  const [diffResult, setDiffResult] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState('');

  // Rollback confirmation dialog state
  const [rollbackTarget, setRollbackTarget] = useState(null);
  const [syncDraft, setSyncDraft] = useState(true);
  const [confirmDraftDiscard, setConfirmDraftDiscard] = useState(false);
  const [rollbackKey, setRollbackKey] = useState(null);

  async function loadHistory() {
    setLoading(true);
    setError('');
    try {
      const res = await flowApi.history(flowId, { page, limit: 10 });
      setHistoryData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, [flowId, page, rollbackState]);

  async function runCompare() {
    if (!compareFrom || !compareTo || compareFrom === compareTo) return;
    setDiffLoading(true);
    setDiffError('');
    try {
      const res = await flowApi.diff(flowId, compareFrom, compareTo);
      setDiffResult(res);
    } catch (err) {
      setDiffError(err.message);
    } finally {
      setDiffLoading(false);
    }
  }

  function handleRollbackSubmit() {
    if (!rollbackTarget || rollbackState === 'rolling_back') return;
    onRollbackRequested({
      targetPublicationNumber: rollbackTarget.publicationNumber,
      syncDraft,
      confirmDraftDiscard,
      idempotencyKey: rollbackKey,
    });
    setRollbackTarget(null);
  }

  return (
    <section className="flow-history panel p-4 sm:p-6 lg:p-8" aria-labelledby="history-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-4">
        <div>
          <p className="eyebrow">PUBLICATION AUDIT LOG</p>
          <h2 id="history-heading" className="mt-1 text-2xl font-semibold tracking-tight">Publication history</h2>
          <p className="mt-1 text-xs text-muted">
            Immutable snapshots of every published and restored configuration.
          </p>
        </div>
        <button
          type="button"
          className="button-secondary text-xs self-start"
          onClick={loadHistory}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {rollbackMessage && (
        <div
          className={`mt-4 rounded-xl border p-3 text-xs ${rollbackState === 'failed' ? 'border-[#e3b7ae] bg-[#fff4f0] text-[#8b372b]' : 'border-[#b9d0b2] bg-[#eef6e9] text-[#245b2b]'}`}
          role="status"
        >
          {rollbackMessage}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-[#e3b7ae] bg-[#fff4f0] p-4 text-xs text-[#8b372b]" role="alert">
          {error}
        </div>
      )}

      {loading && !historyData && (
        <div className="mt-6 space-y-3" aria-label="Loading history">
          {[1, 2, 3].map((i) => <div key={i} className="panel skeleton h-28" />)}
        </div>
      )}

      {historyData && historyData.history.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-line bg-canvas-subtle p-8 text-center text-sm text-muted">
          No publications recorded yet. Publish this Flow to create publication snapshot #1.
        </div>
      )}

      {historyData && historyData.history.length > 0 && (
        <div className="mt-6 space-y-4">
          {/* Comparison Bar */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-canvas-subtle p-3 text-xs">
            <span className="font-semibold text-ink">Compare publications:</span>
            <select
              value={compareFrom ?? ''}
              onChange={(e) => setCompareFrom(Number(e.target.value))}
              className="field-control bg-white text-xs"
            >
              <option value="">Select version A</option>
              {historyData.history.map((h) => (
                <option key={h.publicationNumber} value={h.publicationNumber}>
                  #{h.publicationNumber} ({formatTimestamp(h.publishedAt)})
                </option>
              ))}
            </select>
            <span className="text-muted">vs</span>
            <select
              value={compareTo ?? ''}
              onChange={(e) => setCompareTo(Number(e.target.value))}
              className="field-control bg-white text-xs"
            >
              <option value="">Select version B</option>
              {historyData.history.map((h) => (
                <option key={h.publicationNumber} value={h.publicationNumber}>
                  #{h.publicationNumber} ({formatTimestamp(h.publishedAt)})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button-secondary text-xs"
              disabled={!compareFrom || !compareTo || compareFrom === compareTo || diffLoading}
              onClick={runCompare}
            >
              {diffLoading ? 'Comparing…' : 'Compare diff'}
            </button>
          </div>

          {/* Diff Result View */}
          {diffResult && (
            <div className="rounded-xl border border-line bg-surface p-4 shadow-sm text-xs">
              <div className="flex items-center justify-between border-b border-line pb-2 mb-3">
                <h4 className="font-semibold text-ink">
                  Comparing #{diffResult.fromPublicationNumber} → #{diffResult.toPublicationNumber}
                </h4>
                <button
                  type="button"
                  onClick={() => setDiffResult(null)}
                  className="button-quiet text-muted hover:text-ink"
                >
                  ✕ Close diff
                </button>
              </div>

              {diffResult.changes.length === 0 ? (
                <p className="text-muted">Configurations are identical.</p>
              ) : (
                <ul className="space-y-2">
                  {diffResult.changes.map((change, idx) => (
                    <li key={idx} className="rounded-lg bg-canvas-subtle p-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${change.type === 'added' ? 'bg-[#e9f5e3] text-[#295f22]' : change.type === 'removed' ? 'bg-[#fff4f0] text-danger' : 'bg-[#fff2cf] text-[#875d19]'}`}>
                          {change.type.toUpperCase()}
                        </span>
                        <strong className="text-ink">{change.stageId}</strong>
                      </div>
                      {change.type === 'changed' && (
                        <div className="mt-1.5 grid gap-1 pl-4 text-muted border-l-2 border-line">
                          {change.fields.map((f) => (
                            <p key={f}>
                              <span className="font-mono text-ink">{f}</span>: {String(change.before?.[f])} → <strong className="text-brand-strong">{String(change.after?.[f])}</strong>
                            </p>
                          ))}
                        </div>
                      )}
                      {change.type === 'added' && (
                        <p className="mt-1 pl-4 text-muted border-l-2 border-[#b9d0b2]">
                          Destination: <strong className="text-brand-strong">{change.after?.destinationUrl}</strong>
                        </p>
                      )}
                      {change.type === 'removed' && (
                        <p className="mt-1 pl-4 text-muted border-l-2 border-[#e3b7ae]">
                          Destination was: {change.before?.destinationUrl}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* History List Items */}
          <div className="space-y-3">
            {historyData.history.map((item) => {
              const isCurrent = item.isCurrent;
              const snapshot = item.configuration;
              return (
                <article
                  key={item.publicationNumber}
                  className={`panel p-4 sm:p-5 transition ${isCurrent ? 'border-brand bg-[#fbfdfa] shadow-sm' : 'bg-surface'}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-ink">
                          #{item.publicationNumber}
                        </span>
                        <span className={`status-pill ${isCurrent ? 'status-on' : 'status-off'}`}>
                          {isCurrent ? '● Active Live' : 'Superseded'}
                        </span>
                        {item.operation === 'rollback' && (
                          <span className="rounded-full bg-[#e8f2ff] px-2 py-0.5 text-xs font-semibold text-[#315c8a]">
                            Rollback (restored from #{item.restoredFrom})
                          </span>
                        )}
                        <span className="text-xs text-muted">
                          Draft revision {item.revision}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs text-muted">
                        Published on {formatTimestamp(item.publishedAt)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {!isCurrent && (
                        <button
                          type="button"
                          className="button-primary min-h-9 px-3 text-xs"
                          onClick={() => {
                            setRollbackTarget(item);
                            setConfirmDraftDiscard(false);
                            setRollbackKey(crypto.randomUUID());
                          }}
                        >
                          Rollback to #{item.publicationNumber}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Changes Summary against previous version */}
                  {item.changes && item.changes.length > 0 && (
                    <div className="mt-3 border-t border-line pt-2 text-xs">
                      <span className="text-muted font-medium">Changes in this version:</span>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {item.changes.map((c, i) => (
                          <span
                            key={i}
                            className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${c.type === 'added' ? 'bg-[#e9f5e3] text-[#295f22]' : c.type === 'removed' ? 'bg-[#fff4f0] text-danger' : 'bg-[#fff9ed] text-[#876b34]'}`}
                          >
                            {c.type === 'added' ? `+ ${c.stageId}` : c.type === 'removed' ? `- ${c.stageId}` : `~ ${c.stageId}`}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Stage snapshot preview */}
                  <details className="mt-3 text-xs text-muted">
                    <summary className="cursor-pointer hover:text-ink font-medium">
                      Inspect snapshot configuration ({snapshot?.stages?.length ?? 0} stages)
                    </summary>
                    <div className="mt-2 space-y-1.5 rounded-lg bg-canvas-subtle p-3 font-mono text-[11px]">
                      <div>
                        <strong>Fallback:</strong> {snapshot?.fallback?.destinationUrl}
                      </div>
                      {(snapshot?.stages ?? []).map((s) => (
                        <div key={s.stageId} className="truncate">
                          <strong>{s.stageId}:</strong> {s.destinationUrl}
                          {s.startAt ? ` [from ${s.startAt}]` : ''}
                          {s.endAt ? ` [until ${s.endAt}]` : ''}
                        </div>
                      ))}
                    </div>
                  </details>
                </article>
              );
            })}
          </div>

          {/* Pagination Controls */}
          {historyData.pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-xs">
              <button
                type="button"
                className="button-secondary text-xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Previous
              </button>
              <span className="text-muted">
                Page {historyData.pagination.page} of {historyData.pagination.totalPages}
              </span>
              <button
                type="button"
                className="button-secondary text-xs"
                disabled={page >= historyData.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Controlled Rollback Confirmation Dialog */}
      {rollbackTarget && (
        <div
          className="flow-publish-confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rollback-confirm-title"
        >
          <div className="panel w-full max-w-lg p-6 space-y-4">
            <p className="eyebrow">CONTROLLED ROLLBACK</p>
            <h3 id="rollback-confirm-title" className="text-xl font-semibold">
              Rollback to Publication #{rollbackTarget.publicationNumber}?
            </h3>
            <p className="text-xs leading-5 text-muted">
              Live traffic will immediately route to the configuration published on{' '}
              <strong>{formatTimestamp(rollbackTarget.publishedAt)}</strong>. A new publication sequence record will be created. The permanent short URL, alias, QR code, and click history are completely preserved.
            </p>

            <div className="rounded-xl border border-line bg-canvas-subtle p-3 space-y-2 text-xs">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={syncDraft}
                  onChange={(e) => setSyncDraft(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <strong>Synchronize flow draft</strong> with this historical version (updates visual canvas nodes and schedules).
                </span>
              </label>

              {((isDraftDirty || hasUnpublishedSavedChanges) && syncDraft) && (
                <div className="rounded-lg border border-[#e3b7ae] bg-[#fff4f0] p-2.5 text-danger space-y-2">
                  <p className="font-semibold">
                    {isDraftDirty && hasUnpublishedSavedChanges
                      ? '⚠ Unsaved canvas edits and saved unpublished draft changes detected!'
                      : isDraftDirty
                        ? '⚠ Unsaved draft edits detected!'
                        : `⚠ Saved draft revision ${draftRevision ?? ''} contains unpublished changes!`}
                  </p>
                  <label className="flex items-center gap-2 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={confirmDraftDiscard}
                      onChange={(e) => setConfirmDraftDiscard(e.target.checked)}
                    />
                    <span>I understand and confirm discarding current draft changes.</span>
                  </label>
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                className="button-secondary text-xs"
                onClick={() => setRollbackTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button-primary text-xs"
                disabled={((isDraftDirty || hasUnpublishedSavedChanges) && syncDraft && !confirmDraftDiscard) || rollbackState === 'rolling_back'}
                onClick={handleRollbackSubmit}
              >
                {rollbackState === 'rolling_back' ? 'Rolling back…' : 'Confirm Rollback'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
