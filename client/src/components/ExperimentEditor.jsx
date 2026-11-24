export default function ExperimentEditor({ value = {}, onChange, disabled = false, defaultDestinationUrl = '' }) {
  const enabled = Boolean(value.enabled);
  const variants = Array.isArray(value.variants) && value.variants.length === 2
    ? value.variants
    : [
        { variantId: 'var-a', label: 'Variant A', destinationUrl: defaultDestinationUrl || '', weight: 50 },
        { variantId: 'var-b', label: 'Variant B', destinationUrl: '', weight: 50 },
      ];

  const varA = variants[0];
  const varB = variants[1];

  function handleToggle(event) {
    const isChecked = event.target.checked;
    onChange({
      enabled: isChecked,
      variants: isChecked ? variants : [],
    });
  }

  function handleWeightChange(newWeightA) {
    const clampedA = Math.max(0, Math.min(100, Math.round(newWeightA)));
    const weightB = 100 - clampedA;
    onChange({
      enabled: true,
      variants: [
        { ...varA, weight: clampedA },
        { ...varB, weight: weightB },
      ],
    });
  }

  function handleVariantChange(index, field, val) {
    const nextVariants = [...variants];
    nextVariants[index] = { ...nextVariants[index], [field]: val };
    onChange({
      enabled: true,
      variants: nextVariants,
    });
  }

  return (
    <div className="rounded-xl border border-line bg-canvas-subtle p-4 text-ink">
      <div className="flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-ink">
          <input
            type="checkbox"
            className="size-4 rounded border-line text-brand focus:ring-brand"
            checked={enabled}
            onChange={handleToggle}
            disabled={disabled}
          />
          <span>A/B Traffic Experimentation (2 Variants)</span>
        </label>
        {enabled && (
          <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-strong">
            {varA.weight}% / {varB.weight}% Split
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-muted">
        Distribute incoming audience traffic between two destination URLs using sticky first-party assignment.
      </p>
      <p className="mt-1 text-[11px] text-muted">
        Returning visitors retain their assigned variant for 24 hours via a secure first-party cookie.
      </p>

      {enabled && (
        <div className="mt-4 grid gap-4 border-t border-line pt-3.5">
          {/* Traffic Split Slider Bar */}
          <div>
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-brand-strong">{varA.label || 'Variant A'}: {varA.weight}%</span>
              <span className="text-emerald-700">{varB.label || 'Variant B'}: {varB.weight}%</span>
            </div>

            {/* Visual ratio bar */}
            <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full border border-line bg-line">
              <div
                style={{ width: `${varA.weight}%` }}
                className="bg-brand transition-all duration-150"
                title={`${varA.label}: ${varA.weight}%`}
              />
              <div
                style={{ width: `${varB.weight}%` }}
                className="bg-emerald-600 transition-all duration-150"
                title={`${varB.label}: ${varB.weight}%`}
              />
            </div>

            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={varA.weight}
              disabled={disabled}
              onChange={(e) => handleWeightChange(Number(e.target.value))}
              className="mt-2 w-full cursor-pointer accent-brand"
              aria-label="A/B Traffic Weight Distribution"
            />
          </div>

          {/* Variant A Inputs */}
          <div className="rounded-lg border border-line bg-canvas p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-brand-strong">Variant A ({varA.weight}%)</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] font-medium text-muted">Label</label>
                <input
                  type="text"
                  className="field-control mt-1 text-xs"
                  placeholder="Variant A label"
                  value={varA.label}
                  maxLength={80}
                  disabled={disabled}
                  onChange={(e) => handleVariantChange(0, 'label', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted">Destination URL</label>
                <input
                  type="url"
                  className="field-control mt-1 text-xs"
                  placeholder="https://example.com/page-a"
                  value={varA.destinationUrl}
                  disabled={disabled}
                  onChange={(e) => handleVariantChange(0, 'destinationUrl', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Variant B Inputs */}
          <div className="rounded-lg border border-line bg-canvas p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Variant B ({varB.weight}%)</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] font-medium text-muted">Label</label>
                <input
                  type="text"
                  className="field-control mt-1 text-xs"
                  placeholder="Variant B label"
                  value={varB.label}
                  maxLength={80}
                  disabled={disabled}
                  onChange={(e) => handleVariantChange(1, 'label', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted">Destination URL</label>
                <input
                  type="url"
                  className="field-control mt-1 text-xs"
                  placeholder="https://example.com/page-b"
                  value={varB.destinationUrl}
                  disabled={disabled}
                  onChange={(e) => handleVariantChange(1, 'destinationUrl', e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
