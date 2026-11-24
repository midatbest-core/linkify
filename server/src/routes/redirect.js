import { Router } from 'express';
import Link from '../models/Link.js';
import ClickEvent from '../models/ClickEvent.js';
import { classifyClickRequest } from '../utils/clickClassification.js';
import { resolveAdaptiveDestination } from '../services/adaptiveRoutingService.js';
import { normalizeAndValidateUrl } from '../utils/validation.js';

function loopsToCurrentShortLink(destinationUrl, shortCode, request) {
  try {
    const destination = new URL(destinationUrl);
    const pathname = `/${shortCode}`;
    if (destination.pathname !== pathname) return false;
    const hosts = new Set([request.get('host')?.toLowerCase()]);
    try { if (process.env.SHORT_BASE_URL) hosts.add(new URL(process.env.SHORT_BASE_URL).host.toLowerCase()); } catch {}
    return hosts.has(destination.host.toLowerCase());
  } catch { return false; }
}

export function createRedirectRouter({ linkModel = Link, clickEventModel = ClickEvent, logger = console, geoLocator = async () => ({ countryName: 'Unknown', countryCode: null, region: null, cityName: null }) } = {}) {
  const router = Router();

  router.get('/:code', async (request, response, next) => {
    try {
      const link = await linkModel.findOne({ shortCode: request.params.code });
      if (!link) return response.status(404).type('text').send('Short link not found.');
      if ((link.status ?? 'active') === 'archived') return response.status(410).type('text').send('This short link has been archived.');
      const classification = classifyClickRequest({ userAgent: request.get('user-agent'), referrer: request.get('referer') });
      let geography = { countryName: 'Unknown', countryCode: null, region: null, cityName: null };
      try {
        // Only use the trusted visitor-IP source configured for the Render edge.
        // A GeoIP outage must not interrupt public redirects.
        geography = await geoLocator(request.get('cf-connecting-ip')) ?? geography;
      } catch (error) {
        try { logger.warn(`[geoip] redirect lookup failed (${error?.name ?? 'Error'}).`); } catch {}
      }
      let routing = resolveAdaptiveDestination(link, {
        deviceType: classification.deviceType,
        countryCode: typeof geography.countryCode === 'string' ? geography.countryCode.toUpperCase() : null,
        query: request.query,
      });
      if (loopsToCurrentShortLink(routing.destinationUrl, link.shortCode, request)) {
        const rawDefault = link.adaptiveRouting?.enabled ? link.adaptiveRouting.defaultDestinationUrl : link.originalUrl;
        const safeDefault = normalizeAndValidateUrl(rawDefault);
        if (safeDefault.error || loopsToCurrentShortLink(safeDefault.value, link.shortCode, request)) return response.status(410).type('text').send('This short link would redirect to itself.');
        routing = {
          destinationUrl: safeDefault.value,
          selectedDestinationId: link.adaptiveRouting?.defaultDestinationId ?? 'default',
          matchedRuleId: null,
          usedFallback: true,
        };
      }
      if (!routing.destinationUrl) return response.status(410).type('text').send('This short link has no valid destination.');
      const logAnalyticsFailure = (analyticsError) => {
        try { logger.error(`[analytics] click recording failed for ${request.params.code} (${analyticsError.name ?? 'Error'}).`); }
        catch { process.stderr.write('[analytics] click recording failed and the logger was unavailable.\n'); }
      };
      if (request.method === 'GET') {
        try {
          Promise.resolve().then(async () => ({
            ...classification,
            ...geography,
          })).then((record) => clickEventModel.create({
            linkId: link._id, clickedAt: new Date(), ...record,
            selectedDestinationId: routing.selectedDestinationId,
            matchedRuleId: routing.matchedRuleId,
            usedFallback: routing.usedFallback,
            ...(link.management?.ownerType === 'flow' ? {
              flowId: link.management.flowId,
              publicationNumber: link.management.publicationNumber ?? null,
            } : {}),
          })).catch(logAnalyticsFailure);
        } catch (analyticsError) { logAnalyticsFailure(analyticsError); }
      }
      return response.redirect(302, routing.destinationUrl);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createRedirectRouter;
