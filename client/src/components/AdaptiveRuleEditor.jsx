import React, { useState } from 'react';
import { getAdaptiveRuleSummary, getAdaptiveRuleUrlError } from '../utils/adaptiveRoutingValidation.js';

const COUNTRY_CODES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
const COUNTRY_NAME = new Intl.DisplayNames(['en'], { type: 'region' });
const currentTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TIME_ZONES = ['UTC', currentTimeZone(), ...(Intl.supportedValuesOf?.('timeZone') ?? [])].filter((zone, index, list) => list.indexOf(zone) === index);

export function createAdaptiveRule() {
  return { ruleId: crypto.randomUUID(), deviceType: '', countryCode: '', startAt: '', endAt: '', timeZone: currentTimeZone(), campaign: {}, destinationUrl: '', enabled: true };
}

function localValue(value, zone) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const fields = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}

export function prepareAdaptiveRule(rule) {
  const zone = rule.timeZone || currentTimeZone();
  return { ...rule, deviceType: rule.deviceType ?? '', countryCode: rule.countryCode ?? '', startAt: localValue(rule.startAt, zone), endAt: localValue(rule.endAt, zone), timeZone: zone, campaign: { ...(rule.campaign ?? {}) } };
}

function Field({ label, children, className = '' }) {
  return <label className={`block min-w-0 text-xs font-semibold text-ink ${className}`}>{label}{children}</label>;
}

export default function AdaptiveRuleEditor({ rule, index, count, onChange, onMove, onRemove }) {
  const [expanded, setExpanded] = useState(false);
  const update = (patch) => onChange({ ...rule, ...patch });
  const campaign = rule.campaign ?? {};
  const summary = getAdaptiveRuleSummary({ ...rule, priority: index });
  const conditionSummary = summary.split('; priority')[0].replace(/^Disabled; /, '');
  return <article data-expanded={expanded} className={`rule-card ${rule.enabled ? '' : 'rule-disabled'}`}>
    <div className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
      <span className="priority-pill" aria-label={`Priority ${index + 1}`}>{String(index + 1).padStart(2, '0')}</span>
      <div className="min-w-0 flex-1">
        <p className="eyebrow">IF <span className="text-ink">{conditionSummary}</span></p>
        <p className="mt-1 truncate text-sm text-muted">THEN <span className="font-semibold text-ink">{rule.destinationUrl || 'Choose a destination'}</span></p>
      </div>
      <span className={`status-pill ${rule.enabled ? 'status-on' : 'status-off'}`}>{rule.enabled ? 'Enabled' : 'Disabled'}</span>
      <button type="button" className="button-quiet min-h-10 px-3" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? 'Close rule' : 'Edit rule'}</button>
      <button type="button" className="icon-button" aria-label={`Move rule ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
      <button type="button" className="icon-button" aria-label={`Move rule ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)}>↓</button>
    </div>
    {expanded && <div className="rule-editor border-t border-line p-3 sm:p-4">
      <p className="mb-3 text-xs leading-5 text-muted">Set any combination of conditions. All conditions in this rule must match. Rules run top to bottom.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Device"><select value={rule.deviceType ?? ''} onChange={(event) => update({ deviceType: event.target.value })} className="field-control"><option value="">Any device</option><option value="mobile">Mobile</option><option value="desktop">Desktop</option><option value="tablet">Tablet</option></select></Field>
        <Field label="Country"><select value={rule.countryCode ?? ''} onChange={(event) => update({ countryCode: event.target.value })} className="field-control"><option value="">Any country</option>{COUNTRY_CODES.map((code) => <option key={code} value={code}>{COUNTRY_NAME.of(code)} ({code})</option>)}</select></Field>
        <Field label="Destination URL" className="sm:col-span-2"><input type="url" required aria-invalid={Boolean(getAdaptiveRuleUrlError(rule.destinationUrl))} value={rule.destinationUrl} onChange={(event) => update({ destinationUrl: event.target.value })} placeholder="https://example.com/destination" className="field-control" />{getAdaptiveRuleUrlError(rule.destinationUrl) && <span className="mt-1 block text-xs text-danger" role="alert">{getAdaptiveRuleUrlError(rule.destinationUrl)}</span>}</Field>
        <Field label="Start date and time"><input type="datetime-local" value={rule.startAt ?? ''} onChange={(event) => update({ startAt: event.target.value })} className="field-control" /></Field>
        <Field label="End date and time"><input type="datetime-local" value={rule.endAt ?? ''} onChange={(event) => update({ endAt: event.target.value })} className="field-control" /></Field>
        <Field label="Schedule time zone" className="sm:col-span-2"><select value={rule.timeZone || 'UTC'} onChange={(event) => update({ timeZone: event.target.value })} className="field-control">{TIME_ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select><span className="mt-1 block text-[11px] font-normal text-muted">Local time in this zone. Start is inclusive; end is exclusive.</span></Field>
        <fieldset className="grid gap-3 rounded-xl bg-canvas-subtle p-3 sm:col-span-2 sm:grid-cols-3"><legend className="px-1 text-xs font-semibold">Campaign values (all must match)</legend>{[['source', 'utm_source'], ['medium', 'utm_medium'], ['campaign', 'utm_campaign']].map(([field, label]) => <Field key={field} label={label}><input value={campaign[field] ?? ''} maxLength={100} onChange={(event) => update({ campaign: { ...campaign, [field]: event.target.value || undefined } })} className="field-control" placeholder="Exact match" /></Field>)}<p className="text-[11px] leading-4 text-muted sm:col-span-3">UTM conditions are exact and case-sensitive. Query values do not represent verified visits or conversions.</p></fieldset>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <label className="mr-auto flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={rule.enabled !== false} onChange={(event) => update({ enabled: event.target.checked })} />Enabled</label>
        <button type="button" onClick={onRemove} className="button-danger min-h-10 px-3">Remove rule</button>
      </div>
    </div>}
  </article>;
}
