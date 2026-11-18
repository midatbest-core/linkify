function ShortLinkResult({ link, copyState, onCopy }) {
  if (!link) return null;

  return (
    <section aria-labelledby="short-link-title" className="rounded-2xl border border-[#c8e3ba] bg-[#f2faed] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#dff1d4] text-[#295f22]" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" className="size-5" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M10 13.5a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1.72 1.72M14 10.5a4 4 0 0 0-5.66 0l-3 3A4 4 0 0 0 11 19.16l1.72-1.72" /></svg>
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="short-link-title" className="text-sm font-semibold text-[#295f22]">Your link is ready</h3>
          <a className="mt-1.5 block break-all text-base font-semibold text-[#08160e] underline decoration-[#9dce87] underline-offset-4 hover:text-[#295f22]" href={link.shortUrl} target="_blank" rel="noreferrer">{link.shortUrl}</a>
          <p className="mt-2 break-all text-xs leading-5 text-[#657264]">Opens {link.originalUrl}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#295f22] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#08160e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#295f22] sm:w-auto"
      >
        {copyState === 'copied' ? (
          <><span aria-hidden="true">✓</span> Copied</>
        ) : (
          <><span aria-hidden="true">▢</span> Copy short link</>
        )}
      </button>
    </section>
  );
}

export default ShortLinkResult;
