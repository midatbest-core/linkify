import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildLinkAnalyticsPipeline, buildOverviewAnalyticsPipeline, formatLinkAnalytics } from '../src/services/analyticsService.js';
import { createGeoLocator, normalizeGeoRecord, validateGeoDatabase } from '../src/services/geoIpService.js';
import { parseDateRange } from '../src/utils/dateRange.js';

const localDbPath = fileURLToPath(new URL('../data/dbip-city-lite-2026-11.mmdb', import.meta.url));

test('maps DB-IP City Lite country and subdivision fields', () => {
  assert.deepEqual(normalizeGeoRecord({ country: { iso_code: 'US', names: { en: 'United States' } }, subdivisions: [{ names: { en: 'California' } }] }), { countryName: 'United States', countryCode: 'US', region: 'California' });
});

test('the extracted DB-IP MMDB opens with maxmind and resolves the published sample address', { skip: !existsSync(localDbPath) }, async () => {
  const location = await createGeoLocator({ dbPath: localDbPath })('8.8.8.8');
  assert.equal(location.countryName, 'United States');
  assert.equal(location.countryCode, 'US');
  assert.equal(location.region, 'California');
});

test('production GeoIP startup validation opens the configured MMDB', { skip: !existsSync(localDbPath) }, async () => {
  assert.equal(await validateGeoDatabase(localDbPath), true);
  await assert.rejects(validateGeoDatabase('/missing/database.mmdb'));
});

test('unknown location is returned for missing IP, absent database and lookup failure', async () => {
  assert.deepEqual(await createGeoLocator({ dbPath: '/unused.mmdb' })(undefined), { countryName: 'Unknown', countryCode: null, region: null });
  assert.deepEqual(await createGeoLocator({})('203.0.113.1'), { countryName: 'Unknown', countryCode: null, region: null });
  const failed = createGeoLocator({ dbPath: '/broken.mmdb', readerFactory: async () => { throw new Error('broken database'); } });
  assert.deepEqual(await failed('203.0.113.1'), { countryName: 'Unknown', countryCode: null, region: null });
});

test('geographic analytics facets honor selected date ranges and old events group as Unknown', () => {
  const range = parseDateRange({ from: '2025-05-02', to: '2025-05-03' });
  const linkPipeline = buildLinkAnalyticsPipeline('64b000000000000000000001', range);
  const overviewPipeline = buildOverviewAnalyticsPipeline(range);
  assert.deepEqual(linkPipeline[1].$facet.countries[0].$match.clickedAt, { $gte: range.from, $lt: range.toExclusive });
  assert.deepEqual(overviewPipeline[0].$match.clickedAt, { $gte: range.from, $lt: range.toExclusive });
  assert.deepEqual(linkPipeline[1].$facet.countries[1].$group._id.countryCode, { $ifNull: ['$countryCode', 'unknown'] });
  const formatted = formatLinkAnalytics([{ countries: [{ _id: { countryCode: 'unknown', countryName: 'Unknown' }, count: 2 }], regions: [] }], range);
  assert.deepEqual(formatted.countries, [{ countryCode: 'unknown', countryName: 'Unknown', clicks: 2 }]);
});
