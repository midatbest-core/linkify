import { createHash } from 'node:crypto';
import { normalizeAndValidateAlias } from '../utils/validation.js';
import { AliasConflictError, createLinkService, generateShortCode } from './linkService.js';
import { compileFlowToAdaptiveRouting } from './flowCompiler.js';
import { resolveAdaptiveDestination } from './adaptiveRoutingService.js';

function httpError(message, status, code) { return Object.assign(new Error(message), { status, code }); }
function plain(value) { return value?.toObject?.() ?? value; }
function withSession(query, session) { return typeof query?.session === 'function' ? query.session(session) : query; }
function publicationHash(flowId, revision, customAlias) { return createHash('sha256').update(JSON.stringify({ flowId, revision, customAlias: customAlias ?? null })).digest('hex'); }
function normalizeKey(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw httpError('Idempotency-Key must be 8–128 letters, numbers, dots, underscores, colons, or hyphens.', 400, 'INVALID_IDEMPOTENCY_KEY'); return value; }

export function createFlowPublishingService({ Flow, Link, codeGenerator = generateShortCode, now = () => new Date() }) {
  const aliasService = createLinkService(Link, { codeGenerator });
  async function linkById(id, session) { return withSession(Link.findById(id), session); }
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
  async function publish(flowId, { expectedRevision, customAlias }, idempotencyKey) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw httpError('A valid expected draft revision is required.', 400, 'INVALID_REVISION');
    const key = normalizeKey(idempotencyKey); const normalizedAlias = customAlias ? normalizeAndValidateAlias(customAlias) : { value: null };
    if (normalizedAlias.error) throw httpError(normalizedAlias.error, 400, 'INVALID_ALIAS');
    const payloadHash = publicationHash(flowId, expectedRevision, normalizedAlias.value);
    if (!Flow.db?.startSession) throw httpError('Atomic publishing requires MongoDB transaction support.', 503, 'TRANSACTIONS_REQUIRED');
    const session = await Flow.db.startSession(); let outcome;
    try {
      await session.withTransaction(async () => {
        const flow = await withSession(Flow.findOne({ flowId }), session);
        if (!flow) throw httpError('Flow not found.', 404, 'FLOW_NOT_FOUND');
        const rawFlow = plain(flow); const previousRequest = (rawFlow.publicationRequests ?? []).find((request) => request.key === key);
        if (previousRequest) {
          if (previousRequest.payloadHash !== payloadHash) throw httpError('This idempotency key was already used with a different publication request.', 409, 'IDEMPOTENCY_CONFLICT');
          const link = await linkById(previousRequest.linkId, session);
          if (!link) throw httpError('The prior publication link is unavailable.', 409, 'PUBLICATION_INCONSISTENT');
          outcome = { flow, link, publishedAt: previousRequest.publishedAt, idempotent: true };
          return;
        }
        if (rawFlow.revision !== expectedRevision) throw httpError('The draft changed before publication. Reload and publish the latest saved revision.', 409, 'STALE_FLOW_REVISION');
        let link = rawFlow.linkId ? await linkById(rawFlow.linkId, session) : null;
        if (rawFlow.linkId && !link) throw httpError('The Flow-managed link is unavailable.', 409, 'PUBLICATION_INCONSISTENT');
        if (link && normalizedAlias.value && normalizedAlias.value !== link.shortCode) throw httpError('The permanent alias cannot change after first publication.', 409, 'ALIAS_IMMUTABLE');
        const previousRouting = link ? plain(link.adaptiveRouting) : undefined;
        const adaptiveRouting = compileFlowToAdaptiveRouting(rawFlow, { previousRouting });
        if (!link) {
          const allocation = await allocateCode(normalizedAlias.value, session);
          [link] = await Link.create([{ originalUrl: adaptiveRouting.defaultDestinationUrl, adaptiveRouting, shortCode: allocation.shortCode, isCustomAlias: allocation.isCustomAlias, title: rawFlow.eventName, tags: [], status: 'active', management: { ownerType: 'flow', flowId } }], { session });
        } else {
          link = await Link.findOneAndUpdate({ _id: link._id, 'management.ownerType': 'flow', 'management.flowId': flowId }, { $set: { originalUrl: adaptiveRouting.defaultDestinationUrl, adaptiveRouting, title: rawFlow.eventName } }, { new: true, runValidators: true, session });
          if (!link) throw httpError('The linked URL is not owned by this Flow.', 409, 'LINK_OWNERSHIP_MISMATCH');
        }
        const publishedAt = now();
        const snapshot = { schemaVersion: 1, flowId, revision: expectedRevision, creatorTimeZone: rawFlow.creatorTimeZone, eventStartAtUtc: rawFlow.eventStartAtUtc, eventEndAtUtc: rawFlow.eventEndAtUtc, adaptiveRouting: plain(adaptiveRouting) };
        const requestRecord = { key, payloadHash, revision: expectedRevision, linkId: link._id, shortCode: link.shortCode, publishedAt };
        const updatedFlow = await Flow.findOneAndUpdate({ _id: flow._id, revision: expectedRevision, 'publicationRequests.key': { $ne: key } }, { $set: { linkId: link._id, publishedRevision: expectedRevision, publishedConfiguration: snapshot, publishedAt }, $push: { publicationHistory: { revision: expectedRevision, publishedAt, configuration: snapshot }, publicationRequests: requestRecord } }, { new: true, runValidators: true, session });
        if (!updatedFlow) throw httpError('The draft changed during publication. Nothing was published.', 409, 'STALE_FLOW_REVISION');
        outcome = { flow: updatedFlow, link, publishedAt, idempotent: false };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      if (!outcome) throw httpError('Publication transaction did not complete.', 503, 'PUBLICATION_INCOMPLETE');
      return outcome;
    } catch (error) {
      if (error?.code === 11000 && normalizedAlias.value) throw new AliasConflictError(normalizedAlias.value, await aliasService.suggestAliases(normalizedAlias.value));
      throw error;
    } finally { await session.endSession(); }
  }
  async function active(flowId, instant = new Date()) {
    const flow = await Flow.findOne({ flowId }); if (!flow) return null;
    if (!flow.linkId) return { flow, link: null, resolution: null };
    const link = await Link.findById(flow.linkId); if (!link) return { flow, link: null, resolution: null };
    return { flow, link, resolution: resolveAdaptiveDestination(link, { now: instant }) };
  }
  return { publish, active };
}

export { publicationHash };
