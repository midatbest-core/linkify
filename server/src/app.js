import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import Link from './models/Link.js';
import ClickEvent from './models/ClickEvent.js';
import AdminSession from './models/AdminSession.js';
import Flow from './models/Flow.js';
import { createAdminAuth } from './middleware/adminAuth.js';
import { createGeoLocator } from './services/geoIpService.js';
import { createAliasesRouter } from './routes/aliases.js';
import healthRouter from './routes/health.js';
import { createAnalyticsRouter } from './routes/analytics.js';
import { createLinksRouter } from './routes/links.js';
import { createRedirectRouter } from './routes/redirect.js';
import { createFlowsRouter } from './routes/flows.js';

export function createApp({ linkModel = Link, flowModel = Flow, clickEventModel = ClickEvent, sessionModel = AdminSession, adminUsername = process.env.ADMIN_USERNAME, adminPasswordHash = process.env.ADMIN_PASSWORD_HASH, clientOrigin = process.env.CLIENT_ORIGIN ?? (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5174'), trustProxyHops = process.env.TRUST_PROXY_HOPS, production = process.env.NODE_ENV === 'production', logger = console, geoLocator = createGeoLocator() } = {}) {
  const app = express();
  const proxyHops = trustProxyHops;
  if (proxyHops !== undefined && /^(0|[1-9]\d*)$/.test(proxyHops)) app.set('trust proxy', Number(proxyHops));
  const createLinkLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many link requests. Please try again in a few minutes.' },
  });
  const aliasCheckLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many alias checks. Please try again in a few minutes.' },
  });
  const analyticsLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many analytics requests. Please try again in a few minutes.' },
  });
  const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many login attempts. Try again later.' } });
  const auth = createAdminAuth({ sessionModel, username: adminUsername, passwordHash: adminPasswordHash, clientOrigin, production });
  app.locals.initializeGeoIp = () => typeof geoLocator.initialize === 'function' ? geoLocator.initialize() : Promise.resolve(true);

  app.use(cors({ origin: (requestOrigin, callback) => callback(null, requestOrigin === clientOrigin), credentials: true }));
  app.use(express.json());
  app.use('/api/health', healthRouter);
  app.get('/api/auth/session', auth.status);
  app.post('/api/auth/login', loginLimit, auth.requireSameOrigin, auth.login);
  app.post('/api/auth/logout', auth.requireSameOrigin, auth.logout);
  app.use('/api', (request, response, next) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
    ? auth.requireSameOrigin(request, response, next)
    : next());
  app.use('/api', auth.requireAdmin);
  app.use('/api', createAnalyticsRouter({ linkModel, clickEventModel, rateLimitMiddleware: analyticsLimit }));
  app.use('/api/flows', createFlowsRouter({ flowModel }));
  app.use('/api/links', (request, response, next) => request.method === 'POST'
    ? createLinkLimit(request, response, next)
    : next(), createLinksRouter({ linkModel, clickEventModel }));
  app.use('/api/aliases', aliasCheckLimit, createAliasesRouter({ linkModel }));
  app.use('/', createRedirectRouter({ linkModel, clickEventModel, logger, geoLocator }));
  app.use((error, _request, response, _next) => {
    try { logger.error(`[api] request failed (${error.name ?? 'Error'}).`); } catch {}
    response.status(500).json({ error: 'An unexpected server error occurred.' });
  });

  return app;
}

export default createApp();
