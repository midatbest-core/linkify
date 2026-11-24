export function normalizePublicationSnapshot(snapshot, {
  publicationNumber = 1,
  operation = 'publish',
  restoredFrom = null,
  publishedAt = null,
  flow = null,
} = {}) {
  if (!snapshot) return null;
  const raw = snapshot.toObject?.() ?? structuredClone(snapshot);
  const pubNum = raw.publicationNumber ?? publicationNumber;
  const op = raw.operation ?? operation;
  const restored = raw.restoredFrom ?? restoredFrom;
  const timeZone = raw.creatorTimeZone ?? flow?.creatorTimeZone ?? 'UTC';

  // If stages already exist (schemaVersion 2), preserve them
  let stages = raw.stages;
  if (!Array.isArray(stages)) {
    const rules = raw.adaptiveRouting?.rules ?? [];
    stages = rules.map((rule) => ({
      stageId: rule.ruleId,
      label: rule.ruleId, // Do not fabricate missing labels; use the ruleId
      destinationId: rule.destinationId ?? `rule:${rule.ruleId}`,
      destinationUrl: rule.destinationUrl,
      startAt: rule.startAt ? new Date(rule.startAt).toISOString() : null,
      endAt: rule.endAt ? new Date(rule.endAt).toISOString() : null,
    }));
  }

  // If fallback already exists, preserve it
  let fallback = raw.fallback;
  if (!fallback) {
    fallback = {
      stageId: 'default',
      nodeId: 'fallback',
      label: 'Fallback',
      destinationId: raw.adaptiveRouting?.defaultDestinationId ?? 'default',
      destinationUrl: raw.adaptiveRouting?.defaultDestinationUrl ?? '',
    };
  }

  return {
    schemaVersion: 2,
    flowId: raw.flowId ?? flow?.flowId,
    revision: raw.revision,
    publicationNumber: pubNum,
    operation: op,
    restoredFrom: restored,
    creatorTimeZone: timeZone,
    eventStartAtUtc: raw.eventStartAtUtc ? new Date(raw.eventStartAtUtc).toISOString() : null,
    eventEndAtUtc: raw.eventEndAtUtc ? new Date(raw.eventEndAtUtc).toISOString() : null,
    stages,
    fallback,
    adaptiveRouting: raw.adaptiveRouting ?? null,
  };
}

export function normalizeFlowDoc(flow) {
  if (!flow) return null;
  const plain = flow.toObject?.() ?? flow;
  const historyLen = Array.isArray(plain.publicationHistory) ? plain.publicationHistory.length : 0;
  return {
    ...plain,
    lifecycleStatus: plain.lifecycleStatus ?? 'active',
    operationVersion: plain.operationVersion ?? 0,
    publicationSequence: plain.publicationSequence ?? historyLen,
  };
}
