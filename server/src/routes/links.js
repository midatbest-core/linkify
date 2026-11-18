import { Router } from 'express';
import Link from '../models/Link.js';
import { createLinkService, AliasConflictError } from '../services/linkService.js';
import mongoose from 'mongoose';

function serializeLink(link, baseUrl) {
  const isCustomAlias = link.isCustomAlias ?? !/^[0-9a-zA-Z]{7}$/.test(link.shortCode);
  return {
    id: link.id ?? link._id?.toString(), originalUrl: link.originalUrl,
    shortCode: link.shortCode, shortUrl: `${baseUrl}/${link.shortCode}`,
    isCustomAlias, createdAt: link.createdAt,
  };
}

export function createLinksRouter({ linkModel = Link, linkService = createLinkService(linkModel) } = {}) {
  const router = Router();

  router.get('/', async (request, response, next) => {
    try {
      const links = await linkModel.find({}).sort({ createdAt: -1 });
      const baseUrl = (process.env.SHORT_BASE_URL ?? `${request.protocol}://${request.get('host')}`).replace(/\/$/, '');
      response.json({ links: links.map((link) => serializeLink(link, baseUrl)) });
    } catch (error) { next(error); }
  });

  router.get('/:id', async (request, response, next) => {
    if (!mongoose.isValidObjectId(request.params.id)) return response.status(400).json({ error: 'Invalid link ID.' });
    try {
      const link = await linkModel.findById(request.params.id);
      if (!link) return response.status(404).json({ error: 'Link not found.' });
      const baseUrl = (process.env.SHORT_BASE_URL ?? `${request.protocol}://${request.get('host')}`).replace(/\/$/, '');
      response.json({ link: serializeLink(link, baseUrl) });
    } catch (error) { next(error); }
  });

  router.delete('/:id', async (request, response, next) => {
    if (!mongoose.isValidObjectId(request.params.id)) return response.status(400).json({ error: 'Invalid link ID.' });
    try {
      const deleted = await linkModel.findByIdAndDelete(request.params.id);
      if (!deleted) return response.status(404).json({ error: 'Link not found.' });
      response.json({ message: 'Link deleted.', id: request.params.id });
    } catch (error) { next(error); }
  });

  router.post('/', async (request, response, next) => {
    try {
      const link = await linkService.create(request.body ?? {});
      const baseUrl = (process.env.SHORT_BASE_URL ?? `${request.protocol}://${request.get('host')}`).replace(/\/$/, '');
      response.status(201).json({
        id: link.id ?? link._id?.toString(),
        originalUrl: link.originalUrl,
        shortCode: link.shortCode,
        shortUrl: `${baseUrl}/${link.shortCode}`,
        isCustomAlias: link.isCustomAlias ?? Boolean(request.body?.customAlias),
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
