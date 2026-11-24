import { Handle, Position } from '@xyflow/react';
import { FLOW_NODE_TYPES } from '../utils/flowDraft.js';

export default function FlowNode({ data, selected }) {
  const acceptsInput = data.kind !== FLOW_NODE_TYPES.ENTRY;
  const hasOutput = [FLOW_NODE_TYPES.ENTRY, FLOW_NODE_TYPES.ROUTER].includes(data.kind);
  return <article className={`flow-node flow-node--${data.kind} ${selected ? 'is-selected' : ''}`} aria-label={`${data.eyebrow}: ${data.label}`}>
    {acceptsInput && <Handle type="target" position={Position.Left} isConnectable />}
    <div className="flow-node__icon" aria-hidden="true">{data.kind === FLOW_NODE_TYPES.ENTRY ? '↗' : data.kind === FLOW_NODE_TYPES.ROUTER ? '⌘' : data.kind === FLOW_NODE_TYPES.FALLBACK ? '…' : '→'}</div>
    <div className="min-w-0"><p className="flow-node__eyebrow">{data.eyebrow}</p><p className="flow-node__label">{data.label}</p><p className="flow-node__description">{data.description}</p></div>
    {hasOutput && <Handle type="source" position={Position.Right} isConnectable />}
  </article>;
}
