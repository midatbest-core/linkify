import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPublicIp } from '../utils/publicIp.js';

const UNKNOWN = Object.freeze({ countryName: 'Unknown', countryCode: null, region: null, cityName: null });
const serverRoot = fileURLToPath(new URL('../../', import.meta.url));

export function resolveGeoDatabasePath(dbPath = process.env.GEOIP_DB_PATH) {
  if (!dbPath) return null;
  return resolve(serverRoot, dbPath);
}

export async function validateGeoDatabase(dbPath = process.env.GEOIP_DB_PATH) {
  if (!dbPath) throw new Error('GEOIP_DB_PATH is required.');
  const maxmind = await import('maxmind');
  const reader = await maxmind.open(resolveGeoDatabasePath(dbPath));
  const sample = reader.get('8.8.8.8');
  if (!sample?.country?.iso_code || !sample?.country?.names?.en || !sample?.city?.names?.en) {
    throw new Error('GeoIP database validation failed.');
  }
  return true;
}

export function normalizeGeoRecord(record) {
  const countryCode = record?.country?.iso_code ?? record?.registered_country?.iso_code ?? null;
  const countryName = record?.country?.names?.en ?? record?.registered_country?.names?.en ?? null;
  const region = record?.subdivisions?.[0]?.names?.en ?? null;
  const cityName = record?.city?.names?.en ?? null;
  if (!countryCode || !countryName) return { ...UNKNOWN, cityName };
  return { countryName, countryCode, region, cityName };
}

export function createGeoLocator({ dbPath = process.env.GEOIP_DB_PATH, readerFactory, logger = console } = {}) {
  const resolvedDbPath = resolveGeoDatabasePath(dbPath);
  let readerPromise;
  const loggedReasons = new Set();
  const logOnce = (reason, message) => {
    if (loggedReasons.has(reason)) return;
    loggedReasons.add(reason);
    try { logger.warn(message); } catch {}
  };
  const openReader = () => {
    readerPromise ??= (async () => {
      if (readerFactory) return readerFactory(resolvedDbPath);
      const maxmind = await import('maxmind');
      return maxmind.open(resolvedDbPath);
    })();
    return readerPromise;
  };
  const locate = async function locate(ip) {
    if (!ip) {
      logOnce('missing-ip', '[geoip] lookup skipped: request IP was unavailable.');
      return { ...UNKNOWN, cityName: null };
    }
    if (!isPublicIp(ip)) {
      logOnce('non-public-ip', '[geoip] lookup skipped: request IP was invalid, private, or reserved.');
      return { ...UNKNOWN, cityName: null };
    }
    if (!dbPath) {
      logOnce('missing-database', '[geoip] lookup skipped: GEOIP_DB_PATH is not configured.');
      return { ...UNKNOWN, cityName: null };
    }
    try {
      const reader = await openReader();
      if (!reader || typeof reader.get !== 'function') throw new Error('Invalid MMDB reader');
      const record = reader.get(ip);
      if (!record) {
        logOnce('no-record', '[geoip] lookup returned no record for a public client IP.');
        return { ...UNKNOWN, cityName: null };
      }
      const normalized = normalizeGeoRecord(record);
      if (normalized.countryCode === null) logOnce('incomplete-record', '[geoip] lookup record did not contain country fields.');
      return normalized;
    } catch (error) {
      readerPromise = undefined;
      logOnce('lookup-error', `[geoip] database lookup failed (${error?.name ?? 'Error'}).`);
      return { ...UNKNOWN, cityName: null };
    }
  };
  locate.initialize = async () => {
    const reader = await openReader();
    const sample = reader?.get?.('8.8.8.8');
    if (!sample?.country?.iso_code || !sample?.country?.names?.en || !sample?.city?.names?.en) {
      throw new Error('GeoIP database validation failed.');
    }
    return true;
  };
  return locate;
}

export { UNKNOWN as UNKNOWN_GEOLOCATION };
