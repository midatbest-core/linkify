import { Router } from 'express';
import Link from '../models/Link.js';
import ClickEvent from '../models/ClickEvent.js';
import { classifyClickRequest } from '../utils/clickClassification.js';

export function createRedirectRouter({ linkModel = Link, clickEventModel = ClickEvent, logger = console, geoLocator = async () => ({ countryName: 'Unknown', countryCode: null, region: null }) } = {}) {
  const router = Router();

  router.get('/:code', async (request, response, next) => {
    try {
      const link = await linkModel.findOne({ shortCode: request.params.code });
      if (!link) return response.status(404).type('text').send('Short link not found.');
      if ((link.status ?? 'active') === 'archived') return response.status(410).type('text').send('This short link has been archived.');
      const logAnalyticsFailure = (analyticsError) => {
        try { logger.error(`[analytics] click recording failed for ${request.params.code} (${analyticsError.name ?? 'Error'}).`); }
        catch { process.stderr.write('[analytics] click recording failed and the logger was unavailable.\n'); }
      };
      if (request.method === 'GET') {
        try {
          Promise.resolve().then(async () => ({
            ...classifyClickRequest({
              userAgent: request.get('user-agent'), referrer: request.get('referer'),
            }),
            ...await geoLocator(request.ip),
          })).then((record) => clickEventModel.create({ linkId: link._id, clickedAt: new Date(), ...record })).catch(logAnalyticsFailure);
        } catch (analyticsError) { logAnalyticsFailure(analyticsError); }
      }
      return response.redirect(302, link.originalUrl);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createRedirectRouter;
