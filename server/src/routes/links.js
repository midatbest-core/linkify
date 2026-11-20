import { Router } from 'express';
import Link from '../models/Link.js';
import { createLinkService, AliasConflictError } from '../services/linkService.js';
import mongoose from 'mongoose';
import ClickEvent from '../models/ClickEvent.js';

function serializeLink(link, baseUrl) {
  const isCustomAlias = link.isCustomAlias ?? !/^[0-9a-zA-Z]{7}$/.test(link.shortCode);
  const adaptiveRouting = link.adaptiveRouting?.toObject?.() ?? link.adaptiveRouting;
  return {
    id: link.id ?? link._id?.toString(), originalUrl: link.originalUrl,
    shortCode: link.shortCode, shortUrl: `${baseUrl}/${link.shortCode}`,
    isCustomAlias, title: link.title ?? '', tags: link.tags ?? [],
    status: link.status ?? 'active', createdAt: link.createdAt, updatedAt: link.updatedAt ?? null,
    adaptiveRouting: adaptiveRouting ? {
      enabled: adaptiveRouting.enabled === true,
      defaultDestinationUrl: adaptiveRouting.defaultDestinationUrl ?? link.originalUrl,
      defaultDestinationId: adaptiveRouting.defaultDestinationId ?? 'default',
      destinations: (adaptiveRouting.destinations ?? []).map(({ destinationId, ownerId, destinationUrl }) => ({ destinationId, ownerId, destinationUrl })),
      rules: (adaptiveRouting.rules ?? []).map((rule, priority) => ({ ruleId: rule.ruleId, priority: rule.priority ?? priority, deviceType: rule.deviceType, destinationUrl: rule.destinationUrl, destinationId: rule.destinationId ?? `rule:${rule.ruleId}`, enabled: rule.enabled !== false })),
    } : { enabled: false, defaultDestinationUrl: link.originalUrl, defaultDestinationId: 'default', destinations: [], rules: [] },
  };
}

export function createLinksRouter({ linkModel = Link, clickEventModel = ClickEvent, linkService = createLinkService(linkModel) } = {}) {
  const router = Router();

  router.get('/', async (request, response, next) => {
    try {
      const { q = '', status = 'all', tag, sort = 'createdAt', order = 'desc' } = request.query;
      if (typeof q !== 'string' || q.length > 100) return response.status(400).json({ error: 'Search must be a string of at most 100 characters.' });
      if (!['all', 'active', 'archived'].includes(status)) return response.status(400).json({ error: 'Status filter must be all, active, or archived.' });
      if (!['createdAt', 'clicks'].includes(sort) || !['asc', 'desc'].includes(order)) return response.status(400).json({ error: 'Unsupported sort option.' });
      const page = request.query.page === undefined ? 1 : Number(request.query.page);
      const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
      if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) return response.status(400).json({ error: 'page must be a positive integer and limit must be between 1 and 100.' });
      if (tag !== undefined && (typeof tag !== 'string' || tag.length > 40)) return response.status(400).json({ error: 'Tag filter must be a string of at most 40 characters.' });
      const filter = {};
      if (status === 'active') filter.$or = [{ status: 'active' }, { status: { $exists: false } }];
      if (status === 'archived') filter.status = status;
      if (tag) filter.tags = tag;
      if (q.trim()) {
        const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const search = { $or: [{ title: { $regex: escaped, $options: 'i' } }, { shortCode: { $regex: escaped, $options: 'i' } }, { originalUrl: { $regex: escaped, $options: 'i' } }] };
        if (filter.$or) filter.$and = [search, { $or: filter.$or }];
        else Object.assign(filter, search);
        if (filter.$and) delete filter.$or;
      }
      let links;
      let total;
      if (sort === 'clicks') {
        const aggregation = linkModel.aggregate([
          { $match: filter },
          { $lookup: { from: clickEventModel.collection?.name ?? 'clickEvents', let: { id: '$_id' }, pipeline: [{ $match: { $expr: { $eq: ['$linkId', '$$id'] } } }, { $count: 'count' }], as: 'clickTotals' } },
          { $addFields: { clickCount: { $ifNull: [{ $arrayElemAt: ['$clickTotals.count', 0] }, 0] } } },
          { $facet: { links: [{ $sort: { clickCount: order === 'asc' ? 1 : -1, createdAt: -1 } }, { $skip: (page - 1) * limit }, { $limit: limit }], metadata: [{ $count: 'total' }] } },
        ]);
        if (typeof aggregation.allowDiskUse === 'function') aggregation.allowDiskUse(true);
        const [result = {}] = await aggregation;
        links = result.links ?? [];
        total = result.metadata?.[0]?.total ?? 0;
      } else {
        const [rows, count] = await Promise.all([
          linkModel.find(filter).sort({ createdAt: order === 'asc' ? 1 : -1 }).skip((page - 1) * limit).limit(limit),
          linkModel.countDocuments(filter),
        ]);
        links = rows;
        total = count;
      }
      const baseUrl = (process.env.SHORT_BASE_URL ?? `${request.protocol}://${request.get('host')}`).replace(/\/$/, '');
      response.json({ links: links.map((link) => ({ ...serializeLink(link, baseUrl), clickCount: link.clickCount ?? 0 })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (error) { next(error); }
  });

  router.get('/:id', async (request, response, next) => {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) return response.status(400).json({ error: 'Invalid link ID.' });
    try {
      const link = await linkModel.findById(request.params.id);
      if (!link) return response.status(404).json({ error: 'Link not found.' });
      const baseUrl = (process.env.SHORT_BASE_URL ?? `${request.protocol}://${request.get('host')}`).replace(/\/$/, '');
      response.json({ link: serializeLink(link, baseUrl) });
    } catch (error) { next(error); }
  });

  router.patch('/:id', async (request, response, next) => {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) return response.status(400).json({ error: 'Invalid link ID.' });
    try {
      const link = await linkService.update(request.params.id, request.body ?? {});
      if (!link) return response.status(404).json({ error: 'Link not found.' });
      const baseUrl = (process.env.SHORT_BASE_URL ?? `${request.protocol}://${request.get('host')}`).replace(/\/$/, '');
      response.json({ link: serializeLink(link, baseUrl) });
    } catch (error) {
      if (error.status === 400 || error.status === 409) return response.status(error.status).json({ error: error.message });
      next(error);
    }
  });

  router.delete('/:id', async (request, response, next) => {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) return response.status(400).json({ error: 'Invalid link ID.' });
    try {
      const existing = await linkModel.findById(request.params.id);
      if (!existing) return response.status(404).json({ error: 'Link not found.' });
      await clickEventModel.deleteMany({ linkId: existing._id });
      const deleted = await linkModel.findByIdAndDelete(request.params.id);
      if (!deleted) return response.status(404).json({ error: 'Link not found.' });
      response.json({ message: 'Link deleted.', id: request.params.id });
    } catch (error) { next(error); }
  });

  router.post('/', async (request, response, next) => {
    try {
      const { link, utmConflicts } = await linkService.create(request.body ?? {});
      const baseUrl = (process.env.SHORT_BASE_URL ?? `${request.protocol}://${request.get('host')}`).replace(/\/$/, '');
      response.status(201).json({
        id: link.id ?? link._id?.toString(),
        originalUrl: link.originalUrl,
        shortCode: link.shortCode,
        shortUrl: `${baseUrl}/${link.shortCode}`,
        isCustomAlias: link.isCustomAlias ?? Boolean(request.body?.customAlias),
        title: link.title ?? '',
        tags: link.tags ?? [],
        status: link.status ?? 'active',
        utmConflicts,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt ?? null,
        adaptiveRouting: serializeLink(link, baseUrl).adaptiveRouting,
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
