export const RESERVED_ALIASES = new Set([
  'api', 'admin', 'dashboard', 'login', 'health', 'favicon', 'robots.txt',
]);

export function normalizeAndValidateUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { error: 'Enter a destination URL.' };
  }

  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      return { error: 'Only valid HTTP and HTTPS URLs are supported.' };
    }
    return { value: url.href };
  } catch {
    return { error: 'Enter a valid HTTP or HTTPS URL.' };
  }
}

export function normalizeAndValidateAlias(value) {
  if (typeof value !== 'string') return { error: 'Alias must be a string.' };
  const alias = value.trim().toLowerCase();
  if (alias.length < 3 || alias.length > 40) {
    return { error: 'Aliases must be 3–40 characters long.' };
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(alias)) {
    return { error: 'Use lowercase letters, numbers, and single hyphens only.' };
  }
  if (RESERVED_ALIASES.has(alias)) {
    return { error: 'That alias is reserved for the application.' };
  }
  return { value: alias };
}
