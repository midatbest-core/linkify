const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

export function appendUtmParameters(originalUrl, supplied = {}) {
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
    throw Object.assign(new Error('UTM parameters must be an object.'), { status: 400 });
  }
  const url = new URL(originalUrl);
  const conflicts = [];
  for (const key of UTM_KEYS) {
    const value = supplied[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || value.length > 200) {
      throw Object.assign(new Error(`${key} must be a string no longer than 200 characters.`), { status: 400 });
    }
    const normalizedValue = value.trim();
    if (!normalizedValue) continue;
    if (url.searchParams.has(key)) {
      if (url.searchParams.get(key) !== normalizedValue) conflicts.push(key);
      continue;
    }
    url.searchParams.append(key, normalizedValue);
  }
  return { url: url.href, conflicts };
}
