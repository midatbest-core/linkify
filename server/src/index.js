import 'dotenv/config';
import app from './app.js';
import { connectDatabase } from './config/database.js';
import { isValidAdminPasswordHash } from './middleware/adminAuth.js';
import { validateGeoDatabase } from './services/geoIpService.js';

const port = Number(process.env.PORT ?? 5000);

if (process.env.NODE_ENV === 'production') {
  const required = ['CLIENT_ORIGIN', 'SHORT_BASE_URL', 'MONGODB_URI', 'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH', 'GEOIP_DB_PATH'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length || !isValidAdminPasswordHash(process.env.ADMIN_PASSWORD_HASH) || !/^(1|[2-9]\d*)$/.test(process.env.TRUST_PROXY_HOPS ?? '')) {
    console.error('Production startup configuration is incomplete. Set required environment variables and an explicit TRUST_PROXY_HOPS value.');
    process.exit(1);
  }
  if (!process.env.CLIENT_ORIGIN.startsWith('https://') || !process.env.SHORT_BASE_URL.startsWith('https://') || process.env.CLIENT_ORIGIN.includes('localhost') || process.env.SHORT_BASE_URL.includes('localhost')) {
    console.error('Production CLIENT_ORIGIN and SHORT_BASE_URL must use deployed HTTPS domains.');
    process.exit(1);
  }
}

try {
  if (process.env.NODE_ENV === 'production') await validateGeoDatabase(process.env.GEOIP_DB_PATH);
  await connectDatabase();
  app.listen(port, () => console.info(`Linkify API listening on port ${port}.`));
} catch (error) {
  console.error(`Unable to start Linkify API (${error.name ?? 'Error'}). Check server configuration and database connectivity.`);
  process.exitCode = 1;
}
