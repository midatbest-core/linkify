import { useEffect, useRef, useState } from 'react';
import { flowApi } from '../utils/flowApi.js';

export default function FlowSimulator({ flowId, creatorTimeZone, eventStartLocal, eventEndLocal }) {
  const [localDateTime, setLocalDateTime] = useState(() => {
    if (eventStartLocal) return eventStartLocal;
    const now = new Date();
    try {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
          timeZone: creatorTimeZone,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
      );
      return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    } catch {
      return now.toISOString().slice(0, 16);
    }
  });

  const [disambiguation, setDisambiguation] = useState('earlier');
  const [deviceType, setDeviceType] = useState('unknown');
  const [countryCode, setCountryCode] = useState('');
  const [utmSource, setUtmSource] = useState('');
  const [utmMedium, setUtmMedium] = useState('');
  const [utmCampaign, setUtmCampaign] = useState('');

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    let ignore = false;
    const currentId = ++requestId.current;
    setLoading(true);
    setError('');

    const query = {};
    if (utmSource.trim()) query.utm_source = utmSource.trim();
    if (utmMedium.trim()) query.utm_medium = utmMedium.trim();
    if (utmCampaign.trim()) query.utm_campaign = utmCampaign.trim();

    flowApi.simulate(flowId, {
      localDateTime,
      disambiguation,
      deviceType,
      countryCode: countryCode.trim() ? countryCode.trim().toUpperCase() : null,
      query,
    })
      .then((data) => {
        if (!ignore && currentId === requestId.current) {
          setResult(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore && currentId === requestId.current) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { ignore = true; };
  }, [flowId, localDateTime, disambiguation, deviceType, countryCode, utmSource, utmMedium, utmCampaign]);

  return (
    <section className="flow-simulator panel p-4 sm:p-6 lg:p-7" aria-labelledby="simulator-heading">
      <div className="flow-simulator__header border-b border-line pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">TIME-TRAVEL SIMULATOR</p>
            <h2 id="simulator-heading" className="mt-1 text-2xl font-semibold tracking-tight">Routing preview</h2>
            <p className="mt-1 text-sm text-muted">
              Inspect server-authoritative routing at any date, time, and audience context in <strong>{creatorTimeZone}</strong>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {result?.isArchived && (
              <span className="status-pill status-archived">Archived (HTTP 410 live)</span>
            )}
            <span className="status-pill status-off">Server-evaluated preview</span>
          </div>
        </div>
      </div>

      {result?.isArchived && (
        <div className="mt-4 rounded-xl border border-[#ded5c9] bg-[#f3eee7] p-3 text-xs text-[#6b5945]" role="alert">
          <strong>Flow is currently archived:</strong> Live visitors to its permanent link receive HTTP 410 Gone. The preview below reflects the published configuration that will take effect upon restoration.
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        {/* Controls Column */}
        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-xl border border-line bg-canvas-subtle p-4">
            <h3 className="text-sm font-semibold text-ink">Date & Time in {creatorTimeZone}</h3>
            <label className="mt-3 block text-xs font-medium text-muted">
              Local schedule time
              <input
                type="datetime-local"
                value={localDateTime}
                onChange={(e) => setLocalDateTime(e.target.value)}
                className="field-control mt-1 w-full bg-white font-mono text-sm"
              />
            </label>

            {result?.ambiguous && (
              <fieldset className="mt-3 rounded-lg border border-line bg-surface p-2.5">
                <legend className="text-xs font-semibold text-ink">Ambiguous Local Time (DST Fold)</legend>
                <div className="mt-1 flex gap-3 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="disambiguation"
                      value="earlier"
                      checked={disambiguation === 'earlier'}
                      onChange={() => setDisambiguation('earlier')}
                    />
                    First occurrence (earlier)
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="disambiguation"
                      value="later"
                      checked={disambiguation === 'later'}
                      onChange={() => setDisambiguation('later')}
                    />
                    Second occurrence (later)
                  </label>
                </div>
              </fieldset>
            )}

            {/* Quick jump boundaries */}
            {result?.boundaries && result.boundaries.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="text-xs font-semibold text-muted">Jump to stage boundary:</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.boundaries.map((b, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="button-quiet text-xs rounded-md border border-line bg-white px-2 py-1 hover:border-brand"
                      onClick={() => setLocalDateTime(b.localDateTime)}
                      title={`Jump to ${b.utc}`}
                    >
                      {b.localDateTime.replace('T', ' ')}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Context Options */}
          <div className="rounded-xl border border-line bg-canvas-subtle p-4 space-y-3">
            <h3 className="text-sm font-semibold text-ink">Visitor Context</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-medium text-muted">
                Device type
                <select
                  value={deviceType}
                  onChange={(e) => setDeviceType(e.target.value)}
                  className="field-control mt-1 w-full bg-white text-xs"
                >
                  <option value="unknown">All / Unknown</option>
                  <option value="mobile">Mobile</option>
                  <option value="desktop">Desktop</option>
                  <option value="tablet">Tablet</option>
                </select>
              </label>

              <label className="text-xs font-medium text-muted">
                Country (2-letter code)
                <input
                  type="text"
                  maxLength={2}
                  value={countryCode}
                  placeholder="US, IN, GB..."
                  onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
                  className="field-control mt-1 w-full bg-white text-xs uppercase"
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-line">
              <label className="text-[11px] font-medium text-muted">
                utm_source
                <input
                  type="text"
                  value={utmSource}
                  placeholder="newsletter"
                  onChange={(e) => setUtmSource(e.target.value)}
                  className="field-control mt-1 w-full bg-white text-xs"
                />
              </label>
              <label className="text-[11px] font-medium text-muted">
                utm_medium
                <input
                  type="text"
                  value={utmMedium}
                  placeholder="email"
                  onChange={(e) => setUtmMedium(e.target.value)}
                  className="field-control mt-1 w-full bg-white text-xs"
                />
              </label>
              <label className="text-[11px] font-medium text-muted">
                utm_campaign
                <input
                  type="text"
                  value={utmCampaign}
                  placeholder="launch"
                  onChange={(e) => setUtmCampaign(e.target.value)}
                  className="field-control mt-1 w-full bg-white text-xs"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Results Column */}
        <div className="space-y-4 lg:col-span-7">
          {error && (
            <div className="rounded-xl border border-[#e3b7ae] bg-[#fff4f0] p-4 text-sm text-[#8b372b]" role="alert">
              <strong>Simulation error:</strong> {error}
            </div>
          )}

          {loading && !result && (
            <div className="p-8 text-center text-sm text-muted">
              Evaluating routing simulation…
            </div>
          )}

          {result && (
            <div className="space-y-4">
              {/* Draft vs Published Side-by-Side */}
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Draft routing card */}
                <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-muted">DRAFT ROUTING</span>
                    <span className={`status-pill ${result.draft?.usedFallback ? 'status-off' : 'status-on'}`}>
                      {result.draft?.usedFallback ? 'Fallback' : 'Stage match'}
                    </span>
                  </div>
                  {result.draftError ? (
                    <p className="mt-3 text-xs text-danger">{result.draftError}</p>
                  ) : result.draft ? (
                    <div className="mt-3 space-y-2">
                      <div>
                        <span className="text-xs text-muted">Matched stage:</span>
                        <p className="text-sm font-semibold text-ink">{result.draft.stageLabel}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted">Resolved destination:</span>
                        <a
                          href={result.draft.destinationUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block break-all text-xs font-semibold text-brand-strong underline"
                        >
                          {result.draft.destinationUrl}
                        </a>
                      </div>
                      <div className="rounded-lg bg-canvas-subtle p-2 text-xs text-muted">
                        <strong className="block text-ink mb-0.5">Condition match:</strong>
                        {result.draft.conditionSummary}
                      </div>
                      {result.draft.fallbackReason && (
                        <p className="text-xs text-[#876b34] bg-[#fff9ed] p-2 rounded-lg">
                          {result.draft.fallbackReason}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-muted">No draft configuration available.</p>
                  )}
                </div>

                {/* Published routing card */}
                <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-muted">LIVE PUBLISHED</span>
                    {result.published ? (
                      <span className={`status-pill ${result.published.usedFallback ? 'status-off' : 'status-on'}`}>
                        {result.published.usedFallback ? 'Fallback' : 'Stage match'}
                      </span>
                    ) : (
                      <span className="status-pill status-off">Not published</span>
                    )}
                  </div>
                  {result.published ? (
                    <div className="mt-3 space-y-2">
                      <div>
                        <span className="text-xs text-muted">Matched stage:</span>
                        <p className="text-sm font-semibold text-ink">{result.published.stageLabel}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted">Resolved destination:</span>
                        <a
                          href={result.published.destinationUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block break-all text-xs font-semibold text-brand-strong underline"
                        >
                          {result.published.destinationUrl}
                        </a>
                      </div>
                      <div className="rounded-lg bg-canvas-subtle p-2 text-xs text-muted">
                        <strong className="block text-ink mb-0.5">Condition match:</strong>
                        {result.published.conditionSummary}
                      </div>
                      {result.published.fallbackReason && (
                        <p className="text-xs text-[#876b34] bg-[#fff9ed] p-2 rounded-lg">
                          {result.published.fallbackReason}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-muted">
                      This Flow is not published yet. Visitors currently cannot reach any live link.
                    </p>
                  )}
                </div>
              </div>

              {/* Parity Status Indicator */}
              {result.published && result.draft && (
                <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${result.published.destinationUrl === result.draft.destinationUrl ? 'bg-[#eef6e9] border-[#b9d0b2] text-[#245b2b]' : 'bg-[#fff9ed] border-[#e4d3a2] text-[#876b34]'}`}>
                  <span className="font-bold">
                    {result.published.destinationUrl === result.draft.destinationUrl ? '✓ Parity match:' : '⚠ Routing divergence:'}
                  </span>
                  <span>
                    {result.published.destinationUrl === result.draft.destinationUrl
                      ? 'Draft and published configurations route to the exact same destination at this instant.'
                      : 'Draft routing differs from published live routing at this instant.'}
                  </span>
                </div>
              )}

              {/* Simulation Note */}
              <p className="text-xs text-muted border-t border-line pt-3">
                {result.note}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
