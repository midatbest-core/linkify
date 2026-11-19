export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

export function buildUtmPreview(originalUrl, values = {}) {
  if (!originalUrl.trim()) return { url: '', conflicts: [] };
  try {
    const url = new URL(originalUrl.trim());
    const conflicts = [];
    for (const key of UTM_KEYS) {
      const value = values[key]?.trim();
      if (!value) continue;
      if (url.searchParams.has(key)) {
        if (url.searchParams.get(key) !== value) conflicts.push(key);
        continue;
      }
      url.searchParams.append(key, value);
    }
    return { url: url.href, conflicts };
  } catch { return { url: '', conflicts: [] }; }
}
