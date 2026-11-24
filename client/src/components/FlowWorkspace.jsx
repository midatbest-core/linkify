import { useCallback, useEffect, useMemo, useState } from 'react';
import { addEdge, Background, BackgroundVariant, Controls, EdgeChangeset, MarkerType, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import FlowInspector from './FlowInspector.jsx';
import FlowNode from './FlowNode.jsx';
import FlowTimeline from './FlowTimeline.jsx';
import FlowSimulator from './FlowSimulator.jsx';
import FlowAnalytics from './FlowAnalytics.jsx';
import FlowHistory from './FlowHistory.jsx';
import QrCode from './QrCode.jsx';
import AliasSuggestions from './AliasSuggestions.jsx';
import { flowApi } from '../utils/flowApi.js';
import { changeDraftTimeZone, createEventLifecycleGraph, createFlowDraft, isSupportedFlowConnection } from '../utils/flowDraft.js';

const nodeTypes = { flowNode: FlowNode };
function hydrateFlow(flow) { return flow?.graph ? { ...flow, nodes: flow.graph.nodes, edges: flow.graph.edges } : flow; }
function payloadFor(draft, nodes, edges) {
  return {
    eventName: draft.eventName,
    description: draft.description,
    creatorTimeZone: draft.creatorTimeZone,
    eventStartLocal: draft.eventStartLocal,
    eventEndLocal: draft.eventEndLocal,
    eventStartDisambiguation: draft.eventStartDisambiguation,
    eventEndDisambiguation: draft.eventEndDisambiguation,
    ...(draft.revision ? { revision: draft.revision } : {}),
    graph: { nodes, edges },
  };
}
function savedTime(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not saved yet'; }

function FlowList({ flows, loading, error, onNew, onOpen, onRefresh }) {
  return (
    <section className="flow-workspace flow-library">
      <header className="flow-workspace__header">
        <div>
          <p className="eyebrow">LINKIFY FLOWS</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-.045em] sm:text-4xl">Event routing flows</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Create, schedule, and publish one permanent event link across its lifecycle.</p>
        </div>
        <button className="button-primary" type="button" onClick={onNew}>Create event flow</button>
      </header>
      {error && (
        <div className="flow-library__notice" role="alert">
          <span>{error}</span>
          <button type="button" className="button-secondary" onClick={onRefresh}>Try again</button>
        </div>
      )}
      {loading ? (
        <div className="flow-library__grid" aria-label="Loading flows">
          {[1, 2, 3].map((item) => <div key={item} className="panel skeleton h-40" />)}
        </div>
      ) : flows.length ? (
        <div className="flow-library__grid">
          {flows.map((flow) => {
            const isArchived = flow.lifecycleStatus === 'archived';
            const synchronized = flow.publishedRevision === flow.revision;
            return (
              <button type="button" className="flow-card panel" key={flow.id} onClick={() => onOpen(flow.id)}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`status-pill ${isArchived ? 'status-archived' : synchronized ? 'status-on' : 'status-off'}`}>
                    {isArchived ? 'Archived' : !flow.publishedRevision ? `Draft · revision ${flow.revision}` : synchronized ? `Published · revision ${flow.revision}` : `Unpublished changes · revision ${flow.revision}`}
                  </span>
                </div>
                <span className="flow-card__title">{flow.eventName}</span>
                <span className="flow-card__description">{flow.description || 'No description yet.'}</span>
                <span className="flow-card__meta">
                  <span>{flow.creatorTimeZone}</span>
                  <span>Saved {savedTime(flow.updatedAt)}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : !error && (
        <div className="flow-library__empty panel">
          <div className="flow-empty__icon" aria-hidden="true">⌘</div>
          <h2 className="mt-4 text-xl font-semibold">No saved flows yet</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Create an Event Lifecycle draft and save its graph, destinations, and creator timezone.</p>
          <button className="button-primary mt-5" type="button" onClick={onNew}>Create your first flow</button>
        </div>
      )}
    </section>
  );
}

function Editor({ initialFlow, initialValidation, initialPublication, onClose, onSaved, onDeleted }) {
  const base = hydrateFlow(initialFlow);
  const [draft, setDraft] = useState(() => ({ ...base, nodes: undefined, edges: undefined, graph: undefined }));
  const [nodes, setNodes, onNodesStateChange] = useNodesState(base.nodes);
  const [draftEdges, setEdges, applyEdgeChanges] = useEdgesState(base.edges);
  const [validation, setValidation] = useState(initialValidation ?? null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [dirty, setDirty] = useState(!base.id);
  const [saveState, setSaveState] = useState('idle');
  const [message, setMessage] = useState('');
  const [pendingTimeZone, setPendingTimeZone] = useState(null);

  // Tab View Mode: builder | simulator | analytics | history
  const [activeTab, setActiveTab] = useState('builder');

  // Publication state
  const [publication, setPublication] = useState(initialPublication ?? null);
  const [publishState, setPublishState] = useState('idle');
  const [publishMessage, setPublishMessage] = useState('');
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [customAlias, setCustomAlias] = useState('');
  const [aliasSuggestions, setAliasSuggestions] = useState([]);
  const [aliasMessage, setAliasMessage] = useState('');
  const [checkingAlias, setCheckingAlias] = useState(false);
  const [publicationKey, setPublicationKey] = useState(null);
  const [activeDestination, setActiveDestination] = useState(null);
  const [copyState, setCopyState] = useState('idle');

  // Lifecycle state: archive / restore
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);

  // Rollback status
  const [rollbackState, setRollbackState] = useState('idle');
  const [rollbackMessage, setRollbackMessage] = useState('');

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = draftEdges.find((edge) => edge.id === selectedEdgeId) ?? null;

  const edges = useMemo(() => draftEdges.map((edge) => ({
    ...edge,
    markerEnd: { type: MarkerType.ArrowClosed, color: '#6c8c68' },
    style: { stroke: edge.selected ? '#2f7130' : '#8fa28c', strokeWidth: edge.selected ? 2.5 : 1.8 },
    labelStyle: { fill: '#46564a', fontSize: 11, fontWeight: 650 },
    labelBgStyle: { fill: '#fffefa', fillOpacity: 0.92 },
    labelBgPadding: [5, 3],
    labelBgBorderRadius: 6,
  })), [draftEdges]);

  const isArchived = draft.lifecycleStatus === 'archived';
  const synchronized = Boolean(publication && draft.publishedRevision === draft.revision && !dirty);

  useEffect(() => {
    if (!draft.id || !publication) return;
    flowApi.activeDestination(draft.id)
      .then((result) => setActiveDestination(result.activeDestination))
      .catch(() => setActiveDestination(null));
  }, [draft.id, publication?.publishedRevision]);

  const markDirty = () => { setDirty(true); setSaveState('idle'); setMessage(''); };
  const updateDraft = (changes) => { setDraft((current) => ({ ...current, ...changes })); markDirty(); };
  const selectNode = useCallback((id) => { setSelectedNodeId(id || null); setSelectedEdgeId(null); if (id) setInspectorOpen(true); }, []);
  const onNodesChange = useCallback((changes) => {
    onNodesStateChange(changes);
    if (changes.toArray().some((change) => ['position', 'add', 'remove', 'replace'].includes(change.type))) markDirty();
  }, [onNodesStateChange]);

  const onEdgesChange = useCallback((changes) => {
    applyEdgeChanges(new EdgeChangeset(changes.toArray().filter((change) => change.type !== 'remove')));
  }, [applyEdgeChanges]);

  const onConnect = useCallback((connection) => {
    if (isSupportedFlowConnection(connection, nodes, draftEdges)) {
      setEdges((current) => addEdge({ ...connection, type: 'smoothstep', label: 'Scheduled outcome', data: { conditionLabel: 'Scheduled outcome' } }, current));
      markDirty();
    }
  }, [nodes, draftEdges, setEdges]);

  const updateNode = (data) => {
    setNodes((current) => current.map((node) => node.id === selectedNodeId ? { ...node, data: { ...node.data, ...data } } : node));
    markDirty();
  };

  const loadTemplate = () => {
    const graph = createEventLifecycleGraph();
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setSelectedNodeId('router');
    setSelectedEdgeId(null);
    markDirty();
  };

  const clearGraph = () => {
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    markDirty();
  };

  const addStage = () => {
    if (!nodes.some((node) => node.data.kind === 'router') || nodes.length >= 50) return;
    const id = `stage-${crypto.randomUUID()}`;
    const index = nodes.filter((node) => node.data.kind === 'destination').length;
    setNodes((current) => [...current, {
      id,
      type: 'flowNode',
      position: { x: 720, y: 520 + index * 120 },
      data: {
        kind: 'destination',
        phase: 'custom',
        eyebrow: 'OUTCOME',
        label: 'Scheduled stage',
        description: 'Custom lifecycle window',
        destinationUrl: '',
        schedule: { startLocal: '', endLocal: '', startDisambiguation: 'earlier', endDisambiguation: 'earlier', startAtUtc: null, endAtUtc: null },
      },
    }]);
    setEdges((current) => [...current, { id: `router-${id}`, source: 'router', target: id, label: 'Scheduled window', type: 'smoothstep', data: { conditionLabel: 'Scheduled window' } }]);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setInspectorOpen(true);
    markDirty();
  };

  const removeSelectedStage = () => {
    if (!selectedNode || selectedNode.data.phase !== 'custom') return;
    setNodes((current) => current.filter((node) => node.id !== selectedNode.id));
    setEdges((current) => current.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    markDirty();
  };

  async function save() {
    setSaveState('saving');
    setMessage('');
    try {
      const body = payloadFor(draft, nodes, draftEdges);
      const result = draft.id ? await flowApi.update(draft.id, body) : await flowApi.create(body);
      const saved = hydrateFlow(result.flow);
      setDraft({ ...saved, nodes: undefined, edges: undefined, graph: undefined, operationVersion: result.flow.operationVersion });
      setNodes(saved.nodes);
      setEdges(saved.edges);
      setValidation(result.validation);
      setDirty(false);
      setSaveState('saved');
      onSaved(saved);
    } catch (error) {
      setSaveState(error.status === 409 ? 'conflict' : 'failed');
      setMessage(error.message);
    }
  }

  async function reloadServerCopy() {
    try {
      const result = await flowApi.get(draft.id);
      const fresh = hydrateFlow(result.flow);
      setDraft({ ...fresh, nodes: undefined, edges: undefined, graph: undefined, operationVersion: result.flow.operationVersion });
      setNodes(fresh.nodes);
      setEdges(fresh.edges);
      setValidation(result.validation ?? null);
      setPublication(result.publication ?? null);
      setDirty(false);
      setSaveState('idle');
      setMessage('Reloaded the latest saved revision.');
    } catch (error) {
      setSaveState('failed');
      setMessage(error.message);
    }
  }

  async function remove() {
    if (!draft.id || !window.confirm(`Delete the draft “${draft.eventName}”? This cannot be undone.`)) return;
    try {
      await flowApi.remove(draft.id);
      onDeleted(draft.id);
    } catch (error) {
      setSaveState('failed');
      setMessage(error.message);
    }
  }

  function applyTimeZone(mode) {
    const changed = changeDraftTimeZone({ ...draft, nodes }, pendingTimeZone, mode);
    const { nodes: nextNodes, ...metadata } = changed;
    setDraft(metadata);
    setNodes(nextNodes);
    setPendingTimeZone(null);
    markDirty();
  }

  function requestClose() {
    if (!dirty || window.confirm('Discard unsaved flow changes?')) onClose();
  }

  async function validateFlow() {
    if (!draft.id) { setPublishMessage('Save this draft before server validation.'); return; }
    setPublishState('validating');
    setPublishMessage('');
    try {
      const result = await flowApi.validate(draft.id, payloadFor(draft, nodes, draftEdges));
      setValidation(result.validation);
      setPublishState('idle');
      setPublishMessage(result.validation.publishable ? 'Server validation passed.' : 'Resolve the validation issues before publishing.');
    } catch (error) {
      setPublishState('failed');
      setPublishMessage(error.message);
    }
  }

  async function checkAlias() {
    if (!customAlias.trim()) { setAliasMessage('Enter an alias to check.'); return; }
    setCheckingAlias(true);
    setAliasMessage('');
    setAliasSuggestions([]);
    try {
      const result = await flowApi.aliasAvailability(customAlias.trim());
      setAliasMessage(result.available ? `“${result.alias}” is available.` : `“${result.alias}” is already in use.`);
      setAliasSuggestions(result.suggestions ?? []);
    } catch (error) {
      setAliasMessage(error.message);
    } finally {
      setCheckingAlias(false);
    }
  }

  async function publish() {
    const key = publicationKey ?? crypto.randomUUID();
    setPublicationKey(key);
    setPublishState('publishing');
    setPublishMessage('');
    try {
      const result = await flowApi.publish(draft.id, {
        expectedRevision: draft.revision,
        ...(!publication && customAlias.trim() ? { customAlias: customAlias.trim() } : {}),
      }, key);
      setDraft((current) => ({
        ...current,
        publishedRevision: result.flow.publishedRevision,
        publicationSequence: result.flow.publicationSequence,
        publishedAt: result.flow.publishedAt,
        lifecycleStatus: 'active',
        linkId: result.flow.linkId,
        operationVersion: result.flow.operationVersion,
      }));
      setPublication(result.publication);
      setPublishState('published');
      setPublishMessage(result.idempotent ? 'Publication retry confirmed the existing result.' : 'Flow published successfully.');
      setPublishConfirm(false);
      setPublicationKey(null);
      setAliasSuggestions([]);
      const active = await flowApi.activeDestination(draft.id);
      setActiveDestination(active.activeDestination);
    } catch (error) {
      setPublishState('failed');
      setPublishMessage(error.message);
      if (error.code === 'ALIAS_CONFLICT') setAliasSuggestions(error.suggestions ?? []);
    }
  }

  async function handleArchive() {
    setLifecycleLoading(true);
    try {
      const key = crypto.randomUUID();
      const res = await flowApi.archive(draft.id, { expectedOperationVersion: draft.operationVersion }, key);
      setDraft((curr) => ({ ...curr, lifecycleStatus: 'archived', operationVersion: res.flow.operationVersion }));
      setPublication(res.publication ?? publication);
      setArchiveConfirm(false);
      setMessage('Flow archived. Public redirects now return HTTP 410.');
    } catch (err) {
      setMessage(`Archive failed: ${err.message}`);
    } finally {
      setLifecycleLoading(false);
    }
  }

  async function handleRestore() {
    setLifecycleLoading(true);
    try {
      const key = crypto.randomUUID();
      const res = await flowApi.restore(draft.id, { expectedOperationVersion: draft.operationVersion }, key);
      setDraft((curr) => ({ ...curr, lifecycleStatus: 'active', operationVersion: res.flow.operationVersion }));
      setPublication(res.publication ?? publication);
      setRestoreConfirm(false);
      setMessage('Flow restored. Public redirects are live again.');
      const active = await flowApi.activeDestination(draft.id);
      setActiveDestination(active.activeDestination);
    } catch (err) {
      setMessage(`Restore failed: ${err.message}`);
    } finally {
      setLifecycleLoading(false);
    }
  }

  async function handleRollback({ targetPublicationNumber, syncDraft, confirmDraftDiscard, idempotencyKey }) {
    setRollbackState('rolling_back');
    setRollbackMessage('');
    const key = idempotencyKey || crypto.randomUUID();
    try {
      const res = await flowApi.rollback(draft.id, { targetPublicationNumber, syncDraft, confirmDraftDiscard, expectedOperationVersion: draft.operationVersion }, key);
      const saved = hydrateFlow(res.flow);
      if (syncDraft) {
        setDraft({ ...saved, nodes: undefined, edges: undefined, graph: undefined, operationVersion: res.flow.operationVersion });
        setNodes(saved.nodes);
        setEdges(saved.edges);
        setDirty(false);
      } else {
        setDraft((curr) => ({
          ...curr,
          publishedRevision: res.flow.publishedRevision,
          publishedAt: res.flow.publishedAt,
          publicationSequence: res.flow.publicationSequence,
          operationVersion: res.flow.operationVersion,
        }));
      }
      setPublication(res.publication);
      setRollbackState('success');
      setRollbackMessage(`Rolled back to publication #${res.restoredFrom}. New live revision #${res.flow.publicationSequence} is active.`);
      const active = await flowApi.activeDestination(draft.id);
      setActiveDestination(active.activeDestination);
    } catch (err) {
      setRollbackState('failed');
      setRollbackMessage(err.message);
    }
  }

  async function copyPublishedUrl() {
    try {
      await navigator.clipboard.writeText(publication.shortUrl);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <section className="flow-workspace">
      {/* Top Header */}
      <header className="flow-workspace__header">
        <div>
          <button className="button-quiet -ml-2 mb-2" type="button" onClick={requestClose}>← All flows</button>
          <div className="flex flex-wrap items-center gap-2">
            <p className="eyebrow">LINKIFY FLOWS</p>
            <span className={`status-pill ${isArchived ? 'status-archived' : !publication ? 'status-off' : synchronized ? 'status-on' : 'status-off'}`}>
              {isArchived ? 'Archived Flow' : !publication ? 'Unpublished draft' : synchronized ? 'Published · synchronized' : 'Published · unpublished changes'}
            </span>
            {dirty && <span className="flow-unsaved">Unsaved changes</span>}
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-.045em] sm:text-4xl">{draft.eventName || 'Untitled event flow'}</h1>
          <p className="mt-2 text-sm text-muted">
            Revision {draft.revision ?? 'new'} · Last saved {savedTime(draft.updatedAt)}
            {draft.publishedRevision ? ` · Published revision ${draft.publishedRevision}` : ''}
            {draft.publicationSequence ? ` · Version #${draft.publicationSequence}` : ''}
          </p>
        </div>

        {/* Header Action Buttons */}
        <div className="flow-save-actions">
          {activeTab === 'builder' && (
            <>
              <button className="button-secondary" type="button" onClick={clearGraph}>New blank graph</button>
              <button className="button-secondary" type="button" onClick={loadTemplate}>Reset template</button>
              <button className="button-secondary" type="button" disabled={!nodes.some((node) => node.data.kind === 'router') || nodes.length >= 50} onClick={addStage}>+ Add stage</button>
              {draft.id && <button className="button-danger min-h-11 px-3" type="button" onClick={remove}>Delete draft</button>}
              <button className="button-secondary" type="button" disabled={!draft.id || publishState === 'validating'} onClick={validateFlow}>
                {publishState === 'validating' ? 'Validating…' : 'Validate Flow'}
              </button>
              <button className="button-primary" type="button" disabled={saveState === 'saving' || !dirty} onClick={save}>
                {saveState === 'saving' ? 'Saving…' : dirty ? 'Save Draft' : 'Saved'}
              </button>
            </>
          )}

          {/* Lifecycle Action Buttons */}
          {publication && !isArchived && (
            <button className="button-secondary text-xs" type="button" onClick={() => setArchiveConfirm(true)}>
              Archive Flow
            </button>
          )}
          {isArchived && (
            <button className="button-primary text-xs" type="button" onClick={() => setRestoreConfirm(true)}>
              Restore Flow
            </button>
          )}

          {/* Publication Button */}
          {!isArchived && (
            <button
              className="button-primary"
              type="button"
              disabled={!draft.id || dirty || !validation?.publishable || synchronized || publishState === 'publishing'}
              onClick={() => setPublishConfirm(true)}
            >
              {publishState === 'publishing' ? 'Publishing…' : publication ? 'Republish Changes' : 'Publish Flow'}
            </button>
          )}
        </div>
      </header>

      {/* Messages */}
      {(message || saveState === 'saved') && (
        <div className={`flow-save-message ${saveState === 'failed' || saveState === 'conflict' ? 'is-error' : ''}`} role="status">
          <span>{saveState === 'failed' ? `Save failed: ${message}` : saveState === 'conflict' ? `Revision conflict: ${message}` : message || `Saved revision ${draft.revision}.`}</span>
          {saveState === 'conflict' && <button className="button-secondary" type="button" onClick={reloadServerCopy}>Reload server revision</button>}
        </div>
      )}
      {publishMessage && (
        <div className={`flow-save-message ${publishState === 'failed' ? 'is-error' : ''}`} role="status">
          {publishMessage}
        </div>
      )}

      {/* Navigation Tabs */}
      <nav className="flow-view-tabs" role="tablist" aria-label="Flow views">
        <button
          type="button"
          role="tab"
          id="tab-builder"
          aria-selected={activeTab === 'builder'}
          aria-controls="panel-builder"
          className="flow-tab-btn"
          onClick={() => setActiveTab('builder')}
        >
          <span>◫</span> Builder
        </button>
        <button
          type="button"
          role="tab"
          id="tab-simulator"
          aria-selected={activeTab === 'simulator'}
          aria-controls="panel-simulator"
          className="flow-tab-btn"
          onClick={() => setActiveTab('simulator')}
        >
          <span>◷</span> Simulator
        </button>
        <button
          type="button"
          role="tab"
          id="tab-analytics"
          aria-selected={activeTab === 'analytics'}
          aria-controls="panel-analytics"
          className="flow-tab-btn"
          onClick={() => setActiveTab('analytics')}
        >
          <span>◰</span> Analytics
        </button>
        <button
          type="button"
          role="tab"
          id="tab-history"
          aria-selected={activeTab === 'history'}
          aria-controls="panel-history"
          className="flow-tab-btn"
          onClick={() => setActiveTab('history')}
        >
          <span>◪</span> History
        </button>
      </nav>

      {/* VIEW: SIMULATOR */}
      {activeTab === 'simulator' && (
        <div id="panel-simulator" role="tabpanel" aria-labelledby="tab-simulator" className="mt-5">
          <FlowSimulator
            flowId={draft.id}
            creatorTimeZone={draft.creatorTimeZone}
            eventStartLocal={draft.eventStartLocal}
            eventEndLocal={draft.eventEndLocal}
          />
        </div>
      )}

      {/* VIEW: ANALYTICS */}
      {activeTab === 'analytics' && (
        <div id="panel-analytics" role="tabpanel" aria-labelledby="tab-analytics" className="mt-5">
          <FlowAnalytics
            flowId={draft.id}
            publication={publication}
          />
        </div>
      )}

      {/* VIEW: HISTORY */}
      {activeTab === 'history' && (
        <div id="panel-history" role="tabpanel" aria-labelledby="tab-history" className="mt-5">
          <FlowHistory
            flowId={draft.id}
            isDraftDirty={dirty}
            hasUnpublishedSavedChanges={Boolean(publication && draft.publishedRevision && draft.revision > draft.publishedRevision)}
            draftRevision={draft.revision}
            onRollbackRequested={handleRollback}
            rollbackState={rollbackState}
            rollbackMessage={rollbackMessage}
          />
        </div>
      )}

      {/* VIEW: BUILDER */}
      {activeTab === 'builder' && (
        <div id="panel-builder" role="tabpanel" aria-labelledby="tab-builder">
          {/* Publication Summary Panel */}
          <section className="flow-publication-panel" aria-labelledby="publication-title">
            <div className="flow-publication-panel__summary">
              <div>
                <p className="eyebrow">PUBLICATION</p>
                <h2 id="publication-title" className="mt-1 text-lg font-semibold">
                  {publication ? 'Permanent event link' : 'Publish when ready'}
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted">
                  {isArchived
                    ? 'This flow is archived. Public redirects return HTTP 410 until restored.'
                    : publication
                      ? `Published revision ${draft.publishedRevision} · ${savedTime(draft.publishedAt)}`
                      : 'Validation must pass and all changes must be saved.'}
                </p>
              </div>
              {publication && (
                <span className={`status-pill ${isArchived ? 'status-archived' : synchronized ? 'status-on' : 'status-off'}`}>
                  {isArchived ? 'Archived' : synchronized ? 'Live and synchronized' : 'Draft changes not live'}
                </span>
              )}
            </div>

            {!publication ? (
              <div className="flow-publish-alias">
                <label className="text-xs font-semibold">
                  Permanent custom alias <span className="font-normal text-muted">(optional, cannot change later)</span>
                  <input
                    className="field-control"
                    value={customAlias}
                    maxLength={40}
                    placeholder="community-summit"
                    onChange={(event) => {
                      setCustomAlias(event.target.value);
                      setPublicationKey(null);
                      setAliasMessage('');
                      setAliasSuggestions([]);
                    }}
                  />
                </label>
                <button className="button-secondary" type="button" disabled={checkingAlias} onClick={checkAlias}>
                  {checkingAlias ? 'Checking…' : 'Check alias'}
                </button>
                {aliasMessage && <p className="text-xs text-muted sm:col-span-2">{aliasMessage}</p>}
                <div className="sm:col-span-2">
                  <AliasSuggestions
                    aliases={aliasSuggestions}
                    onSelect={(alias) => {
                      setCustomAlias(alias);
                      setAliasSuggestions([]);
                      setAliasMessage(`“${alias}” selected.`);
                      setPublicationKey(null);
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="flow-published-result">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted">Permanent short URL</p>
                  <a
                    className="mt-1 block break-all text-base font-semibold text-brand-strong underline underline-offset-4"
                    href={publication.shortUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {publication.shortUrl}
                  </a>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="button-secondary" type="button" onClick={copyPublishedUrl}>
                      {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy manually' : 'Copy URL'}
                    </button>
                  </div>
                  {activeDestination && !isArchived && (
                    <div className="flow-active-destination">
                      <span>Active now</span>
                      <strong>{activeDestination.destinationUrl}</strong>
                      <small>{activeDestination.usedFallback ? 'Fallback destination' : `Matched ${activeDestination.matchedRuleId}`}</small>
                    </div>
                  )}
                </div>
                <QrCode value={publication.shortUrl} name={`linkify-${publication.shortCode}`} />
              </div>
            )}
          </section>

          {/* Timeline and Canvas */}
          <FlowTimeline draft={draft} nodes={nodes} validation={validation} selectedNodeId={selectedNodeId} onSelectNode={selectNode} />
          <div className="flow-timezone-bar">
            <span aria-hidden="true">◷</span>
            <span>Saved schedule timezone</span>
            <strong>{draft.creatorTimeZone}</strong>
            <span className="hidden text-muted sm:inline">· scanner timezone is never used</span>
          </div>
          <div className="flow-layout">
            <div className="flow-canvas-wrap" aria-label="Event flow graph editor">
              {nodes.length ? (
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  isValidConnection={(connection) => isSupportedFlowConnection(connection, nodes, draftEdges)}
                  onNodeClick={(_event, node) => selectNode(node.id)}
                  onEdgeClick={(_event, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); setInspectorOpen(true); }}
                  onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }}
                  fitView
                  fitViewOptions={{ padding: 0.16 }}
                  minZoom={0.35}
                  maxZoom={1.8}
                  deleteKeyCode={null}
                  nodesConnectable
                  elementsSelectable
                  attributionPosition="bottom-left"
                >
                  <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#cfd5ca" />
                  <Controls position="top-left" showInteractive={false} />
                </ReactFlow>
              ) : (
                <div className="flow-empty">
                  <div className="flow-empty__icon" aria-hidden="true">⌘</div>
                  <h2 className="mt-4 text-xl font-semibold">Start a new event flow</h2>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-muted">Add the constrained Event Lifecycle template.</p>
                  <button className="button-primary mt-5" type="button" onClick={loadTemplate}>Use Event Lifecycle template</button>
                </div>
              )}
            </div>
            <button
              type="button"
              className="flow-inspector-toggle button-secondary"
              aria-expanded={inspectorOpen}
              onClick={() => setInspectorOpen((value) => !value)}
            >
              {inspectorOpen ? 'Hide editor' : 'Edit flow details'}
            </button>
            <div className={inspectorOpen ? 'flow-inspector-slot is-open' : 'flow-inspector-slot'}>
              <FlowInspector
                draft={{ ...draft, nodes, edges: draftEdges }}
                selectedNode={selectedNode}
                selectedEdge={selectedEdge}
                onDraftChange={updateDraft}
                onNodeChange={updateNode}
                onSelectNode={selectNode}
                onTimeZoneRequest={(zone) => zone !== draft.creatorTimeZone && setPendingTimeZone(zone)}
                onRemoveNode={removeSelectedStage}
              />
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modals */}
      {publishConfirm && (
        <div className="flow-publish-confirm" role="dialog" aria-modal="true" aria-labelledby="publish-confirm-title">
          <div className="panel">
            <p className="eyebrow">CONFIRM PUBLICATION</p>
            <h2 id="publish-confirm-title" className="mt-2 text-xl font-semibold">
              {publication ? 'Republish saved changes?' : 'Create the permanent event link?'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Revision {draft.revision} will become live. The permanent alias and QR identity cannot be changed after first publication.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button className="button-secondary" type="button" onClick={() => setPublishConfirm(false)}>Cancel</button>
              <button className="button-primary" type="button" disabled={publishState === 'publishing'} onClick={publish}>
                {publishState === 'publishing' ? 'Publishing…' : publication ? 'Republish Changes' : 'Publish Flow'}
              </button>
            </div>
          </div>
        </div>
      )}

      {archiveConfirm && (
        <div className="flow-publish-confirm" role="dialog" aria-modal="true" aria-labelledby="archive-confirm-title">
          <div className="panel">
            <p className="eyebrow text-danger">ARCHIVE FLOW</p>
            <h2 id="archive-confirm-title" className="mt-2 text-xl font-semibold">
              Archive “{draft.eventName}”?
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Archiving disables public redirects (visitors receive HTTP 410) and pauses click recording. The short code, QR code identity, publication snapshots, and historical analytics are fully preserved. You can restore this Flow at any time.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button className="button-secondary" type="button" onClick={() => setArchiveConfirm(false)}>Cancel</button>
              <button className="button-danger min-h-11 px-4" type="button" disabled={lifecycleLoading} onClick={handleArchive}>
                {lifecycleLoading ? 'Archiving…' : 'Confirm Archive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {restoreConfirm && (
        <div className="flow-publish-confirm" role="dialog" aria-modal="true" aria-labelledby="restore-confirm-title">
          <div className="panel">
            <p className="eyebrow">RESTORE FLOW</p>
            <h2 id="restore-confirm-title" className="mt-2 text-xl font-semibold">
              Restore “{draft.eventName}”?
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Restoring this Flow re-enables public redirects and immediately resumes routing audience traffic according to the published schedule.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button className="button-secondary" type="button" onClick={() => setRestoreConfirm(false)}>Cancel</button>
              <button className="button-primary min-h-11 px-4" type="button" disabled={lifecycleLoading} onClick={handleRestore}>
                {lifecycleLoading ? 'Restoring…' : 'Confirm Restore'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingTimeZone && (
        <div className="flow-timezone-choice" role="dialog" aria-label="Choose timezone change behavior">
          <div>
            <strong>Change timezone to {pendingTimeZone}?</strong>
            <p>Choose what the existing schedule should preserve. Save valid dates first to preserve absolute instants.</p>
          </div>
          <button className="button-secondary" type="button" onClick={() => applyTimeZone('wall')}>Preserve local wall times</button>
          <button className="button-secondary" type="button" disabled={!draft.eventStartAtUtc && !draft.eventEndAtUtc} onClick={() => applyTimeZone('instant')}>Preserve absolute instants</button>
          <button className="button-quiet" type="button" onClick={() => setPendingTimeZone(null)}>Cancel</button>
        </div>
      )}
    </section>
  );
}

export default function FlowWorkspace({ initialFlowId = null }) {
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [active, setActive] = useState(null);
  const [activeValidation, setActiveValidation] = useState(null);
  const [activePublication, setActivePublication] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await flowApi.list();
      setFlows(result.flows);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { if (initialFlowId) open(initialFlowId); }, [initialFlowId]);

  async function open(id) {
    setError('');
    try {
      const result = await flowApi.get(id);
      setActive(hydrateFlow(result.flow));
      setActiveValidation(result.validation ?? null);
      setActivePublication(result.publication ?? null);
    } catch (failure) {
      setError(failure.message);
    }
  }

  function updateList(flow) {
    setFlows((current) => [flow, ...current.filter((item) => item.id !== flow.id)]);
  }

  if (active) {
    return (
      <ReactFlowProvider>
        <Editor
          key={active.id ?? 'new'}
          initialFlow={active}
          initialValidation={activeValidation}
          initialPublication={activePublication}
          onClose={() => { setActive(null); setActivePublication(null); load(); }}
          onSaved={updateList}
          onDeleted={(id) => {
            setFlows((current) => current.filter((item) => item.id !== id));
            setActive(null);
            setActivePublication(null);
          }}
        />
      </ReactFlowProvider>
    );
  }

  return (
    <FlowList
      flows={flows}
      loading={loading}
      error={error}
      onNew={() => { setActive(createFlowDraft()); setActiveValidation(null); setActivePublication(null); }}
      onOpen={open}
      onRefresh={load}
    />
  );
}
