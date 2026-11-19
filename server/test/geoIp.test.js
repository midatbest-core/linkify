import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildLinkAnalyticsPipeline, buildOverviewAnalyticsPipeline, formatLinkAnalytics } from '../src/services/analyticsService.js';
import { createGeoLocator, normalizeGeoRecord, resolveGeoDatabasePath, validateGeoDatabase } from '../src/services/geoIpService.js';
import { parseDateRange } from '../src/utils/dateRange.js';
import { isPublicIp } from '../src/utils/publicIp.js';

const localDbPath = fileURLToPath(new URL('../data/dbip-city-lite-2026-11.mmdb', import.meta.url));

test('maps DB-IP City Lite country and subdivision fields', () => {
  assert.deepEqual(normalizeGeoRecord({ country: { iso_code: 'US', names: { en: 'United States' } }, city: { names: { en: 'Mountain View' } }, subdivisions: [{ names: { en: 'California' } }] }), { countryName: 'United States', countryCode: 'US', region: 'California', cityName: 'Mountain View' });
});

test('the extracted DB-IP MMDB opens with maxmind and resolves the published sample address', { skip: !existsSync(localDbPath) }, async () => {
  const location = await createGeoLocator({ dbPath: localDbPath })('8.8.8.8');
  assert.equal(location.countryName, 'United States');
  assert.equal(location.countryCode, 'US');
  assert.equal(location.region, 'California');
  assert.equal(location.cityName, 'Mountain View');
});

test('production GeoIP startup validation opens the configured MMDB', { skip: !existsSync(localDbPath) }, async () => {
  assert.equal(resolveGeoDatabasePath('./data/dbip-city-lite-2026-11.mmdb'), localDbPath);
  assert.equal(await validateGeoDatabase(localDbPath), true);
  assert.equal(await createGeoLocator({ dbPath: './data/dbip-city-lite-2026-11.mmdb' }).initialize(), true);
  await assert.rejects(validateGeoDatabase('/missing/database.mmdb'));
});

test('accepts public IPs and rejects missing, private, reserved, and malformed addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPublicIp(ip), true, ip);
  for (const ip of [undefined, 'not-an-ip', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.1.2', '172.20.1.1', '192.168.1.2', '198.19.0.1', '203.0.113.1', '::1', 'fc00::1', 'fe80::1', '2001:db8::1', '::ffff:192.168.1.1']) assert.equal(isPublicIp(ip), false, String(ip));
});

test('unknown fallbacks and safe diagnostics cover missing, private, and failed lookups', async () => {
  const messages = [];
  const logger = { warn: (message) => messages.push(message) };
  const unknown = { countryName: 'Unknown', countryCode: null, region: null, cityName: null };
  let readerCalls = 0;
  const locator = createGeoLocator({ dbPath: '/unused.mmdb', logger, readerFactory: async () => { readerCalls += 1; return { get: () => undefined }; } });
  assert.deepEqual(await locator(undefined), unknown);
  assert.deepEqual(await locator('10.0.0.1'), unknown);
  assert.equal(readerCalls, 0);
  assert.ok(messages.every((message) => !message.includes('10.0.0.1')));

  const failedMessages = [];
  const failed = createGeoLocator({ dbPath: '/broken.mmdb', logger: { warn: (message) => failedMessages.push(message) }, readerFactory: async () => { throw new Error('sensitive details'); } });
  assert.deepEqual(await failed('8.8.8.8'), unknown);
  assert.match(failedMessages[0], /lookup failed \(Error\)/);
  assert.doesNotMatch(failedMessages[0], /8\.8\.8\.8|sensitive details/);
});

test('geographic analytics facets honor selected date ranges and old events group as Unknown', () => {
  const range = parseDateRange({ from: '2025-05-02', to: '2025-05-03' });
  const linkPipeline = buildLinkAnalyticsPipeline('64b000000000000000000001', range);
  const overviewPipeline = buildOverviewAnalyticsPipeline(range);
  assert.deepEqual(linkPipeline[1].$facet.countries[0].$match.clickedAt, { $gte: range.from, $lt: range.toExclusive });
  assert.deepEqual(linkPipeline[1].$facet.cities[0].$match.cityName, { $ne: null });
  assert.deepEqual(overviewPipeline[0].$match.clickedAt, { $gte: range.from, $lt: range.toExclusive });
  assert.deepEqual(linkPipeline[1].$facet.countries[1].$group._id.countryCode, { $ifNull: ['$countryCode', 'unknown'] });
  const formatted = formatLinkAnalytics([{ countries: [{ _id: { countryCode: 'unknown', countryName: 'Unknown' }, count: 2 }], cities: [{ _id: { cityName: 'Mountain View', countryCode: 'US', countryName: 'United States' }, count: 1 }], regions: [] }], range);
  assert.deepEqual(formatted.countries, [{ countryCode: 'unknown', countryName: 'Unknown', clicks: 2 }]);
  assert.deepEqual(formatted.cities, [{ cityName: 'Mountain View', countryCode: 'US', countryName: 'United States', clicks: 1 }]);
});
