const canonicalLabels = new Map([
  ['unknown', 'Unknown'], ['desktop', 'Desktop'], ['mobile', 'Mobile'], ['tablet', 'Tablet'],
  ['chrome', 'Chrome'], ['chromium', 'Chromium'], ['safari', 'Safari'], ['firefox', 'Firefox'],
  ['edge', 'Edge'], ['opera', 'Opera'], ['samsung internet', 'Samsung Internet'],
  ['android', 'Android'], ['windows', 'Windows'], ['macos', 'macOS'], ['ios', 'iOS'],
  ['chrome os', 'Chrome OS'], ['linux', 'Linux'], ['bots', 'Bots'], ['non-bots', 'Non-bots'],
]);

export function formatAnalyticsLabel(value, fallback = 'Unknown') {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const label = value.trim();
  const canonical = canonicalLabels.get(label.toLowerCase());
  if (canonical) return canonical;
  // Only normalize all-lowercase labels. Preserve source capitalization for
  // names such as macOS, McAllen, and other proper nouns.
  if (label === label.toLowerCase()) return label.replace(/(^|[\s-])[a-z]/g, (letter) => letter.toUpperCase());
  return label;
}

export function formatCountryName(countryName, countryCode) {
  if (typeof countryCode === 'string' && /^[a-z]{2}$/i.test(countryCode) && countryCode.toLowerCase() !== 'un') {
    try {
      const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode.toUpperCase());
      if (name && name !== countryCode.toUpperCase()) return name;
    } catch {}
  }
  return formatAnalyticsLabel(countryName);
}
