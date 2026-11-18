import { useRef, useState } from 'react';
import AliasSuggestions from '../components/AliasSuggestions.jsx';
import ShortLinkResult from '../components/ShortLinkResult.jsx';
import StatusMessage from '../components/StatusMessage.jsx';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000';

async function requestJson(path, options) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, options);
  } catch {
    throw new Error('Could not reach Linkify. Check your connection and try again.');
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Linkify returned an unexpected response. Please try again.');
  }
  return { response, data };
}

function getUrlError(value) {
  if (!value.trim()) return 'Enter the destination URL you want to shorten.';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      return 'Use a valid web address beginning with http:// or https://.';
    }
  } catch {
    return 'Enter a valid web address beginning with http:// or https://.';
  }
  return '';
}

function BrandMark() {
  return (
    <span className="grid size-10 place-items-center rounded-[14px] bg-[#429f24] text-white shadow-[0_5px_12px_rgba(66,159,36,0.2)]" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" className="size-[22px]" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M7 17 17 7M7 7h10v10" /></svg>
    </span>
  );
}

function StepIcon({ number }) {
  return <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e9f5e3] text-sm font-semibold text-[#295f22]">{number}</span>;
}

function App() {
  const [originalUrl, setOriginalUrl] = useState('');
  const [customAlias, setCustomAlias] = useState('');
  const [urlError, setUrlError] = useState('');
  const [link, setLink] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [copyState, setCopyState] = useState('idle');
  const aliasRequestId = useRef(0);

  async function checkAlias() {
    const alias = customAlias.trim();
    if (!alias) {
      setFeedback({ tone: 'error', text: 'Enter an alias to check its availability.' });
      setSuggestions([]);
      return;
    }

    const requestId = ++aliasRequestId.current;
    setIsChecking(true);
    setFeedback(null);
    setSuggestions([]);
    setLink(null);
    try {
      const { response, data } = await requestJson(`/api/aliases/${encodeURIComponent(alias)}/availability`);
      if (requestId !== aliasRequestId.current) return;
      if (!response.ok) throw new Error(data.error ?? 'Could not check this alias.');
      if (data.available) {
        setFeedback({ tone: 'success', text: `“${data.alias}” is available to use.` });
      } else {
        setFeedback({ tone: 'info', text: `“${data.alias}” is already taken. Choose an available alternative:` });
        setSuggestions(data.suggestions ?? []);
      }
    } catch (error) {
      if (requestId === aliasRequestId.current) {
        setFeedback({ tone: 'error', text: error.message });
      }
    } finally {
      if (requestId === aliasRequestId.current) setIsChecking(false);
    }
  }

  async function shortenLink(event) {
    event.preventDefault();
    const validationMessage = getUrlError(originalUrl);
    setUrlError(validationMessage);
    if (validationMessage) {
      setFeedback(null);
      return;
    }

    aliasRequestId.current += 1;
    setIsChecking(false);
    setIsLoading(true);
    setFeedback(null);
    setSuggestions([]);
    setLink(null);
    setCopyState('idle');

    const payload = { originalUrl: originalUrl.trim() };
    if (customAlias.trim()) payload.customAlias = customAlias.trim();

    try {
      const { response, data } = await requestJson('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        setSuggestions(data.suggestions ?? []);
        throw new Error(data.error ?? 'Could not shorten this URL.');
      }
      setLink(data);
    } catch (error) {
      setFeedback({ tone: 'error', text: error.message });
    } finally {
      setIsLoading(false);
    }
  }

  async function copyShortUrl() {
    try {
      await navigator.clipboard.writeText(link.shortUrl);
      setCopyState('copied');
      setFeedback({ tone: 'success', text: 'Short link copied to your clipboard.' });
    } catch {
      setFeedback({ tone: 'error', text: 'Could not copy automatically. Select the short link and copy it manually.' });
    }
  }

  function chooseSuggestion(alias) {
    aliasRequestId.current += 1;
    setIsChecking(false);
    setCustomAlias(alias);
    setSuggestions([]);
    setLink(null);
    setFeedback({ tone: 'info', text: `“${alias}” selected. Shorten the link when you’re ready.` });
  }

  function updateUrl(value) {
    setOriginalUrl(value);
    setUrlError('');
    setLink(null);
    setFeedback(null);
  }

  function updateAlias(value) {
    aliasRequestId.current += 1;
    setIsChecking(false);
    setCustomAlias(value);
    setSuggestions([]);
    setLink(null);
    setFeedback(null);
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#fbfef9] text-[#08160e]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_at_top,_rgba(185,230,162,0.19),_transparent_68%)]" aria-hidden="true" />
      <header className="relative mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-5 sm:px-7 sm:py-6 lg:px-10">
        <a className="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#295f22]" href="/" aria-label="Linkify home">
          <BrandMark />
          <span className="text-xl font-semibold tracking-[-0.04em] sm:text-[22px]">linkify</span>
        </a>
        <span className="rounded-full border border-[#dce8d6] bg-white/80 px-3 py-1.5 text-xs font-medium text-[#295f22] sm:px-4 sm:text-sm">Make every link count</span>
      </header>

      <section className="relative mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-10 px-4 pb-16 pt-9 sm:px-7 sm:pb-20 sm:pt-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(300px,0.75fr)] lg:gap-20 lg:px-10 lg:pb-24 lg:pt-16">
        <div className="min-w-0">
          <p className="mb-5 inline-flex max-w-full items-center gap-2 rounded-full border border-[#dce8d6] bg-white/80 px-3 py-1.5 text-xs font-semibold text-[#295f22] sm:mb-6 sm:px-3.5 sm:text-sm">
            <span className="size-2 rounded-full bg-[#429f24] shadow-[0_0_0_4px_rgba(66,159,36,0.1)]" /> The simpler way to share
          </p>
          <h1 className="max-w-[680px] text-[clamp(2.7rem,8vw,4.75rem)] font-semibold leading-[0.99] tracking-[-0.065em]">
            Long links,<br /><span className="text-[#429f24]">meet their match.</span>
          </h1>
          <p className="mt-5 max-w-[510px] text-base leading-7 text-[#526052] sm:mt-6 sm:text-lg sm:leading-8">
            Create a short, memorable link for the places you want to share. Start with a URL below.
          </p>

          <form className="mt-8 space-y-4 rounded-[22px] border border-[#e2ebdd] bg-white p-4 shadow-[0_22px_60px_-38px_rgba(8,22,14,0.32)] sm:mt-9 sm:space-y-5 sm:rounded-[26px] sm:p-6" onSubmit={shortenLink} noValidate>
            <div>
              <label className="mb-2 block text-sm font-semibold text-[#08160e]" htmlFor="destination-url">Destination URL</label>
              <div className={`flex min-h-12 items-center rounded-xl border bg-[#fcfdfb] px-3.5 transition focus-within:ring-2 focus-within:ring-[#429f24]/30 ${urlError ? 'border-[#c75c50]' : 'border-[#dfe8dc] focus-within:border-[#429f24]'}`}>
                <svg viewBox="0 0 24 24" fill="none" className="mr-2.5 size-[18px] shrink-0 text-[#7c8979]" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" strokeLinejoin="round" d="M3.5 9h17M3.5 15h17M12 3c2.2 2.4 3.2 5.4 3.2 9s-1 6.6-3.2 9c-2.2-2.4-3.2-5.4-3.2-9s1-6.6 3.2-9Z" /></svg>
                <input
                  id="destination-url"
                  className="h-12 min-w-0 flex-1 bg-transparent text-base text-[#08160e] outline-none placeholder:text-[#98a296] sm:text-[15px]"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  aria-required="true"
                  aria-invalid={Boolean(urlError)}
                  aria-describedby={urlError ? 'url-error' : 'url-hint'}
                  disabled={isLoading || isChecking}
                  value={originalUrl}
                  onChange={(event) => updateUrl(event.target.value)}
                  placeholder="https://example.com/your-long-link"
                />
                {originalUrl && <button type="button" onClick={() => updateUrl('')} disabled={isLoading || isChecking} className="ml-2 grid size-8 shrink-0 place-items-center rounded-lg text-[#718071] hover:bg-[#edf3e9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#295f22] disabled:cursor-not-allowed disabled:opacity-50" aria-label="Clear destination URL">×</button>}
              </div>
              {urlError ? <p id="url-error" className="mt-2 text-sm text-[#922d21]" role="alert">{urlError}</p> : <p id="url-hint" className="mt-2 text-xs leading-5 text-[#718071]">Use a complete URL beginning with http:// or https://</p>}
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <label className="text-sm font-semibold text-[#08160e]" htmlFor="custom-alias">Custom alias <span className="font-normal text-[#718071]">(optional)</span></label>
                <span className="text-xs text-[#718071]">Or we’ll make one for you</span>
              </div>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                <div className="flex min-h-12 min-w-0 flex-1 items-center rounded-xl border border-[#dfe8dc] bg-[#fcfdfb] px-3.5 transition focus-within:border-[#429f24] focus-within:ring-2 focus-within:ring-[#429f24]/30">
                  <span className="mr-1 shrink-0 text-sm text-[#718071]">linkify /</span>
                  <input
                    id="custom-alias"
                    className="h-12 min-w-0 flex-1 bg-transparent text-base text-[#08160e] outline-none placeholder:text-[#a0aa9f] sm:text-[15px]"
                    value={customAlias}
                    autoComplete="off"
                    maxLength={40}
                    aria-describedby="alias-hint"
                    disabled={isLoading || isChecking}
                    onChange={(event) => updateAlias(event.target.value)}
                    placeholder="your-alias"
                  />
                </div>
                <button
                  className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#cddfc5] bg-white px-4 text-sm font-semibold text-[#295f22] transition-colors hover:bg-[#f3f8ef] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#295f22] disabled:cursor-wait disabled:opacity-65"
                  type="button"
                  disabled={isChecking || isLoading}
                  onClick={checkAlias}
                >
                  {isChecking ? <><span className="size-4 animate-spin rounded-full border-2 border-[#9cb795] border-t-[#295f22] motion-reduce:animate-none" aria-hidden="true" /> Checking</> : 'Check availability'}
                </button>
              </div>
              <p id="alias-hint" className="mt-2 text-xs leading-5 text-[#718071]">3–40 characters: letters, numbers, and hyphens.</p>
            </div>

            <button
              className="inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-[#429f24] px-5 py-3 text-base font-semibold text-white shadow-[0_7px_14px_rgba(66,159,36,0.18)] transition-colors hover:bg-[#347d1d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#295f22] disabled:cursor-wait disabled:bg-[#78b65e] disabled:shadow-none"
              type="submit"
              disabled={isLoading || isChecking}
              aria-busy={isLoading}
            >
              {isLoading ? <><span className="size-[18px] animate-spin rounded-full border-2 border-white/50 border-t-white motion-reduce:animate-none" aria-hidden="true" /> Creating your short link</> : <>Shorten link <span aria-hidden="true">→</span></>}
            </button>
          </form>

          <div className="mt-4 space-y-3 sm:mt-5" aria-live="polite">
            <StatusMessage message={feedback?.text} tone={feedback?.tone} />
            <AliasSuggestions aliases={suggestions} onSelect={chooseSuggestion} />
            <ShortLinkResult link={link} copyState={copyState} onCopy={copyShortUrl} />
          </div>

          <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs leading-5 text-[#718071] sm:justify-start sm:text-sm">
            <svg viewBox="0 0 24 24" fill="none" className="size-4 shrink-0 text-[#429f24]" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3 5 6v5c0 4.5 2.7 7.9 7 10 4.3-2.1 7-5.5 7-10V6l-7-3Z" /><path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" /></svg>
            Your destination is validated before a link is created.
          </p>
        </div>

        <aside className="relative mx-auto w-full max-w-[520px] overflow-hidden rounded-[28px] bg-[#08160e] p-6 text-white shadow-[0_30px_75px_-40px_rgba(8,22,14,0.55)] sm:rounded-[34px] sm:p-8 lg:p-9" aria-label="How Linkify works">
          <div className="absolute -right-24 -top-28 size-72 rounded-full border border-[#b9e6a2]/10" aria-hidden="true" />
          <div className="absolute -right-14 -top-20 size-56 rounded-full border border-[#b9e6a2]/10" aria-hidden="true" />
          <div className="absolute -right-7 -top-10 size-36 rounded-full bg-[#429f24]/10 blur-2xl" aria-hidden="true" />
          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-[#c6d8c0]">
              <span className="size-1.5 rounded-full bg-[#b9e6a2]" /> Less link. More clarity.
            </span>
            <h2 className="mt-7 max-w-sm text-[clamp(1.65rem,5vw,2.25rem)] font-medium leading-tight tracking-[-0.04em]">A little link can go a long way.</h2>
            <p className="mt-3 max-w-sm text-sm leading-6 text-[#aab9a6]">Keep sharing simple with a short address that’s easy to remember and pass along.</p>

            <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.055] p-4 sm:mt-9 sm:p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#9eaf99]">Made for the way you share</p>
              <ol className="mt-5 space-y-4 sm:space-y-5">
                <li className="flex items-center gap-3.5"><StepIcon number="01" /><span className="text-sm leading-5 text-[#e5ece2]">Turn a long URL into a short link</span></li>
                <li className="flex items-center gap-3.5"><StepIcon number="02" /><span className="text-sm leading-5 text-[#e5ece2]">Make the ending your own</span></li>
                <li className="flex items-center gap-3.5"><StepIcon number="03" /><span className="text-sm leading-5 text-[#e5ece2]">Share it wherever you like</span></li>
              </ol>
            </div>

            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-[#b9e6a2]/15 bg-[#429f24]/[0.09] p-4">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[#429f24]/20 text-[#b9e6a2]" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" className="size-4" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.36-6.36-1.42 1.42M7.06 16.94l-1.42 1.42m12.72 0-1.42-1.42M7.06 7.06 5.64 5.64" /><circle cx="12" cy="12" r="4" /></svg>
              </span>
              <p className="text-xs leading-5 text-[#c3d1bf] sm:text-sm">Want a memorable name? Check availability before you create your link.</p>
            </div>
          </div>
        </aside>
      </section>

      <footer className="relative border-t border-[#e8eee5] bg-white/45 px-4 py-5 text-center text-xs text-[#718071] sm:px-6 sm:py-6 sm:text-sm">Linkify <span className="mx-1 text-[#a0aa9f]">·</span> A clearer way to share links.</footer>
    </main>
  );
}

export default App;
