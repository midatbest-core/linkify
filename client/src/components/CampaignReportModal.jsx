import { useEffect, useState } from 'react';
import { authenticatedFetch } from '../utils/authenticatedFetch.js';

const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:5000' : '');

export default function CampaignReportModal({ linkId, onClose }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchReport() {
      setLoading(true);
      setError('');
      try {
        const res = await authenticatedFetch(`${API_URL}/api/links/${encodeURIComponent(linkId)}/campaign-report`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Failed to load campaign report.');
        if (!cancelled) setReport(data.report);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load campaign data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (linkId) fetchReport();
    return () => { cancelled = true; };
  }, [linkId]);

  function handlePrint() {
    window.print();
  }

  function handleExportCsv() {
    window.open(`${API_URL}/api/links/${encodeURIComponent(linkId)}/campaign-report/export`, '_blank');
  }

  function copyShortUrl() {
    if (!report?.link) return;
    const shortUrl = `${window.location.origin}/${report.link.shortCode}`;
    navigator.clipboard.writeText(shortUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print:static print:bg-white print:p-0">
      <div className="campaign-modal-card relative max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-line bg-canvas p-6 shadow-2xl print:max-h-none print:w-full print:border-none print:shadow-none print:p-2">
        {/* Modal Controls (Hidden in Print) */}
        <div className="flex items-center justify-between border-b border-line pb-4 print:hidden">
          <div className="flex items-center gap-2">
            <span className="brand-mark size-6 text-brand">✦</span>
            <h2 className="text-lg font-bold text-ink">Campaign Management Report</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="button-ghost min-h-9 px-3 text-xs"
              onClick={handleExportCsv}
              disabled={loading || !report}
            >
              ⬇ Export CSV
            </button>
            <button
              type="button"
              className="button-ghost min-h-9 px-3 text-xs"
              onClick={handlePrint}
              disabled={loading || !report}
            >
              ⎙ Print Report
            </button>
            <button
              type="button"
              className="button-ghost min-h-9 px-3 text-xs text-muted hover:text-ink"
              onClick={onClose}
              aria-label="Close report"
            >
              ✕
            </button>
          </div>
        </div>

        {loading && (
          <div className="py-16 text-center text-sm text-muted">
            <div className="spinner mb-2 inline-block size-6 animate-spin rounded-full border-2 border-brand border-t-transparent"></div>
            <p>Compiling campaign performance metrics…</p>
          </div>
        )}

        {error && (
          <div className="my-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {report && (
          <div className="print-report-container mt-6 space-y-6">
            {/* Header info */}
            <div className="rounded-xl border border-line bg-canvas-subtle p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-bold text-ink">{report.link.title || 'Untitled Campaign Link'}</h1>
                  <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                    <span className="font-mono text-brand-strong">/{report.link.shortCode}</span>
                    <span>→</span>
                    <span className="max-w-md truncate">{report.link.originalUrl}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2 print:hidden">
                  <button
                    type="button"
                    className="button-ghost min-h-8 px-2.5 text-xs"
                    onClick={copyShortUrl}
                  >
                    {copied ? '✓ Copied URL' : 'Copy Short URL'}
                  </button>
                </div>
              </div>
            </div>

            {/* Executive Metric Cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-line bg-canvas p-3 text-center">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Lifetime Redirects</span>
                <p className="mt-1 text-2xl font-black text-ink">{report.link.lifetimeRedirectCount}</p>
                <span className="text-[10px] text-muted">Atomic executions</span>
              </div>
              <div className="rounded-xl border border-line bg-canvas p-3 text-center">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Allowed Clicks</span>
                <p className="mt-1 text-2xl font-black text-emerald-800">{report.summary.range.allowedRedirects}</p>
                <span className="text-[10px] text-muted">Successful redirects</span>
              </div>
              <div className="rounded-xl border border-line bg-canvas p-3 text-center">
                <span className="text-[11px] font-bold uppercase tracking-wider text-red-700">Blocked Attempts</span>
                <p className="mt-1 text-2xl font-black text-red-800">{report.summary.range.blockedAttempts}</p>
                <span className="text-[10px] text-muted">Access challenges &amp; caps</span>
              </div>
              <div className="rounded-xl border border-line bg-canvas p-3 text-center">
                <span className="text-[11px] font-bold uppercase tracking-wider text-brand-strong">Cap Remaining</span>
                <p className="mt-1 text-2xl font-black text-ink">
                  {report.capStatus.remainingClicks !== null ? report.capStatus.remainingClicks : '∞'}
                </p>
                <span className="text-[10px] text-muted">
                  {report.capStatus.maxClicks ? `of ${report.capStatus.maxClicks} cap` : 'Uncapped'}
                </span>
              </div>
            </div>

            {/* Access Protection Status & Breakdown */}
            <div className="rounded-xl border border-line bg-canvas p-4">
              <h3 className="text-sm font-bold text-ink">Access Protection Status</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-3 text-xs">
                <div className="rounded-lg border border-line bg-canvas-subtle p-3">
                  <span className="font-semibold text-ink">Password Protection</span>
                  <p className="mt-1 text-muted">
                    {report.link.protection.hasPassword ? 'Enabled (Scrypt + HMAC unlock cookie)' : 'Disabled'}
                  </p>
                  <p className="mt-1 text-[11px] font-medium text-red-700">
                    {report.summary.range.blockedBreakdown.password} blocked password attempt(s)
                  </p>
                </div>
                <div className="rounded-lg border border-line bg-canvas-subtle p-3">
                  <span className="font-semibold text-ink">Expiration Date</span>
                  <p className="mt-1 text-muted">
                    {report.link.protection.expiresAt ? new Date(report.link.protection.expiresAt).toLocaleString() : 'No expiration set'}
                  </p>
                  <p className="mt-1 text-[11px] font-medium text-red-700">
                    {report.summary.range.blockedBreakdown.expired} blocked after expiration
                  </p>
                </div>
                <div className="rounded-lg border border-line bg-canvas-subtle p-3">
                  <span className="font-semibold text-ink">Redirect Limit Cap</span>
                  <p className="mt-1 text-muted">
                    {report.capStatus.maxClicks ? `${report.link.lifetimeRedirectCount} / ${report.capStatus.maxClicks} clicks` : 'No click limit'}
                  </p>
                  <p className="mt-1 text-[11px] font-medium text-red-700">
                    {report.summary.range.blockedBreakdown.maxClicks} blocked at cap limit
                  </p>
                </div>
              </div>

              {/* Progress bar if cap exists */}
              {report.capStatus.maxClicks && (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-muted">
                    <span>Usage: {Math.min(100, Math.round((report.link.lifetimeRedirectCount / report.capStatus.maxClicks) * 100))}%</span>
                    <span>{report.capStatus.capReached ? 'CAP REACHED (Link Closed)' : 'Active'}</span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-line">
                    <div
                      style={{ width: `${Math.min(100, (report.link.lifetimeRedirectCount / report.capStatus.maxClicks) * 100)}%` }}
                      className={`h-full transition-all ${report.capStatus.capReached ? 'bg-red-600' : 'bg-brand'}`}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* A/B Experiment Performance */}
            {report.experiments && report.experiments.length > 0 && (
              <div className="rounded-xl border border-line bg-canvas p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-ink">A/B Traffic Experiment Performance</h3>
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-strong">
                    2 Variants
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {report.experiments.map((variant) => (
                    <div key={variant.variantId} className="rounded-xl border border-line bg-canvas-subtle p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-brand-strong">{variant.label}</span>
                        <span className="text-xs font-semibold text-muted">Configured: {variant.weight}%</span>
                      </div>
                      <p className="mt-2 text-2xl font-black text-ink">{variant.clicks} clicks</p>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted">
                        <span>Actual Traffic Share:</span>
                        <span className="font-bold text-ink">{variant.trafficPercentage}%</span>
                      </div>
                      <p className="mt-2 truncate text-[11px] text-muted" title={variant.destinationUrl}>
                        Destination: {variant.destinationUrl}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Audience Breakdowns */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-line bg-canvas p-4 text-xs">
                <h4 className="font-bold text-ink">Device Breakdown</h4>
                <div className="mt-3 space-y-1.5">
                  {Object.entries(report.deviceBreakdown).length > 0 ? (
                    Object.entries(report.deviceBreakdown).map(([device, count]) => (
                      <div key={device} className="flex justify-between">
                        <span className="capitalize text-muted">{device}</span>
                        <span className="font-semibold text-ink">{count}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted">No device data in selected range.</p>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-line bg-canvas p-4 text-xs">
                <h4 className="font-bold text-ink">Top Countries</h4>
                <div className="mt-3 space-y-1.5">
                  {report.topCountries && report.topCountries.length > 0 ? (
                    report.topCountries.slice(0, 5).map((c) => (
                      <div key={c.countryCode} className="flex justify-between">
                        <span className="text-muted">{c.countryName} ({c.countryCode})</span>
                        <span className="font-semibold text-ink">{c.clicks}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted">No geographic data in selected range.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-line pt-4 text-center text-xs text-muted">
              Campaign report generated by Linkify • {new Date().toUTCString()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
