import { useState } from 'react';

export default function ProtectionSettings({ value = {}, onChange, disabled = false, existingHasPassword = false }) {
  const enabled = Boolean(value.enabled);
  const [showPassword, setShowPassword] = useState(false);

  function handleToggle(event) {
    const isChecked = event.target.checked;
    onChange({
      ...value,
      enabled: isChecked,
      password: isChecked ? value.password ?? '' : '',
      expiresAt: isChecked ? value.expiresAt ?? '' : '',
      maxClicks: isChecked ? value.maxClicks ?? '' : '',
    });
  }

  function handleChange(field, val) {
    onChange({
      ...value,
      enabled: true,
      [field]: val,
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
          <span>Link Protection &amp; Access Controls</span>
        </label>
        {enabled && (
          <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-strong">
            Active
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-muted">
        Protect this link with password authentication, expiration date, or maximum redirect limits.
      </p>

      {enabled && (
        <div className="mt-4 grid gap-3.5 border-t border-line pt-3.5 sm:grid-cols-1">
          {/* Password Protection */}
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-ink">
                Password Protection
              </label>
              {existingHasPassword && !value.clearPassword && (
                <span className="text-[11px] font-medium text-emerald-700">
                  Password currently set
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type={showPassword ? 'text' : 'password'}
                className="field-control flex-1"
                placeholder={existingHasPassword && !value.password ? 'Enter new password to change' : 'Set link password'}
                value={value.password ?? ''}
                maxLength={1024}
                disabled={disabled || value.clearPassword}
                onChange={(e) => handleChange('password', e.target.value)}
              />
              <button
                type="button"
                className="button-ghost min-h-10 px-2.5 text-xs"
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
              {existingHasPassword && (
                <button
                  type="button"
                  className={`min-h-10 rounded-lg px-2.5 text-xs font-medium border ${
                    value.clearPassword
                      ? 'bg-amber-100 text-amber-900 border-amber-300'
                      : 'bg-canvas text-muted border-line hover:text-ink'
                  }`}
                  onClick={() => onChange({ ...value, clearPassword: !value.clearPassword, password: '' })}
                >
                  {value.clearPassword ? 'Keep Password' : 'Remove Password'}
                </button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Visitors must enter this password on an unlock screen before being redirected.
            </p>
          </div>

          {/* Expiration Date/Time */}
          <div>
            <label className="block text-xs font-semibold text-ink">
              Expiration Date &amp; Time
            </label>
            <input
              type="datetime-local"
              className="field-control mt-1"
              value={value.expiresAt ? (typeof value.expiresAt === 'string' && value.expiresAt.length === 16 ? value.expiresAt : new Date(value.expiresAt).toISOString().slice(0, 16)) : ''}
              disabled={disabled}
              onChange={(e) => handleChange('expiresAt', e.target.value || null)}
            />
            <p className="mt-1 text-[11px] text-muted">
              Redirects will permanently stop and return HTTP 410 (Gone) after this date and time.
            </p>
          </div>

          {/* Maximum Redirects Cap */}
          <div>
            <label className="block text-xs font-semibold text-ink">
              Maximum Successful Redirects Limit (Cap)
            </label>
            <input
              type="number"
              min="1"
              step="1"
              className="field-control mt-1"
              placeholder="e.g. 500"
              value={value.maxClicks ?? ''}
              disabled={disabled}
              onChange={(e) => handleChange('maxClicks', e.target.value ? parseInt(e.target.value, 10) : null)}
            />
            <p className="mt-1 text-[11px] text-muted">
              Atomically enforced limit. Link permanently closes after reaching this many successful redirects.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
