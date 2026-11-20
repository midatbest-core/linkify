import { useState } from 'react';
import { formatAnalyticsLabel, formatCountryName } from '../utils/analyticsDisplay.js';

function metricEntries(data) {
  return Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
}

export function DailyChart({ rows = [], title = 'Daily clicks' }) {
  const [activeDay, setActiveDay] = useState(null);
  const active = rows.find((row) => row._id === activeDay);
  const max = Math.max(1, ...rows.map((row) => row.count));
  const width = 640;
  const height = 190;
  const barGap = rows.length > 45 ? 0 : 5;
  const barWidth = Math.max(1, (width - barGap * Math.max(0, rows.length - 1)) / Math.max(1, rows.length));
  const labelEvery = Math.max(1, Math.ceil(rows.length / 7));
  return <div className="panel min-w-0 p-4 sm:p-5">
    <div className="flex flex-wrap items-end justify-between gap-2"><h2 className="text-sm font-semibold text-ink">{title}</h2><span className="text-xs text-muted">{active ? `${active._id} · ${active.count} clicks` : 'Daily totals (UTC)'}</span></div>
    {!rows.some((row) => row.count > 0) ? <div className="my-4 rounded-xl bg-canvas-subtle px-4 py-8 text-center"><p className="text-sm font-medium text-ink">No activity in this range</p><p className="mt-1 text-xs text-muted">Redirect totals will appear here when a link is visited.</p></div> : <svg className="mt-3 h-44 w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} bar chart`}>
      {rows.map((row, index) => {
        const barHeight = row.count === 0 ? 0 : Math.max(2, (row.count / max) * 130);
        const x = index * (barWidth + barGap);
        const label = row._id.slice(5);
        return <g key={row._id} tabIndex={row.count ? 0 : undefined} aria-label={`${row._id}: ${row.count} clicks`} onPointerEnter={() => setActiveDay(row._id)} onPointerLeave={() => setActiveDay(null)} onFocus={() => setActiveDay(row._id)} onBlur={() => setActiveDay(null)}><title>{`${row._id}: ${row.count} clicks`}</title><rect className="chart-bar" x={x} y={145 - barHeight} width={barWidth} height={barHeight} rx="3" fill="#367c36" opacity="0.9" />{index % labelEvery === 0 && <text x={x} y="170" fontSize="10" fill="#6d786f">{label}</text>}</g>;
      })}
      <line x1="0" y1="145" x2={width} y2="145" stroke="#dfe8dc" />
    </svg>}
  </div>;
}

export function Breakdown({ title, data }) {
  const rows = metricEntries(data);
  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  return <div className="panel p-4 sm:p-5">
    <h3 className="text-sm font-semibold text-ink">{title}</h3>
    {rows.length ? <ul className="mt-3 space-y-2">{rows.slice(0, 6).map(([label, count]) => <li key={label} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate text-[#526052]">{formatAnalyticsLabel(label)}</span><span className="shrink-0 font-semibold text-[#08160e]">{count} <span className="font-normal text-[#718071]">({total ? Math.round(count / total * 100) : 0}%)</span></span></li>)}</ul> : <p className="mt-3 text-sm text-[#718071]">No data in this date range.</p>}
  </div>;
}

export function CountryBreakdown({ countries = [], regions = [], cities = [], label = 'Geographic analytics' }) {
  const total = countries.reduce((sum, country) => sum + country.clicks, 0);
  const max = Math.max(1, ...countries.map((country) => country.clicks));
  return <section className="panel p-4 sm:p-5" aria-label={label}>
    <h3 className="text-sm font-semibold text-ink">Clicks by country</h3>
    {countries.length ? <ol className="mt-3 space-y-3">{countries.slice(0, 10).map((country) => <li key={country.countryCode ?? 'unknown'}>
      <div className="flex justify-between gap-3 text-sm"><span className="truncate text-[#526052]">{formatCountryName(country.countryName, country.countryCode)}{country.countryCode ? <span className="ml-1 text-xs text-[#718071]">({country.countryCode.toLowerCase() === 'unknown' ? 'Unknown' : country.countryCode.toUpperCase()})</span> : null}</span><span className="shrink-0 font-semibold">{country.clicks} <span className="font-normal text-[#718071]">({total ? Math.round(country.clicks / total * 100) : 0}%)</span></span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#edf3e9]"><div className="h-full rounded-full bg-[#429f24]" style={{ width: `${Math.max(2, country.clicks / max * 100)}%` }} /></div>
    </li>)}</ol> : <p className="mt-3 text-sm text-[#718071]">No geographic data in this date range.</p>}
    {cities.length > 0 && <div className="mt-4 border-t border-[#e2ebdd] pt-3"><h4 className="text-xs font-semibold text-[#526052]">Cities with available data</h4><ul className="mt-2 space-y-1">{cities.slice(0, 8).map((city) => <li key={`${city.countryCode}-${city.cityName}`} className="flex justify-between gap-3 text-xs text-[#718071]"><span className="truncate">{formatAnalyticsLabel(city.cityName)}, {formatCountryName(city.countryName, city.countryCode)}</span><span>{city.clicks}</span></li>)}</ul></div>}
    {regions.length > 0 && <div className="mt-4 border-t border-[#e2ebdd] pt-3"><h4 className="text-xs font-semibold text-[#526052]">Regions with available data</h4><ul className="mt-2 space-y-1">{regions.slice(0, 8).map((region) => <li key={`${region.countryCode}-${region.region}`} className="flex justify-between gap-3 text-xs text-[#718071]"><span className="truncate">{formatAnalyticsLabel(region.region)}, {formatCountryName(region.countryName, region.countryCode)}</span><span>{region.clicks}</span></li>)}</ul></div>}
    <p className="mt-3 text-[11px] leading-4 text-[#718071]">Approximate network location from GeoIP data; it may be missing or incorrect. <a className="underline underline-offset-2" href="https://db-ip.com" target="_blank" rel="noreferrer">IP Geolocation by DB-IP</a></p>
  </section>;
}

export function DateRange({ from, to, onChange }) {
  return <div className="panel flex flex-wrap items-end gap-3 p-3 sm:p-4">
    <label className="text-xs font-semibold text-[#526052]">From (UTC)<input type="date" value={from} max={to} onChange={(e) => onChange('from', e.target.value)} className="mt-1 block min-h-10 rounded-lg border border-[#dfe8dc] px-2 text-sm font-normal text-[#08160e]" /></label>
    <label className="text-xs font-semibold text-[#526052]">To (UTC)<input type="date" value={to} min={from} onChange={(e) => onChange('to', e.target.value)} className="mt-1 block min-h-10 rounded-lg border border-[#dfe8dc] px-2 text-sm font-normal text-[#08160e]" /></label>
    <span className="pb-2 text-xs text-[#718071]">Daily buckets use UTC.</span>
  </div>;
}

export function OverviewAnalytics({ analytics, loading, error }) {
  if (loading) return <p className="rounded-xl border border-[#e2ebdd] bg-white p-6 text-center text-sm text-[#526052]" role="status">Loading analytics…</p>;
  if (error) return <p className="rounded-xl border border-[#f1c9c4] bg-[#fff7f5] p-4 text-sm text-[#922d21]" role="alert">{error}</p>;
  const summary = [
    ['Clicks in range', analytics?.totalClicks ?? 0],
    ['Days with activity', analytics?.dailyClicks?.filter((row) => row.count > 0).length ?? 0],
    ['Top referrer', analytics?.topReferrers?.[0]?.hostname ?? '—'],
    ['Top device', formatAnalyticsLabel(metricEntries(analytics?.deviceBreakdown)[0]?.[0], '—')],
  ];
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{summary.map(([label, value]) => <div key={label} className="panel p-4 sm:p-5"><p className="text-xs font-medium text-muted">{label}</p><p className="mt-2 break-words text-2xl font-semibold tracking-tight text-ink">{value}</p></div>)}</div>
    <DailyChart rows={analytics?.dailyClicks} title="Clicks over selected dates" />
    <div className="grid gap-3 md:grid-cols-2"><Breakdown title="Devices" data={analytics?.deviceBreakdown} /><Breakdown title="Top referrers" data={Object.fromEntries((analytics?.topReferrers ?? []).map((item) => [item.hostname, item.clicks]))} /></div>
    <CountryBreakdown countries={analytics?.countries} regions={analytics?.regions} cities={analytics?.cities} label="Overview geographic analytics" />
    <div className="grid gap-3 md:grid-cols-2"><div className="rounded-xl border border-[#e2ebdd] bg-white p-4"><h3 className="text-sm font-semibold text-[#295f22]">Top-performing links</h3>{analytics?.topLinks?.length ? <ol className="mt-3 space-y-2">{analytics.topLinks.slice(0, 5).map((link) => <li key={link.linkId} className="flex justify-between gap-3 text-sm"><span className="truncate">{link.title || link.shortCode}</span><strong>{link.clicks}</strong></li>)}</ol> : <p className="mt-3 text-sm text-[#718071]">No clicks recorded for this date range.</p>}</div>
      <div className="rounded-xl border border-[#e2ebdd] bg-white p-4"><h3 className="text-sm font-semibold text-[#295f22]">Recently created links</h3>{analytics?.recentlyCreatedLinks?.length ? <ol className="mt-3 space-y-2">{analytics.recentlyCreatedLinks.slice(0, 5).map((link) => <li key={link.id} className="flex justify-between gap-3 text-sm"><span className="truncate">{link.title || link.shortCode}</span><time className="shrink-0 text-xs text-[#718071]">{link.createdAt ? new Date(link.createdAt).toLocaleDateString() : ''}</time></li>)}</ol> : <p className="mt-3 text-sm text-[#718071]">No links created yet.</p>}</div></div>
    <p className="rounded-xl bg-canvas-subtle p-3 text-xs leading-5 text-muted">Click counts are redirect requests, not unique visitors or conversions. Device, browser, OS and bot categories are estimates. Declared UTM values come from link setup; observed referrers are hostnames derived from the browser's referrer header and are separate signals.</p>
  </div>;
}

export function LinkAnalytics({ analytics, routing, loading, error }) {
  if (loading) return <p className="mt-4 text-sm text-[#526052]" role="status">Loading link analytics…</p>;
  if (error) return <p className="mt-4 text-sm text-[#922d21]" role="alert">{error}</p>;
  if (!analytics) return null;
  const metricCards = [
    ['Retained redirects (365 days)', analytics.totalClicks],
    ['Selected range', analytics.clicksInRange],
    ['Today (UTC)', analytics.clicksToday],
    ['Last 7 days', analytics.clicksLast7Days],
    ['Last 30 days', analytics.clicksLast30Days],
  ];
  const destinations = analytics.destinations ?? [];
  const showDestinations = Boolean(routing?.enabled || (destinations.length && (routing?.destinations?.length || routing?.rules?.length)));
  const labelForDestination = (destination) => {
    const history = routing?.destinations?.find((entry) => entry.destinationId === destination.destinationId);
    if (history?.ownerId === 'default' || destination.destinationId === 'default') return `Default · ${history?.destinationUrl ?? routing?.defaultDestinationUrl ?? ''}`;
    const ruleId = history?.ownerId ?? destination.matchedRuleId;
    const rule = routing?.rules?.find((entry) => entry.ruleId === ruleId);
    const conditions = [
      rule?.deviceType && `${formatAnalyticsLabel(rule.deviceType)} device`,
      rule?.countryCode && `Country ${rule.countryCode}`,
      (rule?.startAt || rule?.endAt) && `Schedule (${rule.timeZone || 'UTC'})`,
      ...Object.entries(rule?.campaign ?? {}).filter(([, value]) => value).map(([key, value]) => `utm_${key}=${value}`),
    ].filter(Boolean).join(' AND ') || (rule ? 'Always-on rule' : 'Rule');
    return `${conditions} · ${history?.destinationUrl ?? rule?.destinationUrl ?? destination.destinationId}`;
  };
  return <div className="mt-4 space-y-3 border-t border-[#e2ebdd] pt-4">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{metricCards.map(([label, value]) => <div key={label} className="panel p-3"><p className="text-[11px] text-muted">{label}</p><p className="mt-1 text-xl font-semibold tracking-tight text-ink">{value}</p></div>)}</div>
    <DailyChart rows={analytics.dailyClicks} />
    {showDestinations && <section className="rounded-xl border border-[#e2ebdd] bg-white p-4"><h3 className="text-sm font-semibold text-[#295f22]">Clicks by destination</h3><p className="mt-1 text-xs text-[#718071]">Fallback clicks: {analytics.fallbackClicks ?? 0}</p>{destinations.length ? <ul className="mt-3 space-y-2">{destinations.map((destination) => <li key={destination.destinationId} className="flex min-w-0 items-start justify-between gap-3 text-sm"><span className="min-w-0 break-all text-[#526052]">{labelForDestination(destination)}</span><strong className="shrink-0">{destination.clicks}</strong></li>)}</ul> : <p className="mt-2 text-sm text-[#718071]">No destination clicks in this date range.</p>}</section>}
    <CountryBreakdown countries={analytics.countries} regions={analytics.regions} cities={analytics.cities} label="Link geographic analytics" />
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Breakdown title="Devices" data={analytics.deviceBreakdown} /><Breakdown title="Browsers" data={analytics.browserBreakdown} /><Breakdown title="Operating systems" data={analytics.operatingSystemBreakdown} /><Breakdown title="Top referrers" data={Object.fromEntries(analytics.topReferrers.map((item) => [item.hostname, item.clicks]))} /><Breakdown title="Bot estimate" data={{ bots: analytics.botBreakdown.bots, 'non-bots': analytics.botBreakdown.nonBots }} /></div>
  </div>;
}
