function AliasSuggestions({ aliases, onSelect }) {
  if (!aliases.length) return null;

  return (
    <section aria-labelledby="suggestions-title" className="rounded-2xl border border-[#dce8d6] bg-white p-4 sm:p-5">
      <h3 id="suggestions-title" className="text-sm font-semibold text-[#08160e]">Available alternatives</h3>
      <p className="mt-1 text-sm leading-6 text-[#657264]">Choose one to fill the alias field. It won’t be created until you shorten the link.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {aliases.map((alias) => (
          <button
            key={alias}
            type="button"
            onClick={() => onSelect(alias)}
            className="max-w-full rounded-full border border-[#cddfc5] bg-[#fbfef9] px-3.5 py-2 text-left text-sm font-medium text-[#295f22] transition-colors hover:border-[#429f24] hover:bg-[#edf7e8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#295f22]"
          >
            <span className="break-all">{alias}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default AliasSuggestions;
