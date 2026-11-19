const UNKNOWN = Object.freeze({ countryName: 'Unknown', countryCode: null, region: null });

export async function validateGeoDatabase(dbPath = process.env.GEOIP_DB_PATH) {
  if (!dbPath) throw new Error('GEOIP_DB_PATH is required.');
  const maxmind = await import('maxmind');
  const reader = await maxmind.open(dbPath);
  const sample = reader.get('8.8.8.8');
  if (!sample?.country?.iso_code || !sample?.country?.names?.en) {
    throw new Error('GeoIP database validation failed.');
  }
  return true;
}

export function normalizeGeoRecord(record) {
  const countryCode = record?.country?.iso_code ?? record?.registered_country?.iso_code ?? null;
  const countryName = record?.country?.names?.en ?? record?.registered_country?.names?.en ?? null;
  const region = record?.subdivisions?.[0]?.names?.en ?? null;
  if (!countryCode || !countryName) return { ...UNKNOWN };
  return { countryName, countryCode, region };
}

export function createGeoLocator({ dbPath = process.env.GEOIP_DB_PATH, readerFactory } = {}) {
  let readerPromise;
  return async function locate(ip) {
    if (!ip || !dbPath) return { ...UNKNOWN };
    try {
      readerPromise ??= (async () => {
        if (readerFactory) return readerFactory(dbPath);
        const maxmind = await import('maxmind');
        return maxmind.open(dbPath);
      })();
      const reader = await readerPromise;
      if (!reader || typeof reader.get !== 'function') return { ...UNKNOWN };
      return normalizeGeoRecord(reader.get(ip));
    } catch {
      readerPromise = undefined;
      return { ...UNKNOWN };
    }
  };
}

export { UNKNOWN as UNKNOWN_GEOLOCATION };
