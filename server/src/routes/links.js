import { Router } from 'express';
import Link from '../models/Link.js';
import { createLinkService, AliasConflictError } from '../services/linkService.js';

export function createLinksRouter({ linkModel = Link, linkService = createLinkService(linkModel) } = {}) {
  const router = Router();

  router.post('/', async (request, response, next) => {
    try {
      const link = await linkService.create(request.body ?? {});
      const baseUrl = (process.env.SHORT_BASE_URL ?? `${request.protocol}://${request.get('host')}`).replace(/\/$/, '');
      response.status(201).json({
        id: link.id ?? link._id?.toString(),
        originalUrl: link.originalUrl,
        shortCode: link.shortCode,
        shortUrl: `${baseUrl}/${link.shortCode}`,
        createdAt: link.createdAt,
      });
    } catch (error) {
      if (error instanceof AliasConflictError) {
        response.status(409).json({ error: error.message, alias: error.alias, suggestions: error.suggestions });
      } else if (error.status === 400 || error.status === 503) {
        response.status(error.status).json({ error: error.message });
      } else next(error);
    }
  });

  return router;
}

export default createLinksRouter;
