import { Router } from 'express';
import { createFlowService, serializeFlow } from '../services/flowService.js';

export function createFlowsRouter({ flowModel }) {
  const router = Router(); const service = createFlowService(flowModel);
  router.post('/', async (request, response, next) => { try { const result = await service.create(request.body); response.status(201).json({ flow: serializeFlow(result.flow), validation: result.validation }); } catch (error) { if (error.status) response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) }); else next(error); } });
  router.get('/', async (_request, response, next) => { try { response.json({ flows: await service.list() }); } catch (error) { next(error); } });
  router.get('/:id', async (request, response, next) => { try { const flow = await service.get(request.params.id); if (!flow) return response.status(404).json({ error: 'Flow not found.' }); response.json({ flow: serializeFlow(flow), validation: await service.validate({}, flow.toObject?.() ?? flow) }); } catch (error) { next(error); } });
  router.patch('/:id', async (request, response, next) => { try { const result = await service.update(request.params.id, request.body); if (!result) return response.status(404).json({ error: 'Flow not found.' }); response.json({ flow: serializeFlow(result.flow), validation: result.validation }); } catch (error) { if (error.status) response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) }); else next(error); } });
  router.post('/:id/validate', async (request, response, next) => { try { const existing = await service.get(request.params.id); if (!existing) return response.status(404).json({ error: 'Flow not found.' }); response.json({ validation: await service.validate(request.body, existing.toObject?.() ?? existing) }); } catch (error) { if (error.status) response.status(error.status).json({ error: error.message }); else next(error); } });
  router.delete('/:id', async (request, response, next) => { try { const removed = await service.remove(request.params.id); if (!removed) return response.status(404).json({ error: 'Flow not found.' }); response.json({ message: 'Flow draft deleted.', id: request.params.id }); } catch (error) { if (error.status) response.status(error.status).json({ error: error.message }); else next(error); } });
  return router;
}
