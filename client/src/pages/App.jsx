import { useEffect, useRef, useState } from 'react';
import AdaptiveRuleEditor, { createAdaptiveRule } from '../components/AdaptiveRuleEditor.jsx';
import AliasSuggestions from '../components/AliasSuggestions.jsx';
import LinkDashboard from '../components/LinkDashboard.jsx';
import ShortLinkResult from '../components/ShortLinkResult.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { UTM_KEYS, buildUtmPreview } from '../utils/utm.js';
import { firstInvalidAdaptiveRule, serializeAdaptiveRule } from '../utils/adaptiveRoutingValidation.js';

const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:5000' : '');

async function requestJson(path, options) {
  let response;
  try { response = await fetch(`${API_URL}${path}`, { credentials: 'include', ...options }); }
  catch { throw new Error('Could not reach Linkify. Check your connection and try again.'); }
  if (response.status === 401 && path !== '/api/auth/login') window.dispatchEvent(new Event('linkify:unauthorized'));
  let data;
  try { data = await response.json(); } catch { throw new Error('Linkify returned an unexpected response. Please try again.'); }
  return { response, data };
}

function getUrlError(value) {
  if (!value.trim()) return 'Enter the destination URL you want to shorten.';
  try { const url = new URL(value.trim()); if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return 'Use a valid web address beginning with http:// or https://.'; }
  catch { return 'Enter a valid web address beginning with http:// or https://.'; }
  return '';
}

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" className="size-5" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="m9.2 14.8 5.6-5.6M7.2 16.8H6a3.8 3.8 0 0 1 0-7.6h4.1a3.8 3.8 0 0 1 3.2 1.8M16.8 7.2H18a3.8 3.8 0 1 1 0 7.6h-4.1a3.8 3.8 0 0 1-3.2-1.8" /></svg></span>;
}

function AppHeader({ view, setView, onLogout }) {
  return <header className="app-topbar"><div className="mx-auto flex min-h-[70px] max-w-7xl items-center justify-between gap-3 px-4 sm:px-7 lg:px-10">
    <a className="flex items-center gap-2.5 rounded-lg text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand" href="/" aria-label="Linkify home"><BrandMark /><span className="text-xl font-bold tracking-[-.055em]">linkify<span className="text-brand">.</span></span></a>
    <nav aria-label="Main navigation" className="flex items-center gap-1 sm:gap-2"><button className="nav-pill" aria-current={view === 'create' ? 'page' : undefined} onClick={() => setView('create')}>Create link</button><button className="nav-pill" aria-current={view === 'dashboard' ? 'page' : undefined} onClick={() => setView('dashboard')}>Dashboard</button><button className="nav-pill hidden sm:inline-flex" onClick={onLogout}>Log out</button><button className="icon-button sm:hidden" aria-label="Log out" onClick={onLogout}>↗</button></nav>
  </div></header>;
}

function CreateLinkPage({ onCreated }) {
  const [originalUrl, setOriginalUrl] = useState('');
  const [customAlias, setCustomAlias] = useState('');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [utm, setUtm] = useState({});
  const [routingMode, setRoutingMode] = useState('standard');
  const [adaptiveRules, setAdaptiveRules] = useState([]);
  const [urlError, setUrlError] = useState('');
  const [link, setLink] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [copyState, setCopyState] = useState('idle');
  const [showDetails, setShowDetails] = useState(false);
  const aliasRequestId = useRef(0);
  const utmPreview = buildUtmPreview(originalUrl, utm);

  async function checkAlias() {
    const alias = customAlias.trim();
    if (!alias) { setFeedback({ tone: 'error', text: 'Enter an alias to check its availability.' }); return; }
    const requestId = ++aliasRequestId.current;
    setIsChecking(true); setFeedback(null); setSuggestions([]); setLink(null);
    try {
      const { response, data } = await requestJson(`/api/aliases/${encodeURIComponent(alias)}/availability`);
      if (requestId !== aliasRequestId.current) return;
      if (!response.ok) throw new Error(data.error ?? 'Could not check this alias.');
      if (data.available) setFeedback({ tone: 'success', text: `“${data.alias}” is available.` });
      else { setFeedback({ tone: 'info', text: `“${data.alias}” is taken. Try one of these:` }); setSuggestions(data.suggestions ?? []); }
    } catch (error) { if (requestId === aliasRequestId.current) setFeedback({ tone: 'error', text: error.message }); }
    finally { if (requestId === aliasRequestId.current) setIsChecking(false); }
  }

  async function shortenLink(event) {
    event.preventDefault();
    const validationMessage = getUrlError(originalUrl);
    setUrlError(validationMessage);
    if (validationMessage) { setFeedback(null); return; }
    if (routingMode === 'adaptive') {
      const invalidRule = firstInvalidAdaptiveRule(adaptiveRules);
      if (invalidRule) { setFeedback({ tone: 'error', text: `Rule ${invalidRule.index + 1}: ${invalidRule.message}` }); return; }
    }
    aliasRequestId.current += 1; setIsChecking(false); setIsLoading(true); setFeedback(null); setSuggestions([]); setLink(null); setCopyState('idle');
    const payload = { originalUrl: originalUrl.trim() };
    if (routingMode === 'adaptive') payload.adaptiveRouting = { enabled: true, defaultDestinationUrl: originalUrl.trim(), rules: adaptiveRules.map(serializeAdaptiveRule) };
    if (customAlias.trim()) payload.customAlias = customAlias.trim();
    if (title.trim()) payload.title = title.trim();
    if (tags.trim()) payload.tags = tags.split(',').map((value) => value.trim()).filter(Boolean);
    if (Object.values(utm).some((value) => value.trim())) payload.utm = utm;
    try {
      const { response, data } = await requestJson('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) { setSuggestions(data.suggestions ?? []); throw new Error(data.error ?? 'Could not shorten this URL.'); }
      setLink(data); onCreated?.(data);
    } catch (error) { setFeedback({ tone: 'error', text: error.message }); }
    finally { setIsLoading(false); }
  }

  async function copyShortUrl() {
    try { await navigator.clipboard.writeText(link.shortUrl); setCopyState('copied'); setFeedback({ tone: 'success', text: 'Short link copied to your clipboard.' }); }
    catch { setFeedback({ tone: 'error', text: 'Select the short link and copy it manually.' }); }
  }

  return <section className="mx-auto w-full max-w-7xl px-4 pb-14 pt-9 sm:px-7 sm:pt-12 lg:px-10">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">LINK STUDIO <span className="mx-1 text-brand">/</span> CREATE</p><h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-[1.04] tracking-[-.055em] sm:text-5xl">Make your next link <span className="text-brand">work harder.</span></h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted sm:text-base">Create a short link for one destination or route visitors with adaptive rules.</p></div></div>
    <div className="mx-auto max-w-3xl">
      <div className="min-w-0">
        <form className="panel space-y-5 p-4 sm:p-6 lg:p-7" onSubmit={shortenLink} noValidate>

          <div><label className="mb-2 block text-sm font-semibold" htmlFor="destination-url">Destination URL</label><div className={`flex min-h-[54px] items-center rounded-xl border bg-white px-3 transition focus-within:ring-4 focus-within:ring-brand/10 ${urlError ? 'border-danger' : 'border-line focus-within:border-brand'}`}><svg viewBox="0 0 24 24" fill="none" className="mr-2.5 size-[18px] shrink-0 text-muted" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path strokeLinecap="round" d="M3.5 9h17M3.5 15h17M12 3c2.2 2.4 3.2 5.4 3.2 9s-1 6.6-3.2 9c-2.2-2.4-3.2-5.4-3.2-9s1-6.6 3.2-9Z"/></svg><input id="destination-url" className="h-[52px] min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[#9aa39a]" type="url" inputMode="url" autoComplete="url" aria-required="true" aria-invalid={Boolean(urlError)} aria-describedby={urlError ? 'url-error' : 'url-hint'} disabled={isLoading || isChecking} value={originalUrl} onChange={(event) => { setOriginalUrl(event.target.value); setUrlError(''); setLink(null); setFeedback(null); }} placeholder="https://example.com/your-long-link" />{originalUrl && <button type="button" onClick={() => { setOriginalUrl(''); setUrlError(''); }} className="icon-button ml-2" aria-label="Clear destination URL">×</button>}</div>{urlError ? <p id="url-error" className="mt-2 text-sm text-danger" role="alert">{urlError}</p> : <p id="url-hint" className="mt-2 text-xs text-muted">Paste a complete URL starting with http:// or https://</p>}{originalUrl.trim() && <p className="mt-3 break-all rounded-xl bg-canvas-subtle px-3 py-2.5 text-xs leading-5 text-muted">Final destination: <span className="font-medium text-ink">{utmPreview.url || 'Enter a valid web address.'}</span></p>}{utmPreview.conflicts.length > 0 && <p className="mt-2 text-xs text-danger">Existing UTM values are kept: {utmPreview.conflicts.join(', ')}.</p>}</div>
          <fieldset><legend className="mb-2 text-sm font-semibold">Choose how it routes</legend><div className="grid grid-cols-2 gap-2 rounded-xl bg-canvas-subtle p-1.5"><button type="button" onClick={() => setRoutingMode('standard')} aria-pressed={routingMode === 'standard'} className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition ${routingMode === 'standard' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>Standard</button><button type="button" onClick={() => setRoutingMode('adaptive')} aria-pressed={routingMode === 'adaptive'} className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition ${routingMode === 'adaptive' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>Adaptive </button></div><p className="mt-2 text-xs text-muted">{routingMode === 'standard' ? 'One memorable link, one destination.' : 'Send different audiences to the destination that fits.'}</p></fieldset>
          {routingMode === 'adaptive' && <div className="rounded-2xl border border-line bg-[#fbfcf8] p-3 sm:p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">Smart routing rules</p><p className="mt-1 max-w-lg text-xs leading-5 text-muted">Rules run top to bottom. Every condition in a rule must match; otherwise visitors go to the default URL.</p></div><button type="button" onClick={() => setAdaptiveRules((rules) => [...rules, createAdaptiveRule()])} disabled={adaptiveRules.length >= 20} className="button-secondary min-h-10 px-3 text-xs">+ Add rule</button></div><div className="mt-3 space-y-2">{adaptiveRules.length ? adaptiveRules.map((rule, index) => <AdaptiveRuleEditor key={rule.ruleId} rule={rule} index={index} count={adaptiveRules.length} onChange={(value) => setAdaptiveRules((rows) => rows.map((row) => row.ruleId === rule.ruleId ? value : row))} onMove={(direction) => setAdaptiveRules((rows) => { const next = [...rows]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; })} onRemove={() => setAdaptiveRules((rows) => rows.filter((row) => row.ruleId !== rule.ruleId))} />) : <div className="rounded-xl border border-dashed border-line bg-surface p-4 text-center"><p className="text-sm font-medium">Start with a rule</p><p className="mt-1 text-xs text-muted">For example, send mobile visitors to a mobile-friendly page.</p><button type="button" onClick={() => setAdaptiveRules([createAdaptiveRule()])} className="button-quiet mt-2 text-xs text-brand">Create your first rule</button></div>}</div></div>}
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Custom alias <span className="font-normal text-muted">(optional)</span><div className="mt-1 flex min-h-11 items-center rounded-xl border border-line bg-white px-3"><span className="text-sm text-muted">linkify /</span><input id="custom-alias" className="h-10 min-w-0 flex-1 bg-transparent pl-1 text-sm font-normal outline-none" value={customAlias} maxLength={40} autoComplete="off" aria-describedby="alias-hint" disabled={isLoading || isChecking} onChange={(event) => { setCustomAlias(event.target.value); setLink(null); setFeedback(null); }} placeholder="your-alias" /></div><span id="alias-hint" className="mt-1 block font-normal text-muted">3–40 letters, numbers or hyphens.</span></label><div className="flex items-end"><button type="button" className="button-secondary w-full" disabled={isChecking || isLoading} onClick={checkAlias}>{isChecking ? 'Checking…' : 'Check availability'}</button></div></div>
          <button type="button" className="flex min-h-10 w-full items-center justify-between rounded-xl border border-transparent px-1 text-left text-sm font-semibold text-brand hover:border-line hover:bg-white" aria-expanded={showDetails} onClick={() => setShowDetails((value) => !value)}><span>Advanced details <span className="font-normal text-muted">· title, tags and campaign labels</span></span><span aria-hidden="true">{showDetails ? '−' : '+'}</span></button>
          {showDetails && <div className="grid gap-3 rounded-xl bg-canvas-subtle p-3 sm:grid-cols-2"><label className="text-xs font-semibold">Link title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Spring launch" className="field-control" /></label><label className="text-xs font-semibold">Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="newsletter, spring" className="field-control" /></label><fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-3"><legend className="text-xs font-semibold">Campaign tracking (UTM)</legend>{UTM_KEYS.map((key) => <label key={key} className="text-xs font-medium text-muted">{key}<input value={utm[key] ?? ''} onChange={(event) => setUtm((current) => ({ ...current, [key]: event.target.value }))} maxLength={200} className="field-control" /></label>)}<p className="text-[11px] text-muted sm:col-span-3">Declared UTM labels help describe campaign attribution; they do not verify visits, leads or sales.</p></fieldset></div>}
          <button className="button-primary w-full sm:w-auto sm:min-w-48" type="submit" disabled={isLoading || isChecking} aria-busy={isLoading}>{isLoading ? <><span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none" aria-hidden="true"/>Creating link…</> : <>Create link <span aria-hidden="true">→</span></>}</button>
        </form>
        <div className="mt-4 space-y-3" aria-live="polite"><StatusMessage message={feedback?.text} tone={feedback?.tone} /><AliasSuggestions aliases={suggestions} onSelect={(alias) => { setCustomAlias(alias); setSuggestions([]); setFeedback({ tone: 'info', text: `“${alias}” selected. Create your link when ready.` }); }} /><ShortLinkResult link={link} copyState={copyState} onCopy={copyShortUrl} onAnalytics={() => onCreated?.({ ...link, showAnalytics: true })} /></div>
      </div>

    </div>
  </section>;
}

function AdminLogin({ onLogin }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function submit(event) { event.preventDefault(); setLoading(true); setError(''); try { const { response, data } = await requestJson('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }); if (!response.ok) throw new Error(data.error ?? 'Login failed.'); onLogin(data.username); } catch (loginError) { setError(loginError.message); } finally { setLoading(false); } }
  return <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10"><form onSubmit={submit} className="panel w-full max-w-md space-y-5 p-6 sm:p-8"><div className="flex items-center gap-3"><BrandMark/><div><p className="text-lg font-bold tracking-tight">linkify<span className="text-brand">.</span></p><p className="text-xs text-muted">A clearer way to share</p></div></div><div><p className="eyebrow">WORKSPACE ACCESS</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Welcome back.</h1><p className="mt-2 text-sm text-muted">Sign in to manage your links and analytics.</p></div><label className="block text-sm font-semibold">Username<input required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} className="field-control" /></label><label className="block text-sm font-semibold">Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="field-control" /></label>{error && <p role="alert" className="rounded-xl border border-[#efd5cf] bg-[#fff4f0] p-3 text-sm text-danger">{error}</p>}<button disabled={loading} className="button-primary w-full disabled:opacity-60">{loading ? 'Signing in…' : 'Sign in'}</button></form></main>;
}

function App() {
  const [authState, setAuthState] = useState('loading'); const [view, setView] = useState('create'); const [createdLink, setCreatedLink] = useState(null);
  useEffect(() => { fetch(`${API_URL}/api/auth/session`, { credentials: 'include' }).then((response) => response.json()).then((data) => setAuthState(data.authenticated ? 'authenticated' : 'anonymous')).catch(() => setAuthState('anonymous')); const onUnauthorized = () => setAuthState('anonymous'); window.addEventListener('linkify:unauthorized', onUnauthorized); return () => window.removeEventListener('linkify:unauthorized', onUnauthorized); }, []);
  async function logout() { await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {}); setAuthState('anonymous'); }
  if (authState === 'loading') return <main className="grid min-h-screen place-items-center bg-canvas px-4 text-sm text-muted"><div className="w-full max-w-sm space-y-4" role="status" aria-label="Checking session"><div className="skeleton h-8 w-40 rounded-lg"/><div className="skeleton h-4 w-full rounded"/><div className="skeleton h-32 w-full rounded-2xl"/><span className="sr-only">Checking session…</span></div></main>;
  if (authState !== 'authenticated') return <AdminLogin onLogin={() => setAuthState('authenticated')} />;
  return <div className="app-shell"><AppHeader view={view} setView={setView} onLogout={logout}/><main id="main-content">{view === 'dashboard' ? <LinkDashboard onCreateLink={() => setView('create')} initialExpanded={createdLink?.showAnalytics ? createdLink.id : null} /> : <CreateLinkPage onCreated={(link) => { setCreatedLink(link); if (link.showAnalytics) setView('dashboard'); }} />}</main><footer className="safe-bottom border-t border-line bg-surface px-4 py-5 text-center text-xs text-muted">Linkify <span className="mx-1">·</span> A clearer way to share links.</footer></div>;
}

export default App;
