import { normalizeAdaptiveRouting, resolveAdaptiveDestination } from './adaptiveRoutingService.js';
import { validateFlowConfiguration } from './flowService.js';

function compilationError(message) { return Object.assign(new Error(message), { status: 400, code: 'FLOW_NOT_PUBLISHABLE' }); }

export function compileFlowToAdaptiveRouting(flow, { previousRouting } = {}) {
  const plain = flow?.toObject?.() ?? flow;
  const stages = [...(plain.draft?.routing?.stages ?? [])];
  if (stages.length > 20) throw compilationError('Published flows support up to 20 scheduled stages.');
  const validation = validateFlowConfiguration(plain);
  if (!validation.publishable) throw compilationError(validation.errors.map((item) => item.message).join(' '));
  const phaseOrder = { before: 0, during: 1, custom: 2, after: 3 };
  stages.sort((left, right) => {
    const leftStart = left.startAtUtc ? new Date(left.startAtUtc).getTime() : -Infinity;
    const rightStart = right.startAtUtc ? new Date(right.startAtUtc).getTime() : -Infinity;
    return leftStart - rightStart || (phaseOrder[left.phase] ?? 9) - (phaseOrder[right.phase] ?? 9) || left.nodeId.localeCompare(right.nodeId);
  });
  const input = {
    enabled: true,
    defaultDestinationUrl: plain.draft.routing.fallbackDestinationUrl,
    rules: stages.map((stage) => ({
      ruleId: stage.nodeId,
      ...(stage.startAtUtc ? { startAt: new Date(stage.startAtUtc).toISOString() } : {}),
      ...(stage.endAtUtc ? { endAt: new Date(stage.endAtUtc).toISOString() } : {}),
      timeZone: plain.creatorTimeZone,
      destinationUrl: stage.destinationUrl,
      enabled: true,
    })),
  };
  const normalized = normalizeAdaptiveRouting(input, { defaultDestinationUrl: input.defaultDestinationUrl, previousRouting });
  if (normalized.error) throw compilationError(normalized.error);
  return normalized.value;
}

export function verifyCompiledFlow(flow, adaptiveRouting, instants) {
  const plain = flow?.toObject?.() ?? flow;
  const link = { originalUrl: adaptiveRouting.defaultDestinationUrl, adaptiveRouting };
  return instants.map((now) => ({ now: new Date(now), ...resolveAdaptiveDestination(link, { now: new Date(now) }) }));
}
