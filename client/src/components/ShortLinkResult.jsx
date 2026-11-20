import QrCode from './QrCode.jsx';

export default function ShortLinkResult({ link, copyState, onCopy, onAnalytics }) {
  if (!link) return null;
  return <section aria-labelledby="short-link-title" key={link.id} className="share-result panel border-[#cbdcc2] bg-[#f3f7ef] p-4 sm:p-5">
    <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">✓</span><div className="min-w-0 flex-1"><p className="eyebrow !text-brand">LINK CREATED</p><h2 id="short-link-title" className="mt-1 text-lg font-semibold tracking-tight">Ready to share.</h2><a className="mt-2 block break-all text-base font-semibold text-ink underline decoration-[#8cb883] underline-offset-4 hover:text-brand" href={link.shortUrl} target="_blank" rel="noreferrer">{link.shortUrl}</a><p className="mt-2 break-all text-xs text-muted">Opens {link.originalUrl}</p></div></div>
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" data-copied={copyState === 'copied'} onClick={onCopy} className="button-primary min-h-11 flex-1 sm:flex-none">{copyState === 'copied' ? '✓ Copied' : 'Copy link'}</button><button type="button" onClick={onAnalytics} className="button-secondary min-h-11 flex-1 sm:flex-none">View analytics</button><details className="qr-action group relative flex-1 sm:flex-none"><summary className="button-secondary min-h-11 cursor-pointer list-none px-4 [&::-webkit-details-marker]:hidden">QR code <span className="text-muted">⌄</span></summary><div className="absolute right-0 z-10 mt-2 w-64 rounded-2xl border border-line bg-surface p-4 shadow-xl"><p className="mb-3 text-sm font-semibold">Scan to open</p><QrCode value={link.shortUrl} name={`linkify-${link.shortCode}`} /></div></details></div>
  </section>;
}
