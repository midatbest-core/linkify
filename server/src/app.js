import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import Link from './models/Link.js';
import ClickEvent from './models/ClickEvent.js';
import { createAliasesRouter } from './routes/aliases.js';
import healthRouter from './routes/health.js';
import { createAnalyticsRouter } from './routes/analytics.js';
import { createLinksRouter } from './routes/links.js';
import { createRedirectRouter } from './routes/redirect.js';

export function createApp({ linkModel = Link, clickEventModel = ClickEvent, clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5174', logger = console } = {}) {
  const app = express();
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

  app.use(cors({ origin: (requestOrigin, callback) => callback(null, requestOrigin === clientOrigin) }));
  app.use(express.json());
  app.use('/api/health', healthRouter);
  app.use('/api', createAnalyticsRouter({ linkModel, clickEventModel, rateLimitMiddleware: analyticsLimit }));
  app.use('/api/links', (request, response, next) => request.method === 'POST'
    ? createLinkLimit(request, response, next)
    : next(), createLinksRouter({ linkModel, clickEventModel }));
  app.use('/api/aliases', aliasCheckLimit, createAliasesRouter({ linkModel }));
  app.use('/', createRedirectRouter({ linkModel, clickEventModel, logger }));
  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({ error: 'An unexpected server error occurred.' });
  });

  return app;
}

export default createApp();
