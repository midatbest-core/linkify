function metricEntries(data) {
  return Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
}

export function DailyChart({ rows = [], title = 'Daily clicks' }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  const width = 640;
  const height = 190;
  const barGap = rows.length > 45 ? 0 : 5;
  const barWidth = Math.max(1, (width - barGap * Math.max(0, rows.length - 1)) / Math.max(1, rows.length));
  const labelEvery = Math.max(1, Math.ceil(rows.length / 7));
  return <div className="rounded-xl border border-[#e2ebdd] bg-white p-4">
    <h3 className="text-sm font-semibold text-[#295f22]">{title}</h3>
    {!rows.some((row) => row.count > 0) ? <p className="py-8 text-center text-sm text-[#718071]">No click activity in this date range.</p> : <svg className="mt-3 h-44 w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} bar chart`}>
      {rows.map((row, index) => {
        const barHeight = row.count === 0 ? 0 : Math.max(2, (row.count / max) * 130);
        const x = index * (barWidth + barGap);
        const label = row._id.slice(5);
        return <g key={row._id}><title>{`${row._id}: ${row.count} clicks`}</title><rect x={x} y={145 - barHeight} width={barWidth} height={barHeight} rx="2" fill="#429F24" opacity="0.85" />{index % labelEvery === 0 && <text x={x} y="170" fontSize="10" fill="#718071">{label}</text>}</g>;
      })}
      <line x1="0" y1="145" x2={width} y2="145" stroke="#dfe8dc" />
    </svg>}
  </div>;
}

export function Breakdown({ title, data }) {
  const rows = metricEntries(data);
  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  return <div className="rounded-xl border border-[#e2ebdd] bg-white p-4">
    <h3 className="text-sm font-semibold text-[#295f22]">{title}</h3>
    {rows.length ? <ul className="mt-3 space-y-2">{rows.slice(0, 6).map(([label, count]) => <li key={label} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate text-[#526052]">{label}</span><span className="shrink-0 font-semibold text-[#08160e]">{count} <span className="font-normal text-[#718071]">({total ? Math.round(count / total * 100) : 0}%)</span></span></li>)}</ul> : <p className="mt-3 text-sm text-[#718071]">No data in this date range.</p>}
  </div>;
}

export function DateRange({ from, to, onChange }) {
  return <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[#e2ebdd] bg-white p-3">
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
    ['Top device', metricEntries(analytics?.deviceBreakdown)[0]?.[0] ?? '—'],
  ];
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{summary.map(([label, value]) => <div key={label} className="rounded-xl border border-[#e2ebdd] bg-white p-4"><p className="text-xs font-medium text-[#718071]">{label}</p><p className="mt-1 break-words text-xl font-semibold text-[#08160e]">{value}</p></div>)}</div>
    <DailyChart rows={analytics?.dailyClicks} title="Clicks over selected dates" />
    <div className="grid gap-3 md:grid-cols-2"><Breakdown title="Devices" data={analytics?.deviceBreakdown} /><Breakdown title="Top referrers" data={Object.fromEntries((analytics?.topReferrers ?? []).map((item) => [item.hostname, item.clicks]))} /></div>
    <div className="grid gap-3 md:grid-cols-2"><div className="rounded-xl border border-[#e2ebdd] bg-white p-4"><h3 className="text-sm font-semibold text-[#295f22]">Top-performing links</h3>{analytics?.topLinks?.length ? <ol className="mt-3 space-y-2">{analytics.topLinks.slice(0, 5).map((link) => <li key={link.linkId} className="flex justify-between gap-3 text-sm"><span className="truncate">{link.title || link.shortCode}</span><strong>{link.clicks}</strong></li>)}</ol> : <p className="mt-3 text-sm text-[#718071]">No clicks recorded for this date range.</p>}</div>
      <div className="rounded-xl border border-[#e2ebdd] bg-white p-4"><h3 className="text-sm font-semibold text-[#295f22]">Recently created links</h3>{analytics?.recentlyCreatedLinks?.length ? <ol className="mt-3 space-y-2">{analytics.recentlyCreatedLinks.slice(0, 5).map((link) => <li key={link.id} className="flex justify-between gap-3 text-sm"><span className="truncate">{link.title || link.shortCode}</span><time className="shrink-0 text-xs text-[#718071]">{link.createdAt ? new Date(link.createdAt).toLocaleDateString() : ''}</time></li>)}</ol> : <p className="mt-3 text-sm text-[#718071]">No links created yet.</p>}</div></div>
    <p className="text-xs leading-5 text-[#718071]">Click counts are redirect requests, not unique visitors or conversions. Device, browser, OS and bot categories are estimates. Referrers are hostnames only.</p>
  </div>;
}

export function LinkAnalytics({ analytics, loading, error }) {
  if (loading) return <p className="mt-4 text-sm text-[#526052]" role="status">Loading link analytics…</p>;
  if (error) return <p className="mt-4 text-sm text-[#922d21]" role="alert">{error}</p>;
  if (!analytics) return null;
  const metricCards = [
    ['Retained redirects (≤365d)', analytics.totalClicks],
    ['Selected range', analytics.clicksInRange],
    ['Today (UTC)', analytics.clicksToday],
    ['Last 7 days', analytics.clicksLast7Days],
    ['Last 30 days', analytics.clicksLast30Days],
  ];
  return <div className="mt-4 space-y-3 border-t border-[#e2ebdd] pt-4">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{metricCards.map(([label, value]) => <div key={label} className="rounded-lg bg-[#f5f9f2] p-3"><p className="text-[11px] text-[#718071]">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>)}</div>
    <DailyChart rows={analytics.dailyClicks} />
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Breakdown title="Devices" data={analytics.deviceBreakdown} /><Breakdown title="Browsers" data={analytics.browserBreakdown} /><Breakdown title="Operating systems" data={analytics.operatingSystemBreakdown} /><Breakdown title="Top referrers" data={Object.fromEntries(analytics.topReferrers.map((item) => [item.hostname, item.clicks]))} /><Breakdown title="Bot estimate" data={{ bots: analytics.botBreakdown.bots, 'non-bots': analytics.botBreakdown.nonBots }} /></div>
  </div>;
}
