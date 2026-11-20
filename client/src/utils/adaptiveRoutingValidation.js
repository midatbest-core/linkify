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

export function firstInvalidAdaptiveRule(rules = []) {
  const index = rules.findIndex((rule) => getAdaptiveRuleUrlError(rule.destinationUrl));
  return index < 0 ? null : { index, message: getAdaptiveRuleUrlError(rules[index].destinationUrl) };
}
