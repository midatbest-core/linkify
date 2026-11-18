import { randomInt } from 'node:crypto';
import { normalizeAndValidateAlias, normalizeAndValidateUrl } from '../utils/validation.js';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const RANDOM_CODE_LENGTH = 7;
const RANDOM_CODE_ATTEMPTS = 5;
const MAX_SUGGESTION_CHECKS = 1000;

export class AliasConflictError extends Error {
  constructor(alias, suggestions) {
    super(`The alias "${alias}" is already in use.`);
    this.name = 'AliasConflictError';
    this.alias = alias;
    this.suggestions = suggestions;
  }
}

export function generateShortCode(length = RANDOM_CODE_LENGTH) {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

export function createLinkService(Link, { codeGenerator = generateShortCode } = {}) {
  async function isAvailable(alias) {
    return !(await Link.exists({ shortCode: alias }));
  }

  async function suggestAliases(alias, limit = 5) {
    const base = alias.slice(0, 32).replace(/-+$/, '');
    const patterns = [
      `${base}-26`, `get-${base}`, `${base}-link`, `use-${base}`, `${base}-2`,
      `${base}-share`, `try-${base}`, `${base}-now`,
    ];
    const suggestions = [];
    const checked = new Set([alias]);

    for (let index = 0; suggestions.length < limit && index < MAX_SUGGESTION_CHECKS; index += 1) {
      const candidate = patterns[index] ?? `${base}-${index - patterns.length + 3}`;
      const validation = normalizeAndValidateAlias(candidate);
      if (checked.has(candidate) || validation.error) continue;
      checked.add(candidate);
      if (await isAvailable(candidate)) suggestions.push(candidate);
    }

    return suggestions;
  }

  async function create({ originalUrl, customAlias }) {
    const destination = normalizeAndValidateUrl(originalUrl);
    if (destination.error) throw Object.assign(new Error(destination.error), { status: 400 });

    let shortCode;
    if (customAlias !== undefined && customAlias !== null && customAlias !== '') {
      const alias = normalizeAndValidateAlias(customAlias);
      if (alias.error) throw Object.assign(new Error(alias.error), { status: 400 });
      shortCode = alias.value;
      try {
        return await Link.create({ originalUrl: destination.value, shortCode, isCustomAlias: true });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        throw new AliasConflictError(shortCode, await suggestAliases(shortCode));
      }
    }

    for (let attempt = 0; attempt < RANDOM_CODE_ATTEMPTS; attempt += 1) {
      shortCode = codeGenerator();
      try {
        return await Link.create({ originalUrl: destination.value, shortCode, isCustomAlias: false });
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
    }

    throw Object.assign(new Error('Could not allocate a unique short code. Please try again.'), { status: 503 });
  }

  async function checkAlias(value) {
    const alias = normalizeAndValidateAlias(value);
    if (alias.error) throw Object.assign(new Error(alias.error), { status: 400 });
    const available = await isAvailable(alias.value);
    return {
      alias: alias.value,
      available,
      suggestions: available ? [] : await suggestAliases(alias.value),
    };
  }

  return { create, checkAlias, suggestAliases };
}
