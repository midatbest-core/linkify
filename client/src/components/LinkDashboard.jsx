import { useEffect, useMemo, useState } from 'react';
import QrCode from './QrCode.jsx';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000';

export default function LinkDashboard() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [copied, setCopied] = useState(null);

  async function loadLinks() {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API_URL}/api/links`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not load links.');
      setLinks(data.links ?? []);
    } catch (e) { setError(e.message || 'Could not reach Linkify.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadLinks(); }, []);

  const filtered = useMemo(() => {
    const term = query.toLowerCase().trim();
    return links.filter((link) => `${link.originalUrl} ${link.shortUrl} ${link.shortCode}`.toLowerCase().includes(term));
  }, [links, query]);

  async function copy(link) {
    try { await navigator.clipboard.writeText(link.shortUrl); setCopied(link.id); setTimeout(() => setCopied(null), 1800); }
    catch { setError('Could not copy automatically. Select and copy the short URL.'); }
  }
  async function remove(link) {
    if (!window.confirm(`Delete ${link.shortUrl}? Anyone using this short link will no longer be redirected.`)) return;
    try {
      const response = await fetch(`${API_URL}/api/links/${encodeURIComponent(link.id)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not delete this link.');
      setLinks((current) => current.filter((item) => item.id !== link.id));
      if (expanded === link.id) setExpanded(null);
    } catch (e) { setError(e.message || 'Could not reach Linkify.'); }
  }

  return <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-7 sm:pt-12 lg:px-10" aria-labelledby="dashboard-title">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm font-semibold text-[#429f24]">YOUR LINKS</p><h1 id="dashboard-title" className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Link dashboard</h1><p className="mt-2 text-sm text-[#526052]">Manage and share the short links you’ve created.</p></div>
      <span className="rounded-full bg-[#e9f5e3] px-3 py-1.5 text-sm font-semibold text-[#295f22]">{links.length} {links.length === 1 ? 'link' : 'links'}</span>
    </div>
    <label className="mt-7 block"><span className="sr-only">Search links</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search destination or short link" className="min-h-12 w-full rounded-xl border border-[#dfe8dc] bg-white px-4 outline-none focus:border-[#429f24] focus:ring-2 focus:ring-[#429f24]/20" /></label>
    {error && <p className="mt-4 rounded-xl border border-[#f1c9c4] bg-[#fff7f5] px-4 py-3 text-sm text-[#922d21]" role="alert">{error} <button className="ml-2 font-semibold underline" onClick={loadLinks}>Try again</button></p>}
    {loading ? <p className="mt-8 rounded-2xl border border-[#e2ebdd] bg-white p-8 text-center text-[#526052]" role="status">Loading your links…</p>
      : filtered.length === 0 ? <div className="mt-8 rounded-2xl border border-dashed border-[#cddfc5] bg-white p-8 text-center sm:p-12"><h2 className="text-lg font-semibold">{links.length ? 'No matching links' : 'No links yet'}</h2><p className="mt-2 text-sm text-[#657264]">{links.length ? 'Try another search.' : 'Shorten a URL to see it here.'}</p></div>
        : <div className="mt-5 space-y-3">{filtered.map((link) => <article key={link.id} className="min-w-0 rounded-2xl border border-[#e2ebdd] bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1"><a href={link.shortUrl} target="_blank" rel="noreferrer" className="break-all text-base font-semibold text-[#295f22] underline decoration-[#9dce87] underline-offset-4">{link.shortUrl}</a><p className="mt-2 break-all text-sm text-[#526052]">{link.originalUrl}</p><p className="mt-2 text-xs text-[#718071]">{(link.isCustomAlias ?? !/^[0-9a-zA-Z]{7}$/.test(link.shortCode)) ? `Custom alias · ${link.shortCode}` : 'Random code'} <span className="mx-1">·</span>{link.createdAt ? new Date(link.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date unavailable'}</p></div>
            <div className="grid grid-cols-3 gap-2 sm:flex sm:shrink-0"><button onClick={() => copy(link)} className="min-h-10 rounded-lg border border-[#dce8d6] px-3 text-xs font-semibold text-[#295f22] hover:bg-[#f3f8ef]">{copied === link.id ? 'Copied' : 'Copy'}</button><a href={link.originalUrl} target="_blank" rel="noreferrer" className="grid min-h-10 place-items-center rounded-lg border border-[#dce8d6] px-3 text-xs font-semibold text-[#295f22] hover:bg-[#f3f8ef]">Open</a><button onClick={() => remove(link)} className="min-h-10 rounded-lg border border-[#f1c9c4] px-3 text-xs font-semibold text-[#922d21] hover:bg-[#fff7f5]">Delete</button></div>
          </div>
          <button onClick={() => setExpanded(expanded === link.id ? null : link.id)} aria-expanded={expanded === link.id} className="mt-3 text-sm font-semibold text-[#295f22]">{expanded === link.id ? 'Hide QR code' : 'Show QR code'}</button>
          {expanded === link.id && <div className="mt-3 max-w-[240px]"><QrCode value={link.shortUrl} name={`linkify-${link.shortCode}`} /></div>}
        </article>)}</div>}
    <p className="mt-6 text-xs leading-5 text-[#718071]">This dashboard is shared and unauthenticated. Anyone with access to this app can view or delete its links.</p>
  </section>;
}
