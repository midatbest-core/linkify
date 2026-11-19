import mongoose from 'mongoose';

const dateMatch = (range) => ({ clickedAt: { $gte: range.from, $lt: range.toExclusive } });
const groupCount = (field) => [
  { $group: { _id: { $ifNull: [`$${field}`, 'unknown'] }, count: { $sum: 1 } } },
  { $sort: { count: -1, _id: 1 } },
];
const dailyCounts = (range) => [
  { $match: dateMatch(range) },
  { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$clickedAt', timezone: 'UTC' } }, count: { $sum: 1 } } },
  { $sort: { _id: 1 } },
];

export function buildLinkAnalyticsPipeline(linkId, range, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sevenDays = new Date(today.getTime() - 6 * 86400000);
  const thirtyDays = new Date(today.getTime() - 29 * 86400000);
  const selected = dateMatch(range);
  return [
    { $match: { linkId: new mongoose.Types.ObjectId(linkId) } },
    { $facet: {
      totals: [{ $group: { _id: null, totalClicks: { $sum: 1 }, clicksToday: { $sum: { $cond: [{ $gte: ['$clickedAt', today] }, 1, 0] } }, clicksLast7Days: { $sum: { $cond: [{ $gte: ['$clickedAt', sevenDays] }, 1, 0] } }, clicksLast30Days: { $sum: { $cond: [{ $gte: ['$clickedAt', thirtyDays] }, 1, 0] } } } }],
      selectedTotal: [{ $match: selected }, { $count: 'count' }],
      daily: dailyCounts(range),
      devices: [{ $match: selected }, ...groupCount('deviceType')],
      browsers: [{ $match: selected }, ...groupCount('browser')],
      operatingSystems: [{ $match: selected }, ...groupCount('operatingSystem')],
      referrers: [{ $match: { ...selected, referrer: { $ne: null } } }, ...groupCount('referrer'), { $limit: 10 }],
      countries: [{ $match: selected }, { $group: { _id: { countryCode: { $ifNull: ['$countryCode', 'unknown'] }, countryName: { $ifNull: ['$countryName', 'Unknown'] } }, count: { $sum: 1 } } }, { $sort: { count: -1, '_id.countryName': 1 } }],
      cities: [{ $match: { ...selected, cityName: { $ne: null } } }, { $group: { _id: { cityName: '$cityName', countryCode: { $ifNull: ['$countryCode', 'unknown'] }, countryName: { $ifNull: ['$countryName', 'Unknown'] } }, count: { $sum: 1 } } }, { $sort: { count: -1, '_id.cityName': 1 } }, { $limit: 20 }],
      regions: [{ $match: { ...selected, region: { $ne: null } } }, { $group: { _id: { countryCode: { $ifNull: ['$countryCode', 'unknown'] }, countryName: { $ifNull: ['$countryName', 'Unknown'] }, region: '$region' }, count: { $sum: 1 } } }, { $sort: { count: -1, '_id.region': 1 } }, { $limit: 20 }],
      bots: [{ $match: selected }, { $group: { _id: '$isBot', count: { $sum: 1 } } }],
    } },
  ];
}

export function buildOverviewAnalyticsPipeline(range) {
  const selected = dateMatch(range);
  return [
    { $match: selected },
    { $facet: {
      totals: [{ $count: 'count' }],
      daily: [
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$clickedAt', timezone: 'UTC' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ],
      devices: groupCount('deviceType'),
      countries: [{ $group: { _id: { countryCode: { $ifNull: ['$countryCode', 'unknown'] }, countryName: { $ifNull: ['$countryName', 'Unknown'] } }, count: { $sum: 1 } } }, { $sort: { count: -1, '_id.countryName': 1 } }],
      cities: [{ $match: { cityName: { $ne: null } } }, { $group: { _id: { cityName: '$cityName', countryCode: { $ifNull: ['$countryCode', 'unknown'] }, countryName: { $ifNull: ['$countryName', 'Unknown'] } }, count: { $sum: 1 } } }, { $sort: { count: -1, '_id.cityName': 1 } }, { $limit: 20 }],
      regions: [{ $match: { region: { $ne: null } } }, { $group: { _id: { countryCode: { $ifNull: ['$countryCode', 'unknown'] }, countryName: { $ifNull: ['$countryName', 'Unknown'] }, region: '$region' }, count: { $sum: 1 } } }, { $sort: { count: -1, '_id.region': 1 } }, { $limit: 20 }],
      referrers: [{ $match: { referrer: { $ne: null } } }, ...groupCount('referrer'), { $limit: 10 }],
      topLinks: [
        { $group: { _id: '$linkId', clicks: { $sum: 1 } } },
        { $sort: { clicks: -1, _id: 1 } }, { $limit: 10 },
        { $lookup: { from: 'links', localField: '_id', foreignField: '_id', as: 'link' } },
        { $unwind: '$link' },
        { $project: { _id: 0, linkId: '$_id', shortCode: '$link.shortCode', originalUrl: '$link.originalUrl', title: '$link.title', status: '$link.status', clicks: 1 } },
      ],
    } },
  ];
}

function keyedCounts(rows = []) {
  return Object.fromEntries(rows.map(({ _id, count }) => [_id ?? 'unknown', count]));
}

function fillDailyRange(rows = [], range) {
  const counts = new Map(rows.map(({ _id, count }) => [_id, count]));
  const result = [];
  for (let day = range.from.getTime(); day < range.toExclusive.getTime(); day += 86400000) {
    const date = new Date(day).toISOString().slice(0, 10);
    result.push({ _id: date, count: counts.get(date) ?? 0 });
  }
  return result;
}

function runAggregate(model, pipeline) {
  const aggregation = model.aggregate(pipeline);
  if (typeof aggregation.allowDiskUse === 'function') aggregation.allowDiskUse(true);
  return aggregation;
}

export { runAggregate };

export function formatLinkAnalytics(result, range) {
  const data = result?.[0] ?? {};
  const totals = data.totals?.[0] ?? {};
  const bots = keyedCounts(data.bots);
  return {
    range: { from: range.fromDate, to: range.toDate, timezone: 'UTC' },
    totalClicks: totals.totalClicks ?? 0,
    clicksInRange: data.selectedTotal?.[0]?.count ?? 0,
    clicksToday: totals.clicksToday ?? 0,
    clicksLast7Days: totals.clicksLast7Days ?? 0,
    clicksLast30Days: totals.clicksLast30Days ?? 0,
    dailyClicks: fillDailyRange(data.daily, range),
    deviceBreakdown: keyedCounts(data.devices),
    browserBreakdown: keyedCounts(data.browsers),
    operatingSystemBreakdown: keyedCounts(data.operatingSystems),
    topReferrers: (data.referrers ?? []).map(({ _id, count }) => ({ hostname: _id, clicks: count })),
    countries: (data.countries ?? []).map(({ _id, count }) => ({ countryCode: _id.countryCode, countryName: _id.countryName, clicks: count })),
    cities: (data.cities ?? []).map(({ _id, count }) => ({ ..._id, clicks: count })),
    regions: (data.regions ?? []).map(({ _id, count }) => ({ ..._id, clicks: count })),
    botBreakdown: { bots: bots.true ?? 0, nonBots: bots.false ?? 0, estimated: true },
  };
}

export function formatOverviewAnalytics(result, recentLinks = [], range) {
  const data = result?.[0] ?? {};
  return {
    range: { from: range.fromDate, to: range.toDate, timezone: 'UTC' },
    totalClicks: data.totals?.[0]?.count ?? 0,
    dailyClicks: fillDailyRange(data.daily, range),
    deviceBreakdown: keyedCounts(data.devices),
    countries: (data.countries ?? []).map(({ _id, count }) => ({ countryCode: _id.countryCode, countryName: _id.countryName, clicks: count })),
    cities: (data.cities ?? []).map(({ _id, count }) => ({ ..._id, clicks: count })),
    regions: (data.regions ?? []).map(({ _id, count }) => ({ ..._id, clicks: count })),
    topReferrers: (data.referrers ?? []).map(({ _id, count }) => ({ hostname: _id, clicks: count })),
    topLinks: data.topLinks ?? [],
    recentlyCreatedLinks: recentLinks,
  };
}
