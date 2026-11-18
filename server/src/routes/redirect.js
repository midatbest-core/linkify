import { Router } from 'express';
import Link from '../models/Link.js';

export function createRedirectRouter({ linkModel = Link } = {}) {
  const router = Router();

  router.get('/:code', async (request, response, next) => {
    try {
      const link = await linkModel.findOne({ shortCode: request.params.code });
      if (!link) return response.status(404).type('text').send('Short link not found.');
      return response.redirect(302, link.originalUrl);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createRedirectRouter;
