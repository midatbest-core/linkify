import { Router } from 'express';
import Link from '../models/Link.js';
import ClickEvent from '../models/ClickEvent.js';
import { classifyClickRequest } from '../utils/clickClassification.js';
import { resolveAdaptiveDestination } from '../services/adaptiveRoutingService.js';
import { normalizeAndValidateUrl } from '../utils/validation.js';
import {
  verifyLinkPassword,
  generateUnlockCookie,
  verifyUnlockCookie,
  checkUnlockRateLimit,
  recordUnlockAttempt,
} from '../services/linkProtectionService.js';
import { selectVariant } from '../services/experimentService.js';
import { renderUnlockPage } from '../views/unlockPage.js';

function parseCookies(header) {
  const list = {};
  if (!header || typeof header !== 'string') return list;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    try {
      list[key] = decodeURIComponent(val);
    } catch {
      list[key] = val;
    }
  }
  return list;
}

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

  router.post('/:code/unlock', async (request, response, next) => {
    try {
      const link = await linkModel.findOne({ shortCode: request.params.code });
      if (!link) return response.status(404).type('text').send('Short link not found.');
      if ((link.status ?? 'active') === 'archived') return response.status(410).type('text').send('This short link has been archived.');

      const clientIp = request.get('cf-connecting-ip') || request.ip || request.socket?.remoteAddress;
      const rateLimitResult = checkUnlockRateLimit(clientIp, link.shortCode);
      if (!rateLimitResult.allowed) {
        return response.status(429).type('html').send(renderUnlockPage({
          shortCode: link.shortCode,
          error: 'rate_limited',
          retryAfterSeconds: rateLimitResult.retryAfterSeconds,
        }));
      }

      recordUnlockAttempt(clientIp, link.shortCode);

      if (!link.protection?.enabled || !link.protection.passwordHash) {
        return response.redirect(302, `/${link.shortCode}`);
      }

      const enteredPassword = request.body?.password;
      const isValid = await verifyLinkPassword(enteredPassword, link.protection.passwordHash);

      const classification = classifyClickRequest({ userAgent: request.get('user-agent'), referrer: request.get('referer') });
      let geography = { countryName: 'Unknown', countryCode: null, region: null, cityName: null };
      try {
        geography = await geoLocator(request.get('cf-connecting-ip')) ?? geography;
      } catch (error) {
        try { logger.warn(`[geoip] unlock lookup failed (${error?.name ?? 'Error'}).`); } catch {}
      }

      if (!isValid) {
        try {
          clickEventModel.create({
            linkId: link._id,
            clickedAt: new Date(),
            ...classification,
            ...geography,
            accessStatus: 'blocked_password',
            ...(link.management?.ownerType === 'flow' ? {
              flowId: link.management.flowId,
              publicationNumber: link.management.publicationNumber ?? null,
            } : {}),
          }).catch(() => {});
        } catch {}

        return response.status(401).type('html').send(renderUnlockPage({
          shortCode: link.shortCode,
          error: 'invalid_password',
        }));
      }

      const cookieValue = generateUnlockCookie(link.shortCode, link.protection.passwordHash);
      response.cookie(`linkify_unlocked_${link.shortCode}`, cookieValue, {
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });

      return response.redirect(302, `/${link.shortCode}`);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:code', async (request, response, next) => {
    try {
      const link = await linkModel.findOne({ shortCode: request.params.code });
      if (!link) return response.status(404).type('text').send('Short link not found.');
      if ((link.status ?? 'active') === 'archived') return response.status(410).type('text').send('This short link has been archived.');

      const classification = classifyClickRequest({ userAgent: request.get('user-agent'), referrer: request.get('referer') });
      let geography = { countryName: 'Unknown', countryCode: null, region: null, cityName: null };
      try {
        geography = await geoLocator(request.get('cf-connecting-ip')) ?? geography;
      } catch (error) {
        try { logger.warn(`[geoip] redirect lookup failed (${error?.name ?? 'Error'}).`); } catch {}
      }

      const logAnalyticsFailure = (analyticsError) => {
        try { logger.error(`[analytics] click recording failed for ${request.params.code} (${analyticsError.name ?? 'Error'}).`); }
        catch { process.stderr.write('[analytics] click recording failed and the logger was unavailable.\n'); }
      };

      const recordClickAsync = (extra = {}) => {
        Promise.resolve().then(async () => ({
          ...classification,
          ...geography,
        })).then((record) => clickEventModel.create({
          linkId: link._id,
          clickedAt: new Date(),
          ...record,
          ...(link.management?.ownerType === 'flow' ? {
            flowId: link.management.flowId,
            publicationNumber: link.management.publicationNumber ?? null,
          } : {}),
          ...extra,
        })).catch(logAnalyticsFailure);
      };

      // 1. ACCESS PROTECTION EVALUATION
      if (link.protection?.enabled) {
        const now = new Date();
        // 1a. Expiration check
        if (link.protection.expiresAt && now > new Date(link.protection.expiresAt)) {
          recordClickAsync({ accessStatus: 'blocked_expired' });
          return response.status(410).type('text').send('This short link has expired.');
        }

        // 1b. Redirect limit (atomic maxClicks reservation)
        if (link.protection.maxClicks && link.protection.maxClicks > 0) {
          const updatedLink = await linkModel.findOneAndUpdate(
            {
              _id: link._id,
              status: 'active',
              'protection.enabled': true,
              'protection.maxClicks': { $gt: 0 },
              $expr: { $lt: ['$lifetimeRedirectCount', '$protection.maxClicks'] },
            },
            { $inc: { lifetimeRedirectCount: 1 } },
            { new: true },
          );
          if (!updatedLink) {
            recordClickAsync({ accessStatus: 'blocked_max_clicks' });
            return response.status(410).type('text').send('This short link has reached its maximum redirect limit.');
          }
        }

        // 1c. Password check
        if (link.protection.passwordHash) {
          const cookies = parseCookies(request.headers.cookie);
          const cookieName = `linkify_unlocked_${link.shortCode}`;
          const isUnlocked = verifyUnlockCookie(link.shortCode, link.protection.passwordHash, cookies[cookieName]);
          if (!isUnlocked) {
            return response.status(200).type('html').send(renderUnlockPage({
              shortCode: link.shortCode,
              error: request.query.error,
              retryAfterSeconds: request.query.retryAfter ? Number(request.query.retryAfter) : undefined,
            }));
          }
        }
      }

      // 2. ADAPTIVE & FLOW ROUTING EVALUATION
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

      // 3. A/B EXPERIMENT EVALUATION
      const activeExperiment = (routing.experiments?.enabled && Array.isArray(routing.experiments.variants) && routing.experiments.variants.length === 2)
        ? routing.experiments
        : (link.experiments?.enabled && Array.isArray(link.experiments.variants) && link.experiments.variants.length === 2)
          ? link.experiments
          : null;

      let finalDestinationUrl = routing.destinationUrl;
      let experimentRecord = null;

      if (activeExperiment) {
        const cookies = parseCookies(request.headers.cookie);
        const stageId = routing.matchedRuleId || 'default';
        const selection = selectVariant(activeExperiment, cookies, { shortCode: link.shortCode, stageId });
        if (selection) {
          finalDestinationUrl = selection.variant.destinationUrl;
          experimentRecord = {
            stageId: routing.matchedRuleId || null,
            variantId: selection.variant.variantId,
            variantLabel: selection.variant.label,
          };
          if (selection.isNewAssignment) {
            response.cookie(selection.cookieName, selection.cookieValue, {
              maxAge: 24 * 60 * 60 * 1000,
              httpOnly: false,
              sameSite: 'lax',
              secure: process.env.NODE_ENV === 'production',
            });
          }
        }
      }

      // 4. ASYNCHRONOUS CLICK LOGGING
      if (request.method === 'GET') {
        recordClickAsync({
          accessStatus: 'allowed',
          selectedDestinationId: routing.selectedDestinationId,
          matchedRuleId: routing.matchedRuleId,
          usedFallback: routing.usedFallback,
          experiment: experimentRecord,
        });
      }

      return response.redirect(302, finalDestinationUrl);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createRedirectRouter;
