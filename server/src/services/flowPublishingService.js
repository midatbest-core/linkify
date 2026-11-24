import { createHash } from 'node:crypto';
import { normalizeAndValidateAlias, normalizeAndValidateUrl } from '../utils/validation.js';
import { AliasConflictError, createLinkService, generateShortCode } from './linkService.js';
import { compileFlowToAdaptiveRouting } from './flowCompiler.js';
import { resolveAdaptiveDestination } from './adaptiveRoutingService.js';
import { publicationSnapshot } from './flowIntelligenceService.js';
import { utcDateTimeToLocal } from '../utils/schedule.js';
import { normalizePublicationSnapshot, normalizeFlowDoc } from '../utils/flowNormalization.js';

export const IDEMPOTENCY_RETENTION_MS = 48 * 60 * 60 * 1000; // 48 hours

function httpError(message, status = 400, code = 'INVALID_FLOW_REQUEST') {
  return Object.assign(new Error(message), { status, code });
}

function plain(value) { return value?.toObject?.() ?? value; }

function withSession(query, session) {
  return typeof query?.session === 'function' ? query.session(session) : query;
}

export function publicationHash(flowId, revision, customAlias) {
  return createHash('sha256').update(JSON.stringify({ flowId, operation: 'publish', revision, customAlias: customAlias ?? null })).digest('hex');
}

export function rollbackHash(flowId, targetPublicationNumber, syncDraft, confirmDraftDiscard) {
  return createHash('sha256').update(JSON.stringify({ flowId, operation: 'rollback', targetPublicationNumber, syncDraft: Boolean(syncDraft), confirmDraftDiscard: Boolean(confirmDraftDiscard) })).digest('hex');
}

export function lifecycleHash(flowId, operation) {
  return createHash('sha256').update(JSON.stringify({ flowId, operation })).digest('hex');
}

function normalizeKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    throw httpError('Idempotency-Key must be 8–128 letters, numbers, dots, underscores, colons, or hyphens.', 400, 'INVALID_IDEMPOTENCY_KEY');
  }
  return value;
}

function syncDraftFromSnapshot(rawFlow, snapshot) {
  const normSnap = normalizePublicationSnapshot(snapshot, { flow: rawFlow });
  const fallback = normSnap.fallback;
  const timeZone = normSnap.creatorTimeZone || rawFlow.creatorTimeZone;

  const existingNodes = rawFlow.draft?.presentation?.nodes ?? [];
  const existingNodeMap = new Map(existingNodes.map((n) => [n.nodeId, n]));

  // 1. Entry node
  const entryNode = existingNodeMap.get('entry') ?? {
    nodeId: 'entry',
    kind: 'entry',
    label: 'Permanent short URL + QR',
    description: 'One permanent audience entry point',
    position: { x: 40, y: 205 },
  };

  // 2. Router node
  const routerNode = existingNodeMap.get('router') ?? {
    nodeId: 'router',
    kind: 'router',
    label: 'Event phase router',
    description: 'Evaluates the schedule once per visit',
    position: { x: 350, y: 205 },
  };

  // 3. Fallback node
  const fallbackNodeId = rawFlow.draft?.routing?.fallbackNodeId ?? fallback?.nodeId ?? 'fallback';
  const existingFallbackNode = existingNodeMap.get(fallbackNodeId) ?? existingNodeMap.get('fallback');
  const fallbackNode = {
    nodeId: fallbackNodeId,
    kind: 'fallback',
    label: fallback?.label || existingFallbackNode?.label || 'Fallback',
    description: existingFallbackNode?.description || 'Fallback destination',
    position: existingFallbackNode?.position ?? { x: 720, y: 415 },
  };

  // 4. Reconstruct destination nodes strictly matching the historical snapshot
  const destinationNodes = (normSnap.stages ?? []).map((stage, index) => {
    const existing = existingNodeMap.get(stage.stageId);
    const phase = stage.phase ?? (['before', 'during', 'after'].includes(stage.stageId) ? stage.stageId : 'custom');
    return {
      nodeId: stage.stageId,
      kind: 'destination',
      phase,
      label: stage.label || existing?.label || stage.stageId,
      description: existing?.description || `${stage.stageId} lifecycle stage`,
      position: existing?.position ?? { x: 720, y: 10 + index * 135 },
    };
  });

  const presentationNodes = [entryNode, routerNode, ...destinationNodes, fallbackNode];

  // 5. Reconstruct edges strictly connecting router to each stage and fallback
  const presentationEdges = [
    { edgeId: 'entry-router', source: entryNode.nodeId, target: routerNode.nodeId, label: 'Every visit' },
    ...destinationNodes.map((node) => ({
      edgeId: `router-${node.nodeId}`,
      source: routerNode.nodeId,
      target: node.nodeId,
      label: node.label || 'Scheduled outcome',
    })),
    {
      edgeId: `router-${fallbackNode.nodeId}`,
      source: routerNode.nodeId,
      target: fallbackNode.nodeId,
      label: 'No phase match',
    },
  ];

  // 6. Routing stages matching historical snapshot
  const routingStages = (normSnap.stages ?? []).map((stage) => {
    const phase = stage.phase ?? (['before', 'during', 'after'].includes(stage.stageId) ? stage.stageId : 'custom');
    return {
      nodeId: stage.stageId,
      phase,
      destinationUrl: stage.destinationUrl,
      startAtUtc: stage.startAt ? new Date(stage.startAt) : null,
      endAtUtc: stage.endAt ? new Date(stage.endAt) : null,
      startLocal: stage.startAt ? utcDateTimeToLocal(stage.startAt, timeZone) : '',
      endLocal: stage.endAt ? utcDateTimeToLocal(stage.endAt, timeZone) : '',
      startDisambiguation: 'earlier',
      endDisambiguation: 'earlier',
    };
  });

  return {
    ...rawFlow.draft,
    presentation: {
      nodes: presentationNodes,
      edges: presentationEdges,
    },
    routing: {
      stages: routingStages,
      fallbackNodeId: fallbackNode.nodeId,
      fallbackDestinationUrl: fallback?.destinationUrl ?? '',
    },
  };
}

export function createFlowPublishingService({ Flow, Link, FlowPublication, codeGenerator = generateShortCode, now = () => new Date() }) {
  const aliasService = createLinkService(Link, { codeGenerator });

  async function linkById(id, session) {
    return withSession(Link.findById(id), session);
  }

  async function allocateCode(customAlias, session) {
    if (customAlias) {
      const normalized = normalizeAndValidateAlias(customAlias);
      if (normalized.error) throw httpError(normalized.error, 400, 'INVALID_ALIAS');
      const exists = await withSession(Link.exists({ shortCode: normalized.value }), session);
      if (exists) throw new AliasConflictError(normalized.value, await aliasService.suggestAliases(normalized.value));
      return { shortCode: normalized.value, isCustomAlias: true };
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const shortCode = codeGenerator();
      if (!(await withSession(Link.exists({ shortCode }), session))) return { shortCode, isCustomAlias: false };
    }
    throw httpError('Could not allocate a unique short code. Please retry publication.', 503, 'CODE_ALLOCATION_FAILED');
  }

  async function publish(flowId, { expectedRevision, customAlias, expectedOperationVersion }, idempotencyKey) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw httpError('A valid expected draft revision is required.', 400, 'INVALID_REVISION');
    }
    const key = normalizeKey(idempotencyKey);
    const normalizedAlias = customAlias ? normalizeAndValidateAlias(customAlias) : { value: null };
    if (normalizedAlias.error) throw httpError(normalizedAlias.error, 400, 'INVALID_ALIAS');
    const payloadHash = publicationHash(flowId, expectedRevision, normalizedAlias.value);
    const expectedOpVersion = expectedOperationVersion !== undefined ? Number(expectedOperationVersion) : undefined;

    if (!Flow.db?.startSession) throw httpError('Atomic publishing requires MongoDB transaction support.', 503, 'TRANSACTIONS_REQUIRED');
    const session = await Flow.db.startSession();
    let outcome;
    try {
      await session.withTransaction(async () => {
        const flow = await withSession(Flow.findOne({ flowId }), session);
        if (!flow) throw httpError('Flow not found.', 404, 'FLOW_NOT_FOUND');
        const rawFlow = normalizeFlowDoc(flow);
        const currentTime = now();

        if (expectedOpVersion !== undefined && rawFlow.operationVersion !== expectedOpVersion) {
          throw httpError('The flow was modified concurrently. Please reload and retry.', 409, 'OPERATION_CONFLICT');
        }

        if (rawFlow.lifecycleStatus === 'archived') {
          throw httpError('This Flow is archived and cannot be published. Restore the Flow before publishing.', 409, 'FLOW_ARCHIVED');
        }

        const previousRequest = (rawFlow.publicationRequests ?? []).find(
          (request) => request.key === key && (!request.expiresAt || new Date(request.expiresAt) > currentTime),
        );
        if (previousRequest) {
          if (previousRequest.payloadHash !== payloadHash) {
            throw httpError('This idempotency key was already used with a different publication request.', 409, 'IDEMPOTENCY_CONFLICT');
          }
          const link = await linkById(previousRequest.linkId, session);
          if (!link) throw httpError('The prior publication link is unavailable.', 409, 'PUBLICATION_INCONSISTENT');
          outcome = { flow, link, publishedAt: previousRequest.publishedAt, idempotent: true };
          return;
        }

        const activeRequests = (rawFlow.publicationRequests ?? []).filter(
          (r) => !r.expiresAt || new Date(r.expiresAt) > currentTime,
        );

        if (rawFlow.revision !== expectedRevision) {
          throw httpError('The draft changed before publication. Reload and publish the latest saved revision.', 409, 'STALE_FLOW_REVISION');
        }

        let link = rawFlow.linkId ? await linkById(rawFlow.linkId, session) : null;
        if (rawFlow.linkId && !link) throw httpError('The Flow-managed link is unavailable.', 409, 'PUBLICATION_INCONSISTENT');
        if (link && normalizedAlias.value && normalizedAlias.value !== link.shortCode) {
          throw httpError('The permanent alias cannot change after first publication.', 409, 'ALIAS_IMMUTABLE');
        }

        const previousRouting = link ? plain(link.adaptiveRouting) : undefined;
        const adaptiveRouting = compileFlowToAdaptiveRouting(rawFlow, { previousRouting });

        const nextSequence = Math.max(
          rawFlow.publicationSequence ?? 0,
          rawFlow.publicationHistory?.length ?? 0,
          FlowPublication ? (await FlowPublication.countDocuments({ flowId })) : 0,
        ) + 1;

        if (!link) {
          const allocation = await allocateCode(normalizedAlias.value, session);
          [link] = await Link.create([{
            originalUrl: adaptiveRouting.defaultDestinationUrl,
            adaptiveRouting,
            shortCode: allocation.shortCode,
            isCustomAlias: allocation.isCustomAlias,
            title: rawFlow.eventName,
            tags: [],
            status: 'active',
            management: { ownerType: 'flow', flowId, publicationNumber: nextSequence },
          }], { session });
        } else {
          link = await Link.findOneAndUpdate(
            { _id: link._id, 'management.ownerType': 'flow', 'management.flowId': flowId },
            { $set: {
              originalUrl: adaptiveRouting.defaultDestinationUrl,
              adaptiveRouting,
              title: rawFlow.eventName,
              status: 'active',
              'management.publicationNumber': nextSequence,
            } },
            { new: true, runValidators: true, session },
          );
          if (!link) throw httpError('The linked URL is not owned by this Flow.', 409, 'LINK_OWNERSHIP_MISMATCH');
        }

        const publishedAt = currentTime;
        const snapshot = publicationSnapshot(rawFlow, adaptiveRouting, {
          publicationNumber: nextSequence,
          operation: 'publish',
        });
        const expiresAt = new Date(publishedAt.getTime() + IDEMPOTENCY_RETENTION_MS);
        const requestRecord = {
          key,
          payloadHash,
          operation: 'publish',
          revision: expectedRevision,
          publicationNumber: nextSequence,
          linkId: link._id,
          shortCode: link.shortCode,
          publishedAt,
          expiresAt,
        };

        if (FlowPublication) {
          await FlowPublication.create([{
            flowId,
            publicationNumber: nextSequence,
            revision: expectedRevision,
            operation: 'publish',
            restoredFrom: null,
            publishedAt,
            configuration: snapshot,
          }], { session });
        }

        const publishFilter = {
          _id: flow._id,
          revision: expectedRevision,
          publicationRequests: { $not: { $elemMatch: { key, expiresAt: { $gt: currentTime } } } },
        };
        if (expectedOpVersion !== undefined) {
          publishFilter.operationVersion = expectedOpVersion;
        }

        const updatedFlow = await Flow.findOneAndUpdate(
          publishFilter,
          {
            $set: {
              linkId: link._id,
              publishedRevision: expectedRevision,
              publicationSequence: nextSequence,
              publishedConfiguration: snapshot,
              publishedAt,
              lifecycleStatus: 'active',
              publicationRequests: [...activeRequests, requestRecord],
            },
            $inc: { operationVersion: 1 },
            $push: {
              publicationHistory: {
                $each: [{
                  publicationNumber: nextSequence,
                  revision: expectedRevision,
                  operation: 'publish',
                  restoredFrom: null,
                  publishedAt,
                  configuration: snapshot,
                }],
                $slice: -20,
              },
            },
          },
          { new: true, runValidators: true, session },
        );
        if (!updatedFlow) throw httpError('The draft changed during publication. Nothing was published.', 409, 'STALE_FLOW_REVISION');

        outcome = { flow: updatedFlow, link, publishedAt, idempotent: false };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });

      if (!outcome) throw httpError('Publication transaction did not complete.', 503, 'PUBLICATION_INCOMPLETE');
      return outcome;
    } catch (error) {
      if (error?.code === 11000 && normalizedAlias.value) {
        throw new AliasConflictError(normalizedAlias.value, await aliasService.suggestAliases(normalizedAlias.value));
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async function rollback(flowId, { targetPublicationNumber, syncDraft = false, confirmDraftDiscard = false, discardDraft = false, expectedOperationVersion }, idempotencyKey) {
    const shouldConfirmDiscard = Boolean(confirmDraftDiscard || discardDraft);
    const targetNumber = Number.parseInt(targetPublicationNumber, 10);
    if (!Number.isInteger(targetNumber) || targetNumber < 1) {
      throw httpError('A valid target publication number is required for rollback.', 400, 'INVALID_PUBLICATION_NUMBER');
    }
    const key = normalizeKey(idempotencyKey);
    const payloadHash = rollbackHash(flowId, targetNumber, syncDraft, shouldConfirmDiscard);
    const expectedOpVersion = expectedOperationVersion !== undefined ? Number(expectedOperationVersion) : undefined;

    if (!Flow.db?.startSession) throw httpError('Atomic rollback requires MongoDB transaction support.', 503, 'TRANSACTIONS_REQUIRED');
    const session = await Flow.db.startSession();
    let outcome;
    try {
      await session.withTransaction(async () => {
        const flow = await withSession(Flow.findOne({ flowId }), session);
        if (!flow) throw httpError('Flow not found.', 404, 'FLOW_NOT_FOUND');
        const rawFlow = normalizeFlowDoc(flow);
        const currentTime = now();

        if (expectedOpVersion !== undefined && rawFlow.operationVersion !== expectedOpVersion) {
          throw httpError('The flow was modified concurrently. Please reload and retry.', 409, 'OPERATION_CONFLICT');
        }

        if (rawFlow.lifecycleStatus === 'archived') {
          throw httpError('This Flow is archived and cannot be rolled back. Restore the Flow before rolling back.', 409, 'FLOW_ARCHIVED');
        }

        const previousRequest = (rawFlow.publicationRequests ?? []).find(
          (request) => request.key === key && (!request.expiresAt || new Date(request.expiresAt) > currentTime),
        );
        if (previousRequest) {
          if (previousRequest.payloadHash !== payloadHash) {
            throw httpError('This idempotency key was already used with a different rollback request.', 409, 'IDEMPOTENCY_CONFLICT');
          }
          const link = await linkById(previousRequest.linkId, session);
          if (!link) throw httpError('The prior publication link is unavailable.', 409, 'PUBLICATION_INCONSISTENT');
          outcome = { flow, link, publishedAt: previousRequest.publishedAt, idempotent: true, restoredFrom: targetNumber };
          return;
        }

        const activeRequests = (rawFlow.publicationRequests ?? []).filter(
          (r) => !r.expiresAt || new Date(r.expiresAt) > currentTime,
        );

        let targetEntry = FlowPublication ? await withSession(FlowPublication.findOne({ flowId, publicationNumber: targetNumber }), session) : null;
        if (!targetEntry) {
          targetEntry = (rawFlow.publicationHistory ?? []).find(
            (item, idx) => (item.publicationNumber ?? item.configuration?.publicationNumber ?? (idx + 1)) === targetNumber,
          );
        }
        if (!targetEntry) {
          throw httpError(`Publication #${targetNumber} does not exist in history.`, 404, 'HISTORICAL_CONFIGURATION_NOT_FOUND');
        }
        const targetSnapshot = normalizePublicationSnapshot(targetEntry.configuration ?? targetEntry, { publicationNumber: targetNumber, flow: rawFlow });

        // Revalidate historical routing destinations
        const routing = targetSnapshot.adaptiveRouting;
        if (!routing || !routing.defaultDestinationUrl) {
          throw httpError('The historical configuration has invalid routing data.', 400, 'INVALID_HISTORICAL_CONFIGURATION');
        }
        const defaultCheck = normalizeAndValidateUrl(routing.defaultDestinationUrl);
        if (defaultCheck.error) {
          throw httpError(`Historical default destination is invalid: ${defaultCheck.error}`, 400, 'INVALID_HISTORICAL_CONFIGURATION');
        }
        for (const rule of routing.rules ?? []) {
          const check = normalizeAndValidateUrl(rule.destinationUrl);
          if (check.error) throw httpError(`Historical rule ${rule.ruleId} destination is invalid: ${check.error}`, 400, 'INVALID_HISTORICAL_CONFIGURATION');
        }

        // Draft synchronization safety check
        const hasUnpublishedDraftChanges = rawFlow.revision !== rawFlow.publishedRevision;
        if (syncDraft && hasUnpublishedDraftChanges && !shouldConfirmDiscard) {
          throw httpError(
            'The current draft contains unpublished changes. Confirm discarding them, or perform rollback without draft synchronization.',
            409,
            'UNSAVED_DRAFT_CONFLICT',
          );
        }

        let link = rawFlow.linkId ? await linkById(rawFlow.linkId, session) : null;
        if (!link) throw httpError('The Flow-managed link is unavailable.', 409, 'PUBLICATION_INCONSISTENT');

        const nextSequence = Math.max(
          rawFlow.publicationSequence ?? 0,
          rawFlow.publicationHistory?.length ?? 0,
          FlowPublication ? (await FlowPublication.countDocuments({ flowId })) : 0,
        ) + 1;

        // Update link routing to match historical configuration
        link = await Link.findOneAndUpdate(
          { _id: link._id, 'management.ownerType': 'flow', 'management.flowId': flowId },
          { $set: {
            originalUrl: routing.defaultDestinationUrl,
            adaptiveRouting: routing,
            title: rawFlow.eventName,
            status: 'active',
            'management.publicationNumber': nextSequence,
          } },
          { new: true, runValidators: true, session },
        );
        if (!link) throw httpError('The linked URL is not owned by this Flow.', 409, 'LINK_OWNERSHIP_MISMATCH');

        const rollbackPublishedAt = currentTime;
        const newSnapshot = {
          ...targetSnapshot,
          publicationNumber: nextSequence,
          operation: 'rollback',
          restoredFrom: targetNumber,
          publishedAt: rollbackPublishedAt,
        };

        const expiresAt = new Date(rollbackPublishedAt.getTime() + IDEMPOTENCY_RETENTION_MS);
        const requestRecord = {
          key,
          payloadHash,
          operation: 'rollback',
          revision: rawFlow.publishedRevision ?? targetEntry.revision,
          publicationNumber: nextSequence,
          linkId: link._id,
          shortCode: link.shortCode,
          publishedAt: rollbackPublishedAt,
          expiresAt,
        };

        if (FlowPublication) {
          await FlowPublication.create([{
            flowId,
            publicationNumber: nextSequence,
            revision: rawFlow.publishedRevision ?? targetEntry.revision,
            operation: 'rollback',
            restoredFrom: targetNumber,
            publishedAt: rollbackPublishedAt,
            configuration: newSnapshot,
          }], { session });
        }

        const updateOps = {
          $set: {
            publicationSequence: nextSequence,
            publishedConfiguration: newSnapshot,
            publishedAt: rollbackPublishedAt,
            lifecycleStatus: 'active',
            publicationRequests: [...activeRequests, requestRecord],
          },
          $inc: { operationVersion: 1 },
          $push: {
            publicationHistory: {
              $each: [{
                publicationNumber: nextSequence,
                revision: rawFlow.publishedRevision ?? targetEntry.revision,
                operation: 'rollback',
                restoredFrom: targetNumber,
                publishedAt: rollbackPublishedAt,
                configuration: newSnapshot,
              }],
              $slice: -20,
            },
          },
        };

        if (syncDraft) {
          const syncedDraft = syncDraftFromSnapshot(rawFlow, targetSnapshot);
          updateOps.$set.draft = syncedDraft;
          updateOps.$set.publishedRevision = rawFlow.revision + 1;
          updateOps.$inc.revision = 1;
        }

        const rollbackFilter = {
          _id: flow._id,
          publicationRequests: { $not: { $elemMatch: { key, expiresAt: { $gt: currentTime } } } },
        };
        if (expectedOpVersion !== undefined) {
          rollbackFilter.operationVersion = expectedOpVersion;
        }

        const updatedFlow = await Flow.findOneAndUpdate(
          rollbackFilter,
          updateOps,
          { new: true, runValidators: true, session },
        );
        if (!updatedFlow) throw httpError('The flow changed concurrently during rollback. Please reload and retry.', 409, 'OPERATION_CONFLICT');

        outcome = { flow: updatedFlow, link, publishedAt: rollbackPublishedAt, idempotent: false, restoredFrom: targetNumber };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });

      if (!outcome) throw httpError('Rollback transaction did not complete.', 503, 'ROLLBACK_INCOMPLETE');
      return outcome;
    } finally {
      await session.endSession();
    }
  }

  async function archive(flowId, idempotencyKey, { expectedOperationVersion } = {}) {
    const key = normalizeKey(idempotencyKey);
    const payloadHash = lifecycleHash(flowId, 'archive');
    const expectedOpVersion = expectedOperationVersion !== undefined ? Number(expectedOperationVersion) : undefined;

    if (!Flow.db?.startSession) throw httpError('Atomic lifecycle operations require MongoDB transactions.', 503, 'TRANSACTIONS_REQUIRED');
    const session = await Flow.db.startSession();
    let outcome;
    try {
      await session.withTransaction(async () => {
        const flow = await withSession(Flow.findOne({ flowId }), session);
        if (!flow) throw httpError('Flow not found.', 404, 'FLOW_NOT_FOUND');
        const rawFlow = normalizeFlowDoc(flow);
        const currentTime = now();

        if (expectedOpVersion !== undefined && rawFlow.operationVersion !== expectedOpVersion) {
          throw httpError('The flow was modified concurrently. Please reload and retry.', 409, 'OPERATION_CONFLICT');
        }

        const previousRequest = (rawFlow.publicationRequests ?? []).find(
          (request) => request.key === key && (!request.expiresAt || new Date(request.expiresAt) > currentTime),
        );
        if (previousRequest) {
          if (previousRequest.payloadHash !== payloadHash) {
            throw httpError('This idempotency key was already used with a different lifecycle request.', 409, 'IDEMPOTENCY_CONFLICT');
          }
          const link = rawFlow.linkId ? await linkById(rawFlow.linkId, session) : null;
          outcome = { flow, link, status: 'archived', idempotent: true };
          return;
        }

        const activeRequests = (rawFlow.publicationRequests ?? []).filter(
          (r) => !r.expiresAt || new Date(r.expiresAt) > currentTime,
        );

        if (rawFlow.lifecycleStatus === 'archived') {
          throw httpError('This Flow is already archived.', 409, 'FLOW_ALREADY_ARCHIVED');
        }

        let link = null;
        if (rawFlow.linkId) {
          link = await Link.findOneAndUpdate(
            { _id: rawFlow.linkId, 'management.ownerType': 'flow', 'management.flowId': flowId },
            { $set: { status: 'archived' } },
            { new: true, runValidators: true, session },
          );
        }

        const expiresAt = new Date(currentTime.getTime() + IDEMPOTENCY_RETENTION_MS);
        const requestRecord = {
          key,
          payloadHash,
          operation: 'archive',
          revision: rawFlow.revision,
          publicationNumber: rawFlow.publicationSequence ?? 0,
          linkId: rawFlow.linkId ?? flow._id,
          shortCode: link?.shortCode ?? '',
          publishedAt: currentTime,
          expiresAt,
        };

        const archiveFilter = {
          _id: flow._id,
          publicationRequests: { $not: { $elemMatch: { key, expiresAt: { $gt: currentTime } } } },
        };
        if (expectedOpVersion !== undefined) {
          archiveFilter.operationVersion = expectedOpVersion;
        }

        const updatedFlow = await Flow.findOneAndUpdate(
          archiveFilter,
          {
            $set: {
              lifecycleStatus: 'archived',
              lifecycleChangedAt: currentTime,
              publicationRequests: [...activeRequests, requestRecord],
            },
            $inc: { operationVersion: 1 },
          },
          { new: true, runValidators: true, session },
        );
        if (!updatedFlow) throw httpError('The flow changed concurrently during archive. Please retry.', 409, 'OPERATION_CONFLICT');

        outcome = { flow: updatedFlow, link, status: 'archived', idempotent: false };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });

      if (!outcome) throw httpError('Archive transaction did not complete.', 503, 'ARCHIVE_INCOMPLETE');
      return outcome;
    } finally {
      await session.endSession();
    }
  }

  async function restore(flowId, idempotencyKey, { expectedOperationVersion } = {}) {
    const key = normalizeKey(idempotencyKey);
    const payloadHash = lifecycleHash(flowId, 'restore');
    const expectedOpVersion = expectedOperationVersion !== undefined ? Number(expectedOperationVersion) : undefined;

    if (!Flow.db?.startSession) throw httpError('Atomic lifecycle operations require MongoDB transactions.', 503, 'TRANSACTIONS_REQUIRED');
    const session = await Flow.db.startSession();
    let outcome;
    try {
      await session.withTransaction(async () => {
        const flow = await withSession(Flow.findOne({ flowId }), session);
        if (!flow) throw httpError('Flow not found.', 404, 'FLOW_NOT_FOUND');
        const rawFlow = normalizeFlowDoc(flow);
        const currentTime = now();

        if (expectedOpVersion !== undefined && rawFlow.operationVersion !== expectedOpVersion) {
          throw httpError('The flow was modified concurrently. Please reload and retry.', 409, 'OPERATION_CONFLICT');
        }

        const previousRequest = (rawFlow.publicationRequests ?? []).find(
          (request) => request.key === key && (!request.expiresAt || new Date(request.expiresAt) > currentTime),
        );
        if (previousRequest) {
          if (previousRequest.payloadHash !== payloadHash) {
            throw httpError('This idempotency key was already used with a different lifecycle request.', 409, 'IDEMPOTENCY_CONFLICT');
          }
          const link = rawFlow.linkId ? await linkById(rawFlow.linkId, session) : null;
          outcome = { flow, link, status: 'active', idempotent: true };
          return;
        }

        const activeRequests = (rawFlow.publicationRequests ?? []).filter(
          (r) => !r.expiresAt || new Date(r.expiresAt) > currentTime,
        );

        if (rawFlow.lifecycleStatus !== 'archived') {
          throw httpError('This Flow is not archived.', 409, 'FLOW_ALREADY_ACTIVE');
        }

        let link = null;
        if (rawFlow.linkId) {
          link = await Link.findOneAndUpdate(
            { _id: rawFlow.linkId, 'management.ownerType': 'flow', 'management.flowId': flowId },
            { $set: { status: 'active' } },
            { new: true, runValidators: true, session },
          );
        }

        const expiresAt = new Date(currentTime.getTime() + IDEMPOTENCY_RETENTION_MS);
        const requestRecord = {
          key,
          payloadHash,
          operation: 'restore',
          revision: rawFlow.revision,
          publicationNumber: rawFlow.publicationSequence ?? 0,
          linkId: rawFlow.linkId ?? flow._id,
          shortCode: link?.shortCode ?? '',
          publishedAt: currentTime,
          expiresAt,
        };

        const restoreFilter = {
          _id: flow._id,
          publicationRequests: { $not: { $elemMatch: { key, expiresAt: { $gt: currentTime } } } },
        };
        if (expectedOpVersion !== undefined) {
          restoreFilter.operationVersion = expectedOpVersion;
        }

        const updatedFlow = await Flow.findOneAndUpdate(
          restoreFilter,
          {
            $set: {
              lifecycleStatus: 'active',
              lifecycleChangedAt: currentTime,
              publicationRequests: [...activeRequests, requestRecord],
            },
            $inc: { operationVersion: 1 },
          },
          { new: true, runValidators: true, session },
        );
        if (!updatedFlow) throw httpError('The flow changed concurrently during restore. Please retry.', 409, 'OPERATION_CONFLICT');

        outcome = { flow: updatedFlow, link, status: 'active', idempotent: false };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });

      if (!outcome) throw httpError('Restore transaction did not complete.', 503, 'RESTORE_INCOMPLETE');
      return outcome;
    } finally {
      await session.endSession();
    }
  }

  async function pruneExpiredRequests(flowId, { olderThan = now() } = {}) {
    const threshold = new Date(olderThan);
    const result = await Flow.updateOne(
      { flowId },
      { $pull: { publicationRequests: { expiresAt: { $lte: threshold } } } },
    );
    return { pruned: result.modifiedCount > 0 };
  }

  async function active(flowId, instant = new Date()) {
    const flow = await Flow.findOne({ flowId });
    if (!flow) return null;
    if (!flow.linkId) return { flow, link: null, resolution: null };
    const link = await Link.findById(flow.linkId);
    if (!link) return { flow, link: null, resolution: null };
    return { flow, link, resolution: resolveAdaptiveDestination(link, { now: instant }) };
  }

  return { publish, rollback, archive, restore, pruneExpiredRequests, active };
}
