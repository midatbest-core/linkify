import { randomUUID } from 'node:crypto';
import { normalizeAndValidateUrl } from '../utils/validation.js';

const DEVICES = new Set(['mobile', 'desktop', 'tablet']);
const RULE_ID = /^[a-zA-Z0-9_-]{1,80}$/;

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
  const previousRules = previousRouting?.rules ?? [];
  for (const [index, rule] of rules.entries()) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return { error: `Routing rule ${index + 1} is invalid.` };
    const id = rule.ruleId === undefined ? (previousRules[index]?.ruleId ?? randomUUID()) : rule.ruleId;
    if (typeof id !== 'string' || !RULE_ID.test(id) || ids.has(id)) return { error: 'Routing rule IDs must be unique valid identifiers.' };
    if (!DEVICES.has(rule.deviceType)) return { error: `Routing rule ${index + 1} must target mobile, desktop, or tablet.` };
    if (typeof rule.enabled !== 'boolean') return { error: `Routing rule ${index + 1} enabled must be a boolean.` };
    const destination = normalizeAndValidateUrl(rule.destinationUrl);
    if (destination.error) return { error: `Routing rule ${index + 1}: ${destination.error}` };
    const previousRule = previousRules.find((candidate) => candidate?.ruleId === id);
    const destinationId = destinationIdFor(id, destination.value, previousRule?.destinationUrl === destination.value ? previousRule.destinationId : undefined);
    ids.add(id);
    normalizedRules.push({ ruleId: id, priority: index, deviceType: rule.deviceType, destinationUrl: destination.value, destinationId, enabled: rule.enabled });
  }
  return { value: { enabled: input.enabled, defaultDestinationUrl: defaultResult.value, defaultDestinationId, destinations: history, rules: normalizedRules } };
}

export function resolveAdaptiveDestination(link, deviceType = 'unknown') {
  const config = link?.adaptiveRouting;
  const legacyDefault = normalizeAndValidateUrl(link?.originalUrl);
  const safeDefault = legacyDefault.error ? null : link.originalUrl;
  if (!config?.enabled) return { destinationUrl: safeDefault, selectedDestinationId: 'default', matchedRuleId: null, usedFallback: true };
  const match = [...(Array.isArray(config.rules) ? config.rules : [])]
    .filter((rule) => rule?.enabled === true && DEVICES.has(rule.deviceType) && rule.deviceType === deviceType && !normalizeAndValidateUrl(rule.destinationUrl).error)
    .sort((a, b) => (Number.isInteger(a.priority) ? a.priority : 0) - (Number.isInteger(b.priority) ? b.priority : 0))[0];
  if (match) return { destinationUrl: match.destinationUrl, selectedDestinationId: match.destinationId ?? `rule:${match.ruleId}`, matchedRuleId: match.ruleId, usedFallback: false };
  const defaultDestination = typeof config.defaultDestinationUrl === 'string' ? config.defaultDestinationUrl : link.originalUrl;
  const validatedDefault = normalizeAndValidateUrl(defaultDestination);
  return { destinationUrl: validatedDefault.error ? safeDefault : defaultDestination, selectedDestinationId: config.defaultDestinationId ?? 'default', matchedRuleId: null, usedFallback: true };
}
