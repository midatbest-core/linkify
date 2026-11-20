import { randomUUID } from 'node:crypto';
import { normalizeAndValidateUrl } from '../utils/validation.js';
import { isValidTimeZone, localDateTimeToUtc } from '../utils/schedule.js';

const DEVICES = new Set(['mobile', 'desktop', 'tablet']);
const RULE_ID = /^[a-zA-Z0-9_-]{1,80}$/;
const CAMPAIGN_FIELDS = ['source', 'medium', 'campaign'];
const CAMPAIGN_VALUE = /^[^\u0000-\u001f\u007f]{1,100}$/u;

function normalizeCampaign(campaign, index) {
  if (campaign === undefined || campaign === null) return { value: undefined };
  if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign) || Object.keys(campaign).some((key) => !CAMPAIGN_FIELDS.includes(key))) {
    return { error: `Routing rule ${index + 1} campaign conditions are invalid.` };
  }
  const value = {};
  for (const field of CAMPAIGN_FIELDS) {
    if (campaign[field] === undefined || campaign[field] === '') continue;
    if (typeof campaign[field] !== 'string' || campaign[field].length > 100 || !CAMPAIGN_VALUE.test(campaign[field]) || campaign[field] !== campaign[field].trim()) {
      return { error: `Routing rule ${index + 1} UTM ${field} must be 1–100 printable characters without surrounding whitespace.` };
    }
    value[field] = campaign[field];
  }
  if (!Object.keys(value).length) return { error: `Routing rule ${index + 1} needs at least one UTM condition.` };
  return { value };
}

function normalizeTime(value, timeZone, index, label) {
  if (value === undefined || value === null || value === '') return { value: undefined };
  const date = localDateTimeToUtc(value, timeZone)
    ?? (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(new Date(value).getTime()) ? new Date(value) : null);
  return date ? { value: date } : { error: `Routing rule ${index + 1} ${label} is not a valid local date and time in ${timeZone}.` };
}

export function normalizeAdaptiveRouting(input, { defaultDestinationUrl, previousRouting } = {}) {
  if (input === undefined) return { value: undefined };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Adaptive routing configuration must be an object.' };
  if (typeof input.enabled !== 'boolean') return { error: 'Adaptive routing enabled must be a boolean.' };
  const defaultResult = normalizeAndValidateUrl(input.defaultDestinationUrl ?? defaultDestinationUrl);
  if (defaultResult.error) return { error: `Default destination: ${defaultResult.error}` };
  const rules = input.rules ?? [];
  if (!Array.isArray(rules) || rules.length > 20) return { error: 'Adaptive routing supports up to 20 rules.' };
  const ids = new Set();
  const seenDestinationIds = new Set();
  const history = (Array.isArray(previousRouting?.destinations) ? previousRouting.destinations : []).filter((entry) => {
    if (!entry || typeof entry.destinationId !== 'string' || !entry.destinationId || seenDestinationIds.has(entry.destinationId)) return false;
    if (entry.ownerId !== 'default' && (typeof entry.ownerId !== 'string' || !RULE_ID.test(entry.ownerId))) return false;
    if (typeof entry.destinationUrl !== 'string' || normalizeAndValidateUrl(entry.destinationUrl).error) return false;
    seenDestinationIds.add(entry.destinationId);
    return true;
  }).map((entry) => ({ ...entry }));
  function destinationIdFor(ownerId, destinationUrl, preferredId) {
    if (preferredId && history.some((entry) => entry.destinationId === preferredId && entry.ownerId === ownerId && entry.destinationUrl === destinationUrl)) return preferredId;
    const prior = history.find((entry) => entry.ownerId === ownerId && entry.destinationUrl === destinationUrl);
    if (prior) return prior.destinationId;
    const destinationId = randomUUID();
    history.push({ destinationId, ownerId, destinationUrl });
    return destinationId;
  }
  const defaultDestinationId = destinationIdFor('default', defaultResult.value, previousRouting?.defaultDestinationId);
  const normalizedRules = [];
  const previousRules = Array.isArray(previousRouting?.rules) ? previousRouting.rules : [];
  for (const [index, rule] of rules.entries()) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return { error: `Routing rule ${index + 1} is invalid.` };
    const id = rule.ruleId === undefined ? (previousRules[index]?.ruleId ?? randomUUID()) : rule.ruleId;
    if (typeof id !== 'string' || !RULE_ID.test(id) || ids.has(id)) return { error: 'Routing rule IDs must be unique valid identifiers.' };
    if (rule.deviceType !== undefined && rule.deviceType !== null && rule.deviceType !== '' && !DEVICES.has(rule.deviceType)) return { error: `Routing rule ${index + 1} must target mobile, desktop, or tablet.` };
    if (typeof rule.enabled !== 'boolean') return { error: `Routing rule ${index + 1} enabled must be a boolean.` };
    const destination = normalizeAndValidateUrl(rule.destinationUrl);
    if (destination.error) return { error: `Routing rule ${index + 1}: ${destination.error}` };
    const timeZone = rule.timeZone ?? ((rule.startAt || rule.endAt) ? 'UTC' : undefined);
    if (timeZone !== undefined && !isValidTimeZone(timeZone)) return { error: `Routing rule ${index + 1} must use a valid IANA time zone.` };
    const startAt = normalizeTime(rule.startAt, timeZone, index, 'start time');
    if (startAt.error) return { error: startAt.error };
    const endAt = normalizeTime(rule.endAt, timeZone, index, 'end time');
    if (endAt.error) return { error: endAt.error };
    if (startAt.value && endAt.value && endAt.value <= startAt.value) return { error: `Routing rule ${index + 1} end time must be after its start time.` };
    if (rule.countryCode !== undefined && rule.countryCode !== null && rule.countryCode !== '' && (typeof rule.countryCode !== 'string' || !/^[a-z]{2}$/i.test(rule.countryCode))) return { error: `Routing rule ${index + 1} country must be a two-letter country code.` };
    const campaign = normalizeCampaign(rule.campaign, index);
    if (campaign.error) return { error: campaign.error };
    if (!rule.deviceType && !rule.countryCode && !startAt.value && !endAt.value && !campaign.value) return { error: `Routing rule ${index + 1} needs at least one condition.` };
    const previousRule = previousRules.find((candidate) => candidate?.ruleId === id);
    const destinationId = destinationIdFor(id, destination.value, previousRule?.destinationUrl === destination.value ? previousRule.destinationId : undefined);
    ids.add(id);
    normalizedRules.push({
      ruleId: id, priority: index,
      ...(rule.deviceType ? { deviceType: rule.deviceType } : {}),
      ...(rule.countryCode ? { countryCode: rule.countryCode.toUpperCase() } : {}),
      ...(startAt.value ? { startAt: startAt.value } : {}),
      ...(endAt.value ? { endAt: endAt.value } : {}),
      ...(timeZone ? { timeZone } : {}),
      ...(campaign.value ? { campaign: campaign.value } : {}),
      destinationUrl: destination.value, destinationId, enabled: rule.enabled,
    });
  }
  return { value: { enabled: input.enabled, defaultDestinationUrl: defaultResult.value, defaultDestinationId, destinations: history, rules: normalizedRules } };
}

export function resolveAdaptiveDestination(link, context = 'unknown') {
  const { deviceType = 'unknown', countryCode = null, query = {}, now = new Date() } = typeof context === 'string' ? { deviceType: context } : (context ?? {});
  const rawConfig = link?.adaptiveRouting;
  const config = rawConfig?.toObject?.() ?? rawConfig;
  const legacyDefault = normalizeAndValidateUrl(link?.originalUrl);
  const safeDefault = legacyDefault.error ? null : link.originalUrl;
  if (!config?.enabled) return { destinationUrl: safeDefault, selectedDestinationId: 'default', matchedRuleId: null, usedFallback: true };
  const match = [...(Array.isArray(config.rules) ? config.rules : [])]
    .filter((rule) => {
      if (rule?.enabled !== true || (rule.deviceType && (!DEVICES.has(rule.deviceType) || rule.deviceType !== deviceType))) return false;
      const hasDevice = DEVICES.has(rule.deviceType);
      const hasCountry = typeof rule.countryCode === 'string' && /^[A-Z]{2}$/.test(rule.countryCode);
      const hasSchedule = rule.startAt || rule.endAt;
      const hasCampaign = rule.campaign && typeof rule.campaign === 'object' && !Array.isArray(rule.campaign)
        && Object.keys(rule.campaign).length > 0
        && Object.entries(rule.campaign).every(([field, value]) => CAMPAIGN_FIELDS.includes(field) && typeof value === 'string' && value.length <= 100 && CAMPAIGN_VALUE.test(value));
      if (!hasDevice && !hasCountry && !hasSchedule && !hasCampaign) return false;
      if (rule.countryCode && !hasCountry) return false;
      if (hasSchedule && (!isValidTimeZone(rule.timeZone ?? 'UTC') || (rule.startAt && !Number.isFinite(new Date(rule.startAt).getTime())) || (rule.endAt && !Number.isFinite(new Date(rule.endAt).getTime())))) return false;
      if (rule.campaign && !hasCampaign) return false;
      if (rule.countryCode && rule.countryCode !== countryCode) return false;
      const timestamp = now instanceof Date ? now.getTime() : new Date(now).getTime();
      if (rule.startAt && timestamp < new Date(rule.startAt).getTime()) return false;
      if (rule.endAt && timestamp >= new Date(rule.endAt).getTime()) return false;
      if (rule.campaign) {
        const queryKeys = { source: 'utm_source', medium: 'utm_medium', campaign: 'utm_campaign' };
        for (const [field, key] of Object.entries(queryKeys)) {
          if (!Object.hasOwn(rule.campaign, field)) continue;
          const value = query?.[key];
          if (typeof value !== 'string' || value.length > 100 || value !== rule.campaign[field]) return false;
        }
      }
      return !normalizeAndValidateUrl(rule.destinationUrl).error;
    })
    .sort((a, b) => (Number.isInteger(a.priority) ? a.priority : 0) - (Number.isInteger(b.priority) ? b.priority : 0))[0];
  if (match) return { destinationUrl: match.destinationUrl, selectedDestinationId: match.destinationId ?? `rule:${match.ruleId}`, matchedRuleId: match.ruleId, usedFallback: false };
  const defaultDestination = typeof config.defaultDestinationUrl === 'string' ? config.defaultDestinationUrl : link.originalUrl;
  const validatedDefault = normalizeAndValidateUrl(defaultDestination);
  return { destinationUrl: validatedDefault.error ? safeDefault : defaultDestination, selectedDestinationId: config.defaultDestinationId ?? 'default', matchedRuleId: null, usedFallback: true };
}
