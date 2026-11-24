import { useCallback, useMemo, useState } from 'react';
import { addEdge, Background, BackgroundVariant, Controls, EdgeChangeset, MarkerType, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import FlowInspector from './FlowInspector.jsx';
import FlowNode from './FlowNode.jsx';
import { createEventLifecycleGraph, createFlowDraft, isSupportedFlowConnection } from '../utils/flowDraft.js';

const nodeTypes = { flowNode: FlowNode };

function Editor() {
  const [initialDraft] = useState(() => createFlowDraft());
  const [draft, setDraft] = useState(() => ({ ...initialDraft, nodes: undefined, edges: undefined }));
  const [nodes, setNodes, onNodesChange] = useNodesState(initialDraft.nodes);
  const [draftEdges, setEdges, applyEdgeChanges] = useEdgesState(initialDraft.edges);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = draftEdges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const edges = useMemo(() => draftEdges.map((edge) => ({ ...edge, markerEnd: { type: MarkerType.ArrowClosed, color: '#6c8c68' }, style: { stroke: edge.selected ? '#2f7130' : '#8fa28c', strokeWidth: edge.selected ? 2.5 : 1.8 }, labelStyle: { fill: '#46564a', fontSize: 11, fontWeight: 650 }, labelBgStyle: { fill: '#fffefa', fillOpacity: .92 }, labelBgPadding: [5, 3], labelBgBorderRadius: 6 })), [draftEdges]);
  const updateDraft = (changes) => setDraft((current) => ({ ...current, ...changes }));
  const selectNode = useCallback((id) => { setSelectedNodeId(id || null); setSelectedEdgeId(null); if (id) setInspectorOpen(true); }, []);
  const onEdgesChange = useCallback((changes) => applyEdgeChanges(new EdgeChangeset(changes.toArray().filter((change) => change.type !== 'remove'))), [applyEdgeChanges]);
  const onConnect = useCallback((connection) => { if (isSupportedFlowConnection(connection, nodes, draftEdges)) setEdges((current) => addEdge({ ...connection, type: 'smoothstep', label: 'Scheduled outcome', data: { conditionLabel: 'Scheduled outcome' } }, current)); }, [nodes, draftEdges, setEdges]);
  const updateNode = (data) => setNodes((current) => current.map((node) => node.id === selectedNodeId ? { ...node, data: { ...node.data, ...data } } : node));
  const loadTemplate = () => { const graph = createEventLifecycleGraph(); setNodes(graph.nodes); setEdges(graph.edges); setSelectedNodeId('router'); setSelectedEdgeId(null); };
  const clearGraph = () => { setNodes([]); setEdges([]); setSelectedNodeId(null); setSelectedEdgeId(null); };

  return <section className="flow-workspace">
    <header className="flow-workspace__header"><div><div className="flex flex-wrap items-center gap-2"><p className="eyebrow">LINKIFY FLOWS</p><span className="status-pill status-off">Local draft · not published</span></div><h1 className="mt-2 text-3xl font-semibold tracking-[-.045em] sm:text-4xl">Visual event routing</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">One permanent short URL and QR, with scheduled destinations for each event phase.</p></div><div className="flex flex-wrap gap-2"><button className="button-secondary" type="button" onClick={clearGraph}>New blank flow</button><button className="button-primary" type="button" onClick={loadTemplate}>Event Lifecycle template</button></div></header>
    <div className="flow-timezone-bar"><span aria-hidden="true">◷</span><span>Schedule timezone</span><strong>{draft.timeZone}</strong><span className="hidden text-muted sm:inline">· fixed for this draft unless you change it</span></div>
    <div className="flow-layout">
      <div className="flow-canvas-wrap" aria-label="Event flow graph editor">
        {nodes.length ? <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} isValidConnection={(connection) => isSupportedFlowConnection(connection, nodes, draftEdges)} onNodeClick={(_event, node) => selectNode(node.id)} onEdgeClick={(_event, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); setInspectorOpen(true); }} onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }} fitView fitViewOptions={{ padding: .16 }} minZoom={.35} maxZoom={1.8} deleteKeyCode={null} nodesConnectable elementsSelectable attributionPosition="bottom-left">
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#cfd5ca" />
          <Controls position="top-left" showInteractive={false} />
        </ReactFlow> : <div className="flow-empty"><div className="flow-empty__icon" aria-hidden="true">⌘</div><h2 className="mt-4 text-xl font-semibold">Start a new event flow</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted">Add the Event Lifecycle template to map one routing decision across before, during, after, and fallback destinations.</p><button className="button-primary mt-5" type="button" onClick={loadTemplate}>Use Event Lifecycle template</button></div>}
      </div>
      <button type="button" className="flow-inspector-toggle button-secondary" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen((value) => !value)}>{inspectorOpen ? 'Hide editor' : 'Edit flow details'}</button>
      <div className={inspectorOpen ? 'flow-inspector-slot is-open' : 'flow-inspector-slot'}><FlowInspector draft={{ ...draft, nodes, edges: draftEdges }} selectedNode={selectedNode} selectedEdge={selectedEdge} onDraftChange={updateDraft} onNodeChange={updateNode} onSelectNode={selectNode} /></div>
    </div>
  </section>;
}

export default function FlowWorkspace() {
  return <ReactFlowProvider><Editor /></ReactFlowProvider>;
}
