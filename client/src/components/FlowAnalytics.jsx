import { useEffect, useState } from 'react';
import { flowApi } from '../utils/flowApi.js';

function dateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function FlowAnalytics({ flowId, publication, initialData = null }) {
  const [rangePreset, setRangePreset] = useState('last7Days');
  const [customFrom, setCustomFrom] = useState(() => dateDaysAgo(7));
  const [customTo, setCustomTo] = useState(() => dateDaysAgo(0));

  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(!initialData && Boolean(publication));
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError('');

    let params = {};
    if (rangePreset === 'today') {
      params = { from: dateDaysAgo(0), to: dateDaysAgo(0) };
    } else if (rangePreset === 'last7Days') {
      params = { from: dateDaysAgo(6), to: dateDaysAgo(0) };
    } else if (rangePreset === 'last30Days') {
      params = { from: dateDaysAgo(29), to: dateDaysAgo(0) };
    } else if (rangePreset === 'custom') {
      params = { from: customFrom, to: customTo };
    }

    flowApi.analytics(flowId, params)
      .then((res) => {
        if (!ignore) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { ignore = true; };
  }, [flowId, rangePreset, customFrom, customTo]);

  if (loading && !data) {
    return (
      <section className="flow-analytics panel p-6 lg:p-8" aria-labelledby="analytics-heading">
        <h2 id="analytics-heading" className="text-xl font-semibold">Loading flow analytics…</h2>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="panel skeleton h-24" />)}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="flow-analytics panel p-6 lg:p-8" aria-labelledby="analytics-heading">
        <h2 id="analytics-heading" className="text-xl font-semibold text-danger">Analytics unavailable</h2>
        <p className="mt-2 text-sm text-muted">{error}</p>
      </section>
    );
  }

  // 1. Unpublished State
  if (data?.state === 'unpublished' || !publication) {
    return (
      <section className="flow-analytics panel p-6 lg:p-8 text-center" aria-labelledby="analytics-heading">
        <div className="mx-auto max-w-md py-8">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-canvas-subtle text-xl text-muted" aria-hidden="true">
            ◰
          </div>
          <h2 id="analytics-heading" className="mt-4 text-xl font-semibold tracking-tight">Flow is not published</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Click analytics are recorded once the Flow is published and visitors access its permanent short URL.
          </p>
        </div>
      </section>
    );
  }

  const { analytics } = data;

  return (
    <section className="flow-analytics panel p-4 sm:p-6 lg:p-8" aria-labelledby="analytics-heading">
      {/* Header and Date Filter */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-5">
        <div>
          <p className="eyebrow">LINKIFY FLOWS / INSIGHTS</p>
          <h2 id="analytics-heading" className="mt-1 text-2xl font-semibold tracking-tight">Flow analytics</h2>
          <p className="mt-1 text-xs text-muted">
            Aggregated visitor engagement across scheduled stages and permanent destination URLs.
          </p>
        </div>

        {/* Date Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-canvas-subtle p-1 text-xs">
          <button
            type="button"
            className={`rounded-lg px-2.5 py-1.5 font-medium transition ${rangePreset === 'today' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            onClick={() => setRangePreset('today')}
          >
            Today
          </button>
          <button
            type="button"
            className={`rounded-lg px-2.5 py-1.5 font-medium transition ${rangePreset === 'last7Days' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            onClick={() => setRangePreset('last7Days')}
          >
            Last 7 days
          </button>
          <button
            type="button"
            className={`rounded-lg px-2.5 py-1.5 font-medium transition ${rangePreset === 'last30Days' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            onClick={() => setRangePreset('last30Days')}
          >
            Last 30 days
          </button>
          <button
            type="button"
            className={`rounded-lg px-2.5 py-1.5 font-medium transition ${rangePreset === 'custom' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            onClick={() => setRangePreset('custom')}
          >
            Custom
          </button>
        </div>
      </div>

      {rangePreset === 'custom' && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-canvas-subtle p-3 text-xs">
          <label className="flex items-center gap-2">
            <span className="text-muted">From:</span>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="field-control bg-white text-xs"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted">To:</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="field-control bg-white text-xs"
            />
          </label>
        </div>
      )}

      {/* 2. Empty State (Published but 0 clicks in range) */}
      {data.state === 'empty' ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line bg-canvas-subtle p-8 text-center">
          <p className="text-base font-semibold text-ink">No clicks recorded in this date range</p>
          <p className="mt-1 text-xs text-muted max-w-md mx-auto">
            Your Flow is active at{' '}
            <a href={publication.shortUrl} target="_blank" rel="noreferrer" className="text-brand-strong underline">
              {publication.shortUrl}
            </a>
            . Clicks will populate here as visitors are routed.
          </p>
        </div>
      ) : (
        /* 3. Populated Metrics */
        <div className="mt-6 space-y-6">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-xl border border-line bg-surface p-4">
              <span className="text-xs font-medium text-muted">All-time clicks</span>
              <p className="mt-1 text-2xl font-bold tracking-tight text-ink">{analytics.totalClicks}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <span className="text-xs font-medium text-muted">In selected range</span>
              <p className="mt-1 text-2xl font-bold tracking-tight text-brand-strong">{analytics.clicksInRange}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <span className="text-xs font-medium text-muted">Clicks today</span>
              <p className="mt-1 text-2xl font-bold tracking-tight text-ink">{analytics.clicksToday}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <span className="text-xs font-medium text-muted">Last 7 days</span>
              <p className="mt-1 text-2xl font-bold tracking-tight text-ink">{analytics.clicksLast7Days}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <span className="text-xs font-medium text-muted">Last 30 days</span>
              <p className="mt-1 text-2xl font-bold tracking-tight text-ink">{analytics.clicksLast30Days}</p>
            </div>
          </div>

          {/* Stage & Destination Distribution Table */}
          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="border-b border-line bg-canvas-subtle px-4 py-3">
              <h3 className="text-sm font-semibold text-ink">Stage & Destination Attribution</h3>
              <p className="text-xs text-muted">Clicks attributed to specific lifecycle stages and destinations.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-muted bg-[#fafbfa]">
                    <th className="px-4 py-2.5 font-semibold">Stage</th>
                    <th className="px-4 py-2.5 font-semibold">Destination URL</th>
                    <th className="px-4 py-2.5 font-semibold">Attribution status</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Clicks</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(analytics.destinations ?? []).map((row, idx) => {
                    const share = analytics.clicksInRange ? Math.round((row.clicks / analytics.clicksInRange) * 100) : 0;
                    return (
                      <tr key={idx} className="hover:bg-canvas-subtle">
                        <td className="px-4 py-3 font-semibold text-ink">
                          {row.stageLabel || row.stageId || 'Unknown'}
                        </td>
                        <td className="px-4 py-3 max-w-xs truncate">
                          {row.destinationUrl ? (
                            <a href={row.destinationUrl} target="_blank" rel="noreferrer" className="text-brand-strong underline truncate block">
                              {row.destinationUrl}
                            </a>
                          ) : (
                            <span className="text-muted italic">Unavailable</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {row.attribution === 'unknown' ? (
                            <span className="rounded-full bg-[#f3eee7] px-2 py-0.5 text-[11px] font-medium text-[#6b5945]">
                              Unknown attribution
                            </span>
                          ) : row.historical ? (
                            <span className="rounded-full bg-[#fbf0df] px-2 py-0.5 text-[11px] font-medium text-[#875d19]">
                              Historical destination
                            </span>
                          ) : (
                            <span className="rounded-full bg-[#e9f5e3] px-2 py-0.5 text-[11px] font-medium text-[#295f22]">
                              Current destination
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-ink">
                          {row.clicks}
                        </td>
                        <td className="px-4 py-3 text-right text-muted">
                          {share}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Fallback Engagement & Daily Series */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-4">
              <h3 className="text-sm font-semibold text-ink">Fallback Destination Engagement</h3>
              <p className="mt-1 text-xs text-muted">
                Visitors who did not match any scheduled window and were served the fallback destination.
              </p>
              <div className="mt-4 flex items-baseline gap-3">
                <span className="text-3xl font-bold text-ink">
                  {analytics.fallbackEngagement?.clicks ?? 0}
                </span>
                <span className="text-xs text-muted">
                  ({analytics.fallbackEngagement?.percentage ?? 0}% of visits in range)
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-line bg-surface p-4">
              <h3 className="text-sm font-semibold text-ink">Daily Engagement Summary</h3>
              <div className="mt-3 max-h-36 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th className="py-1">Date (UTC)</th>
                      <th className="py-1 text-right">Clicks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {(analytics.dailyClicks ?? []).slice(-7).map((d) => (
                      <tr key={d._id}>
                        <td className="py-1 font-mono text-muted">{d._id}</td>
                        <td className="py-1 text-right font-semibold text-ink">{d.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Breakdown Grids: Devices, Browsers, Countries, Referrers */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Devices */}
            <div className="rounded-xl border border-line bg-surface p-4">
              <h4 className="text-xs font-bold text-muted uppercase">Device Breakdown</h4>
              <ul className="mt-3 space-y-1.5 text-xs">
                {Object.entries(analytics.deviceBreakdown ?? {}).map(([key, count]) => (
                  <li key={key} className="flex justify-between py-0.5 border-b border-line last:border-0">
                    <span className="capitalize text-muted">{key}</span>
                    <strong className="text-ink">{count}</strong>
                  </li>
                ))}
              </ul>
            </div>

            {/* Browsers */}
            <div className="rounded-xl border border-line bg-surface p-4">
              <h4 className="text-xs font-bold text-muted uppercase">Browser Breakdown</h4>
              <ul className="mt-3 space-y-1.5 text-xs">
                {Object.entries(analytics.browserBreakdown ?? {}).map(([key, count]) => (
                  <li key={key} className="flex justify-between py-0.5 border-b border-line last:border-0">
                    <span className="text-muted">{key}</span>
                    <strong className="text-ink">{count}</strong>
                  </li>
                ))}
              </ul>
            </div>

            {/* Countries */}
            <div className="rounded-xl border border-line bg-surface p-4">
              <h4 className="text-xs font-bold text-muted uppercase">Geographic Breakdown</h4>
              <ul className="mt-3 space-y-1.5 text-xs">
                {(analytics.countries ?? []).map((c, i) => (
                  <li key={i} className="flex justify-between py-0.5 border-b border-line last:border-0">
                    <span className="text-muted">{c.countryName || c.countryCode || 'Unknown'}</span>
                    <strong className="text-ink">{c.count}</strong>
                  </li>
                ))}
              </ul>
            </div>

            {/* Referrers */}
            <div className="rounded-xl border border-line bg-surface p-4">
              <h4 className="text-xs font-bold text-muted uppercase">Referrer Breakdown</h4>
              {!(analytics.topReferrers?.length) ? (
                <p className="mt-3 text-xs text-muted">Direct or unknown traffic</p>
              ) : (
                <ul className="mt-3 space-y-1.5 text-xs">
                  {analytics.topReferrers.map((r, i) => (
                    <li key={i} className="flex justify-between py-0.5 border-b border-line last:border-0 truncate">
                      <span className="text-muted truncate pr-2">{r.hostname || 'Direct'}</span>
                      <strong className="text-ink shrink-0">{r.clicks}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
