import { getAdaptiveRuleSummary, getAdaptiveRuleUrlError } from '../utils/adaptiveRoutingValidation.js';

const COUNTRY_CODES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
const COUNTRY_NAME = new Intl.DisplayNames(['en'], { type: 'region' });
const currentTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TIME_ZONES = ['UTC', currentTimeZone(), ...(Intl.supportedValuesOf?.('timeZone') ?? [])].filter((zone, index, list) => list.indexOf(zone) === index);

function localValue(value, zone) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const fields = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}

export function createAdaptiveRule() {
  return { ruleId: crypto.randomUUID(), deviceType: '', countryCode: '', startAt: '', endAt: '', timeZone: currentTimeZone(), campaign: {}, destinationUrl: '', enabled: true };
}

export function prepareAdaptiveRule(rule) {
  const zone = rule.timeZone || currentTimeZone();
  return { ...rule, deviceType: rule.deviceType ?? '', countryCode: rule.countryCode ?? '', startAt: localValue(rule.startAt, zone), endAt: localValue(rule.endAt, zone), timeZone: zone, campaign: { ...(rule.campaign ?? {}) } };
}

export default function AdaptiveRuleEditor({ rule, index, count, onChange, onMove, onRemove }) {
  const update = (patch) => onChange({ ...rule, ...patch });
  const campaign = rule.campaign ?? {};
  const summary = getAdaptiveRuleSummary({ ...rule, priority: index });
  return <fieldset className="grid min-w-0 gap-3 rounded-lg border border-[#e2ebdd] bg-white p-3 sm:grid-cols-2" aria-label={`Routing rule ${index + 1}`}>
    <legend className="px-1 text-xs font-semibold text-[#526052]">Rule {index + 1} · {rule.enabled ? 'Enabled' : 'Disabled'}</legend>
    <label className="text-xs font-semibold text-[#526052]">Device<select value={rule.deviceType ?? ''} onChange={(event) => update({ deviceType: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-[#dfe8dc] bg-white px-2 text-sm font-normal"><option value="">Any device</option><option value="mobile">Mobile</option><option value="desktop">Desktop</option><option value="tablet">Tablet</option></select></label>
    <label className="text-xs font-semibold text-[#526052]">Country<select value={rule.countryCode ?? ''} onChange={(event) => update({ countryCode: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-[#dfe8dc] bg-white px-2 text-sm font-normal"><option value="">Any country</option>{COUNTRY_CODES.map((code) => <option key={code} value={code}>{COUNTRY_NAME.of(code)} ({code})</option>)}</select></label>
    <label className="min-w-0 text-xs font-semibold text-[#526052] sm:col-span-2">Destination URL<input type="url" required aria-invalid={Boolean(getAdaptiveRuleUrlError(rule.destinationUrl))} value={rule.destinationUrl} onChange={(event) => update({ destinationUrl: event.target.value })} placeholder="https://example.com/destination" className="mt-1 min-h-10 w-full min-w-0 rounded-lg border border-[#dfe8dc] px-3 text-sm font-normal" />{getAdaptiveRuleUrlError(rule.destinationUrl) && <span className="mt-1 block text-xs font-normal text-[#922d21]">{getAdaptiveRuleUrlError(rule.destinationUrl)}</span>}</label>
    <label className="text-xs font-semibold text-[#526052]">Start date and time<input type="datetime-local" value={rule.startAt ?? ''} onChange={(event) => update({ startAt: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-[#dfe8dc] px-2 text-sm font-normal" /></label>
    <label className="text-xs font-semibold text-[#526052]">End date and time<input type="datetime-local" value={rule.endAt ?? ''} onChange={(event) => update({ endAt: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-[#dfe8dc] px-2 text-sm font-normal" /></label>
    <label className="text-xs font-semibold text-[#526052] sm:col-span-2">Schedule time zone<select value={rule.timeZone || 'UTC'} onChange={(event) => update({ timeZone: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-[#dfe8dc] bg-white px-2 text-sm font-normal">{TIME_ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select><span className="mt-1 block font-normal text-[#718071]">Times use this zone and are stored in UTC. Start is inclusive; end is exclusive.</span></label>
    <fieldset className="grid gap-2 rounded-lg bg-[#f8fbf6] p-3 sm:col-span-2 sm:grid-cols-3"><legend className="px-1 text-xs font-semibold text-[#526052]">Campaign query conditions (all must match)</legend>{[['source', 'utm_source'], ['medium', 'utm_medium'], ['campaign', 'utm_campaign']].map(([field, label]) => <label key={field} className="text-xs font-medium text-[#526052]">{label}<input value={campaign[field] ?? ''} maxLength={100} onChange={(event) => update({ campaign: { ...campaign, [field]: event.target.value || undefined } })} className="mt-1 min-h-10 w-full rounded-lg border border-[#dfe8dc] px-2 text-sm font-normal" placeholder="Optional exact match" /></label>)}<p className="text-[11px] leading-4 text-[#718071] sm:col-span-3">UTM matching is exact and case-sensitive. Values are untrusted, limited to 100 characters, and must not contain control characters. Referrer headers are not used.</p></fieldset>
    <p className="rounded-lg bg-[#f5f9f2] p-2 text-xs text-[#526052] sm:col-span-2"><strong>Rule summary:</strong> {summary}</p>
    <div className="flex flex-wrap items-center gap-2 sm:col-span-2"><label className="mr-auto flex min-h-10 items-center gap-2 text-xs font-medium text-[#526052]"><input type="checkbox" checked={rule.enabled !== false} onChange={(event) => update({ enabled: event.target.checked })} />Enabled</label><button type="button" aria-label={`Move rule ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)} className="grid size-9 place-items-center rounded border disabled:opacity-40">↑</button><button type="button" aria-label={`Move rule ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)} className="grid size-9 place-items-center rounded border disabled:opacity-40">↓</button><button type="button" aria-label={`Remove rule ${index + 1}`} onClick={onRemove} className="min-h-9 rounded border border-[#f1c9c4] px-3 text-xs text-[#922d21]">Remove rule</button></div>
  </fieldset>;
}
