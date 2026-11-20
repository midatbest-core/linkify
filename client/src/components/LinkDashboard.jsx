import { useEffect, useState } from 'react';
import QrCode from './QrCode.jsx';
import { DateRange, LinkAnalytics, OverviewAnalytics } from './AnalyticsViews.jsx';
import AdaptiveRuleEditor, { createAdaptiveRule, prepareAdaptiveRule } from './AdaptiveRuleEditor.jsx';
import { firstInvalidAdaptiveRule, serializeAdaptiveRule } from '../utils/adaptiveRoutingValidation.js';

const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:5000' : '');
async function apiFetch(url, options) {
  const response = await fetch(url, { credentials: 'include', ...options });
  if (response.status === 401) window.dispatchEvent(new Event('linkify:unauthorized'));
  return response;
}
const utcToday = () => new Date().toISOString().slice(0, 10);
function dateDaysAgo(days) { const date = new Date(); date.setUTCDate(date.getUTCDate() - days); return date.toISOString().slice(0, 10); }

export default function LinkDashboard() {
  const [links, setLinks] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('createdAt');
  const [order, setOrder] = useState('desc');
  const [expanded, setExpanded] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [copied, setCopied] = useState(null);
  const [range, setRange] = useState({ from: dateDaysAgo(29), to: utcToday() });
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState('');
  const [linkAnalytics, setLinkAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadLinks() {
      setLoading(true); setError('');
      const params = new URLSearchParams({ q: query, status, sort, order, page: String(page), limit: '50' });
      if (tag.trim()) params.set('tag', tag.trim());
      try {
        const response = await apiFetch(`${API_URL}/api/links?${params}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Could not load links.');
        if (!cancelled) { setLinks(data.links ?? []); setPagination(data.pagination ?? { page, limit: 50, total: data.links?.length ?? 0, totalPages: 1 }); }
      } catch (e) { if (!cancelled) setError(e.message || 'Could not reach Linkify.'); }
      finally { if (!cancelled) setLoading(false); }
    }
    loadLinks();
    return () => { cancelled = true; };
  }, [query, status, tag, sort, order, page]);

  useEffect(() => {
    let cancelled = false;
    async function loadOverview() {
      setOverviewLoading(true); setOverviewError('');
      const params = new URLSearchParams(range);
      try {
        const response = await apiFetch(`${API_URL}/api/analytics/overview?${params}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Could not load overview analytics.');
        if (!cancelled) setOverview(data.analytics);
      } catch (e) { if (!cancelled) setOverviewError(e.message || 'Could not reach Linkify.'); }
      finally { if (!cancelled) setOverviewLoading(false); }
    }
    loadOverview();
    return () => { cancelled = true; };
  }, [range]);

  useEffect(() => {
    let cancelled = false;
    if (!expanded || expanded.startsWith('qr-')) { setLinkAnalytics(null); return () => { cancelled = true; }; }
    async function loadAnalytics() {
      setAnalyticsLoading(true); setAnalyticsError('');
      const params = new URLSearchParams(range);
      try {
        const response = await apiFetch(`${API_URL}/api/links/${encodeURIComponent(expanded)}/analytics?${params}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Could not load link analytics.');
        if (!cancelled) setLinkAnalytics(data.analytics);
      } catch (e) { if (!cancelled) setAnalyticsError(e.message || 'Could not reach Linkify.'); }
      finally { if (!cancelled) setAnalyticsLoading(false); }
    }
    loadAnalytics();
    return () => { cancelled = true; };
  }, [expanded, range]);

  function changeRange(key, value) { setRange((current) => ({ ...current, [key]: value })); }
  async function copy(link) {
    try { await navigator.clipboard.writeText(link.shortUrl); setCopied(link.id); setTimeout(() => setCopied(null), 1800); }
    catch { setError('Could not copy automatically. Select and copy the short URL.'); }
  }
  async function remove(link) {
    if (!window.confirm(`Delete ${link.shortUrl}? Anyone using this short link will no longer be redirected.`)) return;
    try {
      const response = await apiFetch(`${API_URL}/api/links/${encodeURIComponent(link.id)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not delete this link.');
      setLinks((current) => current.filter((item) => item.id !== link.id));
      setPagination((current) => { const total = Math.max(0, current.total - 1); return { ...current, total, totalPages: Math.ceil(total / current.limit) }; });
      if (links.length === 1 && page > 1) setPage((current) => current - 1);
      if (expanded === link.id) setExpanded(null);
    } catch (e) { setError(e.message || 'Could not reach Linkify.'); }
  }
  function beginEdit(link) {
    setEditing(link.id);
    setDraft({ originalUrl: link.originalUrl, title: link.title ?? '', tags: (link.tags ?? []).join(', '), adaptiveRouting: { enabled: link.adaptiveRouting?.enabled === true, defaultDestinationUrl: link.adaptiveRouting?.defaultDestinationUrl ?? link.originalUrl, rules: (link.adaptiveRouting?.rules ?? []).map(prepareAdaptiveRule) } });
  }
  async function saveEdit(link) {
    setError('');
    const invalidRule = firstInvalidAdaptiveRule(draft.adaptiveRouting.rules);
    if (invalidRule) {
      setError(`Rule ${invalidRule.index + 1}: ${invalidRule.message}`);
      return;
    }
    setSavingEdit(true);
    try {
      const response = await apiFetch(`${API_URL}/api/links/${encodeURIComponent(link.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalUrl: draft.originalUrl, title: draft.title, tags: draft.tags.split(',').map((value) => value.trim()).filter(Boolean), adaptiveRouting: { ...draft.adaptiveRouting, defaultDestinationUrl: draft.originalUrl, rules: draft.adaptiveRouting.rules.map(serializeAdaptiveRule) } }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not update this link.');
      setEditing(null);
      if (status !== 'all' && status !== nextStatus) {
        setLinks((current) => current.filter((item) => item.id !== link.id));
        setPagination((current) => { const total = Math.max(0, current.total - 1); return { ...current, total, totalPages: Math.ceil(total / current.limit) }; });
        if (links.length === 1 && page > 1) setPage((current) => current - 1);
      } else setLinks((current) => current.map((item) => item.id === link.id ? { ...item, ...data.link } : item));
    } catch (e) { setError(e.message || 'Could not reach Linkify.'); }
    finally { setSavingEdit(false); }
  }
  async function toggleArchive(link) {
    const nextStatus = link.status === 'archived' ? 'active' : 'archived';
    try {
      const response = await apiFetch(`${API_URL}/api/links/${encodeURIComponent(link.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not change link status.');
      setLinks((current) => current.map((item) => item.id === link.id ? { ...item, ...data.link } : item));
    } catch (e) { setError(e.message || 'Could not reach Linkify.'); }
  }

  return <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-7 sm:pt-12 lg:px-10" aria-labelledby="dashboard-title">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm font-semibold text-[#429f24]">YOUR LINKS</p><h1 id="dashboard-title" className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Link dashboard</h1><p className="mt-2 text-sm text-[#526052]">Manage links and review estimated redirect activity.</p></div>
      <span className="rounded-full bg-[#e9f5e3] px-3 py-1.5 text-sm font-semibold text-[#295f22]">{pagination.total} links</span>
    </div>
    <div className="mt-6 space-y-3"><DateRange from={range.from} to={range.to} onChange={changeRange} /><OverviewAnalytics analytics={overview} loading={overviewLoading} error={overviewError} /></div>

    <div className="mt-9 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-semibold">Links</h2><p className="mt-1 text-sm text-[#718071]">Search, filter and manage destinations.</p></div>
      <div className="flex flex-wrap gap-2"><label className="text-xs font-medium text-[#526052]">Status<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="ml-2 min-h-10 rounded-lg border border-[#dfe8dc] bg-white px-2 text-sm"><option value="all">All</option><option value="active">Active</option><option value="archived">Archived</option></select></label><label className="text-xs font-medium text-[#526052]">Sort<select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className="ml-2 min-h-10 rounded-lg border border-[#dfe8dc] bg-white px-2 text-sm"><option value="createdAt">Created</option><option value="clicks">Clicks</option></select></label><button onClick={() => { setOrder((value) => value === 'desc' ? 'asc' : 'desc'); setPage(1); }} className="min-h-10 rounded-lg border border-[#dfe8dc] bg-white px-3 text-sm" aria-label="Toggle sort order">{order === 'desc' ? 'Newest / most' : 'Oldest / least'}</button></div>
    </div>
    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px]"><label><span className="sr-only">Search by title, alias or destination</span><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search title, alias or destination" className="min-h-11 w-full rounded-xl border border-[#dfe8dc] bg-white px-4 outline-none focus:border-[#429f24] focus:ring-2 focus:ring-[#429f24]/20" /></label><label><span className="sr-only">Filter by tag</span><input value={tag} onChange={(e) => { setTag(e.target.value); setPage(1); }} placeholder="Filter by exact tag" className="min-h-11 w-full rounded-xl border border-[#dfe8dc] bg-white px-4 outline-none focus:border-[#429f24] focus:ring-2 focus:ring-[#429f24]/20" /></label></div>
    {error && <p className="mt-4 rounded-xl border border-[#f1c9c4] bg-[#fff7f5] px-4 py-3 text-sm text-[#922d21]" role="alert">{error}</p>}
    {loading ? <p className="mt-5 rounded-2xl border border-[#e2ebdd] bg-white p-8 text-center text-[#526052]" role="status">Loading your links…</p>
      : links.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-[#cddfc5] bg-white p-8 text-center"><h3 className="font-semibold">No matching links</h3><p className="mt-2 text-sm text-[#657264]">Try another search or filter.</p></div>
        : <div className="mt-4 space-y-3">{links.map((link) => <article key={link.id} className="min-w-0 rounded-2xl border border-[#e2ebdd] bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-base font-semibold text-[#08160e]">{link.title || link.shortCode}</h3><span className={`rounded-full px-2 py-0.5 text-xs ${link.status === 'archived' ? 'bg-[#f3eee7] text-[#6b5945]' : 'bg-[#e9f5e3] text-[#295f22]'}`}>{link.status}</span>{link.adaptiveRouting?.enabled && <span className="rounded-full bg-[#e8f2ff] px-2 py-0.5 text-xs font-medium text-[#315c8a]">Adaptive</span>}<span className="text-xs text-[#718071]">{link.clickCount ?? 0} clicks</span></div><a href={link.shortUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm font-semibold text-[#295f22] underline decoration-[#9dce87] underline-offset-4">{link.shortUrl}</a><p className="mt-2 break-all text-sm text-[#526052]">{link.originalUrl}</p><p className="mt-2 text-xs text-[#718071]">{link.isCustomAlias ? `Custom alias · ${link.shortCode}` : 'Random code'} <span className="mx-1">·</span>{link.createdAt ? new Date(link.createdAt).toLocaleDateString() : 'Date unavailable'}{link.tags?.length ? <span className="ml-2">{link.tags.map((value) => <span key={value} className="mr-1 inline-block rounded bg-[#f1f5ef] px-1.5 py-0.5">{value}</span>)}</span> : null}</p></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:flex xl:shrink-0"><button onClick={() => copy(link)} className="min-h-10 rounded-lg border border-[#dce8d6] px-3 text-xs font-semibold text-[#295f22] hover:bg-[#f3f8ef]">{copied === link.id ? 'Copied' : 'Copy'}</button><button onClick={() => setExpanded(expanded === link.id ? null : link.id)} aria-expanded={expanded === link.id} className="min-h-10 rounded-lg border border-[#dce8d6] px-3 text-xs font-semibold text-[#295f22]">{expanded === link.id ? 'Hide analytics' : 'Analytics'}</button><button onClick={() => editing === link.id ? setEditing(null) : beginEdit(link)} className="min-h-10 rounded-lg border border-[#dce8d6] px-3 text-xs font-semibold text-[#295f22]">{editing === link.id ? 'Cancel edit' : 'Edit'}</button><button onClick={() => toggleArchive(link)} className="min-h-10 rounded-lg border border-[#dce8d6] px-3 text-xs font-semibold text-[#295f22]">{link.status === 'archived' ? 'Restore' : 'Archive'}</button><button onClick={() => remove(link)} className="min-h-10 rounded-lg border border-[#f1c9c4] px-3 text-xs font-semibold text-[#922d21] hover:bg-[#fff7f5]">Delete</button><button onClick={() => setExpanded(expanded === `qr-${link.id}` ? null : `qr-${link.id}`)} className="min-h-10 rounded-lg border border-[#dce8d6] px-3 text-xs font-semibold text-[#295f22]">QR code</button></div>
          </div>
          {editing === link.id && <div className="mt-4 grid gap-3 rounded-xl bg-[#f8fbf6] p-3 sm:grid-cols-2"><label className="text-xs font-semibold text-[#526052]">Title<input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} maxLength={120} className="mt-1 min-h-10 w-full rounded-lg border border-[#dfe8dc] bg-white px-3 text-sm font-normal" /></label><label className="text-xs font-semibold text-[#526052]">Tags, comma separated<input value={draft.tags} onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-[#dfe8dc] bg-white px-3 text-sm font-normal" /></label><label className="text-xs font-semibold text-[#526052] sm:col-span-2">Default destination URL<input type="url" value={draft.originalUrl} onChange={(e) => setDraft((d) => ({ ...d, originalUrl: e.target.value, adaptiveRouting: { ...d.adaptiveRouting, defaultDestinationUrl: e.target.value } }))} className="mt-1 min-h-10 w-full rounded-lg border border-[#dfe8dc] bg-white px-3 text-sm font-normal" /></label>
            <label className="flex min-h-10 items-center gap-2 text-sm font-semibold sm:col-span-2"><input type="checkbox" checked={draft.adaptiveRouting.enabled} onChange={(e) => setDraft((d) => ({ ...d, adaptiveRouting: { ...d.adaptiveRouting, enabled: e.target.checked } }))} />Enable adaptive routing</label>
            <div className="space-y-2 sm:col-span-2"><div className="flex items-center justify-between gap-2"><div><p className="text-xs font-semibold text-[#526052]">Smart routing rules, top to bottom</p><p className="mt-1 text-xs text-[#718071]">Conditions use AND logic. First match wins; otherwise the default destination is used.</p></div><button type="button" onClick={() => setDraft((d) => ({ ...d, adaptiveRouting: { ...d.adaptiveRouting, rules: [...d.adaptiveRouting.rules, createAdaptiveRule()] } }))} disabled={draft.adaptiveRouting.rules.length >= 20} className="min-h-9 rounded-lg border bg-white px-3 text-xs font-semibold text-[#295f22] disabled:opacity-50">Add rule</button></div>
              {draft.adaptiveRouting.rules.map((rule, index) => <AdaptiveRuleEditor key={rule.ruleId} rule={rule} index={index} count={draft.adaptiveRouting.rules.length} onChange={(value) => setDraft((d) => ({ ...d, adaptiveRouting: { ...d.adaptiveRouting, rules: d.adaptiveRouting.rules.map((row) => row.ruleId === rule.ruleId ? value : row) } }))} onMove={(direction) => setDraft((d) => { const rules = [...d.adaptiveRouting.rules]; [rules[index], rules[index + direction]] = [rules[index + direction], rules[index]]; return { ...d, adaptiveRouting: { ...d.adaptiveRouting, rules } }; })} onRemove={() => setDraft((d) => ({ ...d, adaptiveRouting: { ...d.adaptiveRouting, rules: d.adaptiveRouting.rules.filter((row) => row.ruleId !== rule.ruleId) } }))} />)}
            </div><button disabled={savingEdit} onClick={() => saveEdit(link)} className="min-h-10 rounded-lg bg-[#429f24] px-4 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2">{savingEdit ? 'Saving changes…' : 'Save changes'}</button></div>}
          {expanded === link.id && <LinkAnalytics analytics={linkAnalytics} routing={link.adaptiveRouting} loading={analyticsLoading} error={analyticsError} />}
          {expanded === `qr-${link.id}` && <div className="mt-4 max-w-[240px]"><QrCode value={link.shortUrl} name={`linkify-${link.shortCode}`} /></div>}
        </article>)}</div>}
    {pagination.totalPages > 1 && <nav className="mt-5 flex items-center justify-between" aria-label="Link pages"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="min-h-10 rounded-lg border border-[#dce8d6] px-4 text-sm font-semibold text-[#295f22] disabled:opacity-40">Previous</button><span className="text-sm text-[#526052]">Page {page} of {pagination.totalPages}</span><button disabled={page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)} className="min-h-10 rounded-lg border border-[#dce8d6] px-4 text-sm font-semibold text-[#295f22] disabled:opacity-40">Next</button></nav>}
    <p className="mt-6 text-xs leading-5 text-[#718071]">This dashboard is shared and unauthenticated. Anyone with access can view, edit, archive, or delete these links. Analytics are redirect counts, not unique visitors or conversions; classifications are estimates.</p>
  </section>;
}
