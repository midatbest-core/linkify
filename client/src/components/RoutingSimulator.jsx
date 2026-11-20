import { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:5000' : '');
const nowLocal = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

export default function RoutingSimulator({ link, onClose }) {
  const [deviceType, setDeviceType] = useState('mobile');
  const [countryCode, setCountryCode] = useState('unknown');
  const [time, setTime] = useState(nowLocal());
  const [query, setQuery] = useState({ utm_source: '', utm_medium: '', utm_campaign: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function simulate(event) {
    event.preventDefault(); setLoading(true); setError(''); setResult(null);
    try {
      const response = await fetch(`${API_URL}/api/links/${encodeURIComponent(link.id)}/simulate`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceType, countryCode, now: new Date(time).toISOString(), query: Object.fromEntries(Object.entries(query).filter(([, value]) => value)) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not simulate this route.');
      setResult(data.simulation);
    } catch (cause) { setError(cause.message || 'Could not reach Linkify.'); }
    finally { setLoading(false); }
  }
  return <section className="mt-4 rounded-2xl border border-[#cbdcc2] bg-[#f7faf4] p-4 sm:p-5" aria-labelledby="simulator-title">
    <div className="flex items-start justify-between gap-3"><div><p className="eyebrow !text-brand">READ-ONLY PREVIEW</p><h3 id="simulator-title" className="mt-1 text-lg font-semibold">Routing simulator</h3><p className="mt-1 text-xs leading-5 text-muted">Test configured conditions. This is not a real visitor lookup and records no click.</p></div><button className="icon-button" type="button" aria-label="Close routing simulator" onClick={onClose}>×</button></div>
    <form onSubmit={simulate} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-xs font-semibold">Device<select value={deviceType} onChange={(e) => setDeviceType(e.target.value)} className="field-control"><option value="unknown">Unknown</option><option value="mobile">Mobile</option><option value="desktop">Desktop</option><option value="tablet">Tablet</option></select></label>
      <label className="text-xs font-semibold">Country code<input value={countryCode === 'unknown' ? '' : countryCode} onChange={(e) => setCountryCode(e.target.value.trim().toUpperCase() || 'unknown')} maxLength={2} pattern="[A-Z]{2}" placeholder="Unknown" className="field-control" /><span className="mt-1 block font-normal text-muted">Enter ISO country code, such as IN, or leave blank for Unknown.</span></label>
      <label className="text-xs font-semibold sm:col-span-2">Simulation time ({Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'})<input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} className="field-control" /></label>
      {Object.entries(query).map(([key, value]) => <label key={key} className="text-xs font-semibold">{key}<input value={value} maxLength={100} onChange={(e) => setQuery((current) => ({ ...current, [key]: e.target.value }))} className="field-control" placeholder="Optional" /></label>)}
      <div className="flex items-end"><button disabled={loading} type="submit" className="button-primary min-h-11 w-full">{loading ? 'Simulating…' : 'Simulate route'}</button></div>
    </form>
    {error && <p role="alert" className="mt-3 rounded-xl bg-[#fff4f0] p-3 text-sm text-danger">{error}</p>}
    {result && <div className="mt-4 rounded-xl border border-line bg-surface p-4" aria-live="polite"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="eyebrow">RESULT</p><p className="mt-1 text-sm font-semibold">{result.matchedRule ? `Matched rule ${result.matchedRule.priority + 1} · ${result.matchedRule.ruleId}` : 'Default destination'}</p></div><span className={`status-pill ${result.usedFallback ? 'status-off' : 'status-on'}`}>{result.usedFallback ? 'Fallback' : 'Rule matched'}</span></div><p className="mt-3 break-all text-sm font-medium text-ink">{result.destinationUrl}</p>{result.fallbackReason && <p className="mt-2 text-xs text-muted">{result.fallbackReason}</p>}<p className="mt-3 border-t border-line pt-3 text-[11px] text-muted">{result.note}</p></div>}
  </section>;
}
