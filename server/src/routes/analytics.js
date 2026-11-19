import { Router } from 'express';
import mongoose from 'mongoose';
import ClickEvent from '../models/ClickEvent.js';
import Link from '../models/Link.js';
import { buildLinkAnalyticsPipeline, buildOverviewAnalyticsPipeline, formatLinkAnalytics, formatOverviewAnalytics, runAggregate } from '../services/analyticsService.js';
import { parseDateRange } from '../utils/dateRange.js';

export function createAnalyticsRouter({ linkModel = Link, clickEventModel = ClickEvent, rateLimitMiddleware = (_request, _response, next) => next() } = {}) {
  const router = Router();

  router.get('/analytics/overview', rateLimitMiddleware, async (request, response, next) => {
    try {
      const range = parseDateRange(request.query);
      const [result, recentLinks] = await Promise.all([
        runAggregate(clickEventModel, buildOverviewAnalyticsPipeline(range)),
        linkModel.find({}).sort({ createdAt: -1 }).limit(5),
      ]);
      const baseUrl = (process.env.SHORT_BASE_URL ?? `${request.protocol}://${request.get('host')}`).replace(/\/$/, '');
      response.json({ analytics: { ...formatOverviewAnalytics(result, recentLinks.map((link) => ({
        id: link.id ?? link._id?.toString(), shortCode: link.shortCode,
        shortUrl: `${baseUrl}/${link.shortCode}`, originalUrl: link.originalUrl,
        title: link.title ?? '', status: link.status ?? 'active', createdAt: link.createdAt,
      })), range) } });
    } catch (error) {
      if (error.status === 400) return response.status(400).json({ error: error.message });
      next(error);
    }
  });

  router.get('/links/:id/analytics', rateLimitMiddleware, async (request, response, next) => {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) return response.status(400).json({ error: 'Invalid link ID.' });
    try {
      const range = parseDateRange(request.query);
      const link = await linkModel.findById(request.params.id);
      if (!link) return response.status(404).json({ error: 'Link not found.' });
      const result = await runAggregate(clickEventModel, buildLinkAnalyticsPipeline(request.params.id, range));
      response.json({ analytics: formatLinkAnalytics(result, range) });
    } catch (error) {
      if (error.status === 400) return response.status(400).json({ error: error.message });
      next(error);
    }
  });

  return router;
}

export default createAnalyticsRouter;
