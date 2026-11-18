import { Router } from 'express';
import Link from '../models/Link.js';
import { createLinkService } from '../services/linkService.js';

export function createAliasesRouter({ linkModel = Link, linkService = createLinkService(linkModel) } = {}) {
  const router = Router();

  router.get('/:alias/availability', async (request, response, next) => {
    try {
      response.json(await linkService.checkAlias(request.params.alias));
    } catch (error) {
      if (error.status === 400) response.status(400).json({ error: error.message });
      else next(error);
    }
  });

  return router;
}

export default createAliasesRouter;
