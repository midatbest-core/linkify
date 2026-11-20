export function getAdaptiveRuleUrlError(value = '') {
  if (!value.trim()) return 'Enter a destination URL for this rule.';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('invalid URL');
  } catch {
    return 'Use a valid web address beginning with http:// or https://.';
  }
  return '';
}

function isValidLocalDateTime(value) {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value) : null;
  if (!match) return false;
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && date.getUTCHours() === hour && date.getUTCMinutes() === minute;
}

export function firstInvalidAdaptiveRule(rules = []) {
  const index = rules.findIndex((rule) => {
    if (getAdaptiveRuleUrlError(rule.destinationUrl)) return true;
    if (rule.deviceType && !['mobile', 'desktop', 'tablet'].includes(rule.deviceType)) return true;
    if (rule.countryCode && !/^[A-Z]{2}$/.test(rule.countryCode)) return true;
    const campaign = Object.entries(rule.campaign ?? {}).filter(([, value]) => value !== undefined && value !== '');
    if (campaign.some(([key, value]) => !['source', 'medium', 'campaign'].includes(key) || typeof value !== 'string' || value.length > 100 || !/^[^\u0000-\u001f\u007f]{1,100}$/u.test(value) || value !== value.trim())) return true;
    if (rule.startAt || rule.endAt) {
      try { new Intl.DateTimeFormat('en', { timeZone: rule.timeZone || 'UTC' }); }
      catch { return true; }
      const value = rule.startAt || rule.endAt;
      if (!isValidLocalDateTime(value)) return true;
      if (rule.startAt && rule.endAt && !isValidLocalDateTime(rule.endAt)) return true;
    }
    if (rule.startAt && rule.endAt && rule.endAt <= rule.startAt) return true;
    return !(rule.deviceType || rule.countryCode || rule.startAt || rule.endAt || campaign.length);
  });
  if (index < 0) return null;
  const rule = rules[index];
  let message = getAdaptiveRuleUrlError(rule.destinationUrl);
  if (!message && !rule.deviceType && !rule.countryCode && !rule.startAt && !rule.endAt && !Object.values(rule.campaign ?? {}).some(Boolean)) message = 'Add at least one condition to this rule.';
  if (!message && rule.startAt && rule.endAt && rule.endAt <= rule.startAt) message = 'The end time must be after the start time.';
  if (!message) message = 'Check the country, schedule, time zone, or UTM condition values.';
  return { index, message };
}

export function getAdaptiveRuleSummary(rule) {
  const conditions = [];
  if (rule.deviceType) conditions.push(`${rule.deviceType} device`);
  if (rule.countryCode) conditions.push(`country ${rule.countryCode}`);
  if (rule.startAt || rule.endAt) conditions.push(`active ${rule.startAt || 'any time'} to ${rule.endAt || 'any time'} (${rule.timeZone || 'UTC'})`);
  for (const [field, value] of Object.entries(rule.campaign ?? {})) if (value) conditions.push(`utm_${field} = “${value}”`);
  return `${rule.enabled === false ? 'Disabled; ' : ''}${conditions.length ? conditions.join(' AND ') : 'No conditions'}; priority ${Number.isInteger(rule.priority) ? rule.priority + 1 : 'by list order'}; destination ${rule.destinationUrl || '(not set)'}`;
}

export function serializeAdaptiveRule(rule) {
  const campaign = Object.fromEntries(Object.entries(rule.campaign ?? {}).filter(([, value]) => typeof value === 'string' && value.length > 0));
  return {
    ruleId: rule.ruleId,
    ...(rule.deviceType ? { deviceType: rule.deviceType } : {}),
    ...(rule.countryCode ? { countryCode: rule.countryCode } : {}),
    ...(rule.startAt ? { startAt: rule.startAt } : {}),
    ...(rule.endAt ? { endAt: rule.endAt } : {}),
    ...(rule.timeZone && (rule.startAt || rule.endAt) ? { timeZone: rule.timeZone } : {}),
    ...(Object.keys(campaign).length ? { campaign } : {}),
    destinationUrl: rule.destinationUrl,
    enabled: rule.enabled !== false,
  };
}
