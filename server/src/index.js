import 'dotenv/config';
import app from './app.js';
import { connectDatabase } from './config/database.js';
import { isValidAdminPasswordHash } from './middleware/adminAuth.js';
import { isCanonicalHttpsOrigin } from './utils/httpOrigin.js';

const port = Number(process.env.PORT ?? 5000);

if (process.env.NODE_ENV === 'production') {
  const required = ['CLIENT_ORIGIN', 'SHORT_BASE_URL', 'MONGODB_URI', 'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH', 'GEOIP_DB_PATH'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length || !isValidAdminPasswordHash(process.env.ADMIN_PASSWORD_HASH) || !/^(1|[2-9]\d*)$/.test(process.env.TRUST_PROXY_HOPS ?? '')) {
    console.error('Production startup configuration is incomplete. Set required environment variables and an explicit TRUST_PROXY_HOPS value.');
    process.exit(1);
  }
  if (!isCanonicalHttpsOrigin(process.env.CLIENT_ORIGIN) || !process.env.SHORT_BASE_URL.startsWith('https://') || process.env.CLIENT_ORIGIN.includes('localhost') || process.env.SHORT_BASE_URL.includes('localhost')) {
    console.error('Production CLIENT_ORIGIN must be one canonical HTTPS origin, and SHORT_BASE_URL must use a deployed HTTPS domain.');
    process.exit(1);
  }
}

try {
  if (process.env.NODE_ENV === 'production') {
    await app.locals.initializeGeoIp();
    console.info('[geoip] database opened and public-IP sample lookup succeeded.');
  }
  await connectDatabase();
  app.listen(port, () => console.info(`Linkify API listening on port ${port}.`));
} catch (error) {
  console.error(`Unable to start Linkify API (${error.name ?? 'Error'}). Check server configuration and database connectivity.`);
  process.exitCode = 1;
}
