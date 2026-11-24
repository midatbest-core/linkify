import { Router } from 'express';
import { createFlowService, serializeFlow } from '../services/flowService.js';
import { createFlowPublishingService } from '../services/flowPublishingService.js';
import { createFlowIntelligenceService } from '../services/flowIntelligenceService.js';
import { AliasConflictError } from '../services/linkService.js';

function baseUrl(request) {
  return (process.env.SHORT_BASE_URL ?? `${request.protocol}://${request.get('host')}`).replace(/\/$/, '');
}

function publication(link, flow, request) {
  return link ? {
    linkId: link.id ?? link._id?.toString(),
    shortCode: link.shortCode,
    shortUrl: `${baseUrl(request)}/${link.shortCode}`,
    isCustomAlias: link.isCustomAlias === true,
    publishedRevision: flow.publishedRevision,
    publicationSequence: flow.publicationSequence ?? 0,
    publishedAt: flow.publishedAt,
    lifecycleStatus: flow.lifecycleStatus ?? 'active',
  } : null;
}

export function createFlowsRouter({ flowModel, linkModel, clickEventModel, flowPublicationModel }) {
  const router = Router();
  const service = createFlowService(flowModel);
  const publishing = createFlowPublishingService({ Flow: flowModel, Link: linkModel, FlowPublication: flowPublicationModel });
  const intelligence = createFlowIntelligenceService({ Flow: flowModel, Link: linkModel, ClickEvent: clickEventModel, FlowPublication: flowPublicationModel });

  router.post('/', async (request, response, next) => {
    try {
      const result = await service.create(request.body);
      response.status(201).json({ flow: serializeFlow(result.flow), validation: result.validation });
    } catch (error) {
      if (error.status) response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      else next(error);
    }
  });

  router.get('/', async (_request, response, next) => {
    try {
      response.json({ flows: await service.list() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (request, response, next) => {
    try {
      const flow = await service.get(request.params.id);
      if (!flow) return response.status(404).json({ error: 'Flow not found.' });
      const link = flow.linkId ? await linkModel.findById(flow.linkId) : null;
      response.json({
        flow: serializeFlow(flow),
        validation: await service.validate({}, flow.toObject?.() ?? flow),
        publication: publication(link, flow, request),
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id', async (request, response, next) => {
    try {
      const result = await service.update(request.params.id, request.body);
      if (!result) return response.status(404).json({ error: 'Flow not found.' });
      response.json({ flow: serializeFlow(result.flow), validation: result.validation });
    } catch (error) {
      if (error.status) response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      else next(error);
    }
  });

  router.post('/:id/validate', async (request, response, next) => {
    try {
      const existing = await service.get(request.params.id);
      if (!existing) return response.status(404).json({ error: 'Flow not found.' });
      response.json({ validation: await service.validate(request.body, existing.toObject?.() ?? existing) });
    } catch (error) {
      if (error.status) response.status(error.status).json({ error: error.message });
      else next(error);
    }
  });

  router.post('/:id/publish', async (request, response, next) => {
    try {
      const result = await publishing.publish(request.params.id, request.body ?? {}, request.get('Idempotency-Key'));
      response.status(result.idempotent ? 200 : 201).json({
        flow: serializeFlow(result.flow),
        publication: publication(result.link, result.flow, request),
        idempotent: result.idempotent,
      });
    } catch (error) {
      if (error instanceof AliasConflictError) {
        return response.status(409).json({ error: error.message, code: 'ALIAS_CONFLICT', alias: error.alias, suggestions: error.suggestions });
      }
      if (error.status) return response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      next(error);
    }
  });

  router.post('/:id/rollback', async (request, response, next) => {
    try {
      const result = await publishing.rollback(request.params.id, request.body ?? {}, request.get('Idempotency-Key'));
      response.status(result.idempotent ? 200 : 201).json({
        flow: serializeFlow(result.flow),
        publication: publication(result.link, result.flow, request),
        idempotent: result.idempotent,
        restoredFrom: result.restoredFrom,
      });
    } catch (error) {
      if (error.status) return response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      next(error);
    }
  });

  router.post('/:id/archive', async (request, response, next) => {
    try {
      const result = await publishing.archive(request.params.id, request.get('Idempotency-Key'), { expectedOperationVersion: request.body?.expectedOperationVersion });
      response.json({
        flow: serializeFlow(result.flow),
        publication: publication(result.link, result.flow, request),
        status: 'archived',
        idempotent: result.idempotent,
      });
    } catch (error) {
      if (error.status) return response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      next(error);
    }
  });

  router.post('/:id/restore', async (request, response, next) => {
    try {
      const result = await publishing.restore(request.params.id, request.get('Idempotency-Key'), { expectedOperationVersion: request.body?.expectedOperationVersion });
      response.json({
        flow: serializeFlow(result.flow),
        publication: publication(result.link, result.flow, request),
        status: 'active',
        idempotent: result.idempotent,
      });
    } catch (error) {
      if (error.status) return response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      next(error);
    }
  });

  router.post('/:id/prune-requests', async (request, response, next) => {
    try {
      const result = await publishing.pruneExpiredRequests(request.params.id);
      response.json(result);
    } catch (error) {
      if (error.status) return response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      next(error);
    }
  });

  router.get('/:id/active-destination', async (request, response, next) => {
    try {
      const instant = request.query.at === undefined ? new Date() : new Date(request.query.at);
      if (!Number.isFinite(instant.getTime())) return response.status(400).json({ error: 'at must be a valid instant.' });
      const result = await publishing.active(request.params.id, instant);
      if (!result) return response.status(404).json({ error: 'Flow not found.' });
      if (!result.link || !result.resolution) return response.json({ activeDestination: null, note: 'This Flow is not published.' });
      response.json({ activeDestination: { ...result.resolution, evaluatedAt: instant.toISOString() }, note: 'Server-authoritative preview only. No click was recorded.' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/simulate', async (request, response, next) => {
    try {
      const result = await intelligence.simulate(request.params.id, request.body ?? {});
      response.json(result);
    } catch (error) {
      if (error.status) return response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      next(error);
    }
  });

  router.get('/:id/analytics', async (request, response, next) => {
    try {
      const result = await intelligence.analytics(request.params.id, request.query ?? {});
      response.json(result);
    } catch (error) {
      if (error.status) return response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      next(error);
    }
  });

  router.get('/:id/history', async (request, response, next) => {
    try {
      const result = await intelligence.history(request.params.id, request.query ?? {});
      response.json(result);
    } catch (error) {
      if (error.status) return response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      next(error);
    }
  });

  router.get('/:id/history/diff', async (request, response, next) => {
    try {
      const { from, to } = request.query;
      if (!from || !to) return response.status(400).json({ error: 'Both from and to publication numbers are required for comparison.' });
      const result = await intelligence.diff(request.params.id, from, to);
      response.json(result);
    } catch (error) {
      if (error.status) return response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      next(error);
    }
  });

  router.delete('/:id', async (request, response, next) => {
    try {
      const removed = await service.remove(request.params.id);
      if (!removed) return response.status(404).json({ error: 'Flow not found.' });
      response.json({ message: 'Flow draft deleted.', id: request.params.id });
    } catch (error) {
      if (error.status) response.status(error.status).json({ error: error.message });
      else next(error);
    }
  });

  return router;
}
