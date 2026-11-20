import { randomInt } from 'node:crypto';
import { normalizeAndValidateAlias, normalizeAndValidateUrl } from '../utils/validation.js';
import { appendUtmParameters } from '../utils/utm.js';
import { normalizeAdaptiveRouting } from './adaptiveRoutingService.js';

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

  async function create({ originalUrl: suppliedOriginalUrl, customAlias, utm, title, tags, adaptiveRouting }) {
    const originalUrl = suppliedOriginalUrl ?? adaptiveRouting?.defaultDestinationUrl;
    const destination = normalizeAndValidateUrl(originalUrl);
    if (destination.error) throw Object.assign(new Error(destination.error), { status: 400 });
    const adaptiveResult = normalizeAdaptiveRouting(adaptiveRouting, { defaultDestinationUrl: destination.value });
    if (adaptiveResult.error) throw Object.assign(new Error(adaptiveResult.error), { status: 400 });
    const routing = adaptiveResult.value;
    const { url: finalUrl, conflicts: utmConflicts } = appendUtmParameters(routing?.defaultDestinationUrl ?? destination.value, utm);
    const metadata = normalizeLinkMetadata({ title, tags });
    if (metadata.error) throw Object.assign(new Error(metadata.error), { status: 400 });

    let shortCode;
    if (customAlias !== undefined && customAlias !== null && customAlias !== '') {
      const alias = normalizeAndValidateAlias(customAlias);
      if (alias.error) throw Object.assign(new Error(alias.error), { status: 400 });
      shortCode = alias.value;
      try {
        return { link: await Link.create({ originalUrl: finalUrl, shortCode, isCustomAlias: true, ...(routing ? { adaptiveRouting: { ...routing, defaultDestinationUrl: finalUrl } } : {}), ...metadata }), utmConflicts };
      } catch (error) {
        if (error?.code !== 11000) throw error;
        throw new AliasConflictError(shortCode, await suggestAliases(shortCode));
      }
    }

    for (let attempt = 0; attempt < RANDOM_CODE_ATTEMPTS; attempt += 1) {
      shortCode = codeGenerator();
      try {
        return { link: await Link.create({ originalUrl: finalUrl, shortCode, isCustomAlias: false, ...(routing ? { adaptiveRouting: { ...routing, defaultDestinationUrl: finalUrl } } : {}), ...metadata }), utmConflicts };
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
    }

    throw Object.assign(new Error('Could not allocate a unique short code. Please try again.'), { status: 503 });
  }

  async function update(id, input = {}) {
    const allowed = ['originalUrl', 'title', 'tags', 'status', 'adaptiveRouting'];
    const keys = Object.keys(input);
    if (!keys.length || keys.some((key) => !allowed.includes(key))) {
      throw Object.assign(new Error('Provide one or more supported link fields to update.'), { status: 400 });
    }
    const current = await Link.findById(id);
    if (!current) return null;
    const updates = {};
    if (Object.hasOwn(input, 'originalUrl')) {
      const destination = normalizeAndValidateUrl(input.originalUrl);
      if (destination.error) throw Object.assign(new Error(destination.error), { status: 400 });
      updates.originalUrl = destination.value;
    }
    if (Object.hasOwn(input, 'adaptiveRouting')) {
      const previousRouting = current.adaptiveRouting?.toObject?.() ?? current.adaptiveRouting;
      const routing = normalizeAdaptiveRouting(input.adaptiveRouting, { defaultDestinationUrl: input.originalUrl ?? current.originalUrl, previousRouting });
      if (routing.error) throw Object.assign(new Error(routing.error), { status: 400 });
      updates.adaptiveRouting = routing.value;
      // Keep legacy consumers' originalUrl as the default destination.
      updates.originalUrl = routing.value.defaultDestinationUrl;
    } else if (Object.hasOwn(updates, 'originalUrl')) {
      const previousRouting = current.adaptiveRouting?.toObject?.() ?? current.adaptiveRouting;
      if (previousRouting?.enabled) {
        const routing = normalizeAdaptiveRouting({ ...previousRouting, defaultDestinationUrl: updates.originalUrl }, { previousRouting });
        if (routing.error) throw Object.assign(new Error(routing.error), { status: 400 });
        updates.adaptiveRouting = routing.value;
      }
    }
    const metadata = normalizeLinkMetadata(input, { partial: true });
    if (metadata.error) throw Object.assign(new Error(metadata.error), { status: 400 });
    Object.assign(updates, metadata);
    if (Object.hasOwn(input, 'status')) {
      if (!['active', 'archived'].includes(input.status)) throw Object.assign(new Error('Status must be active or archived.'), { status: 400 });
      updates.status = input.status;
    }
    if (typeof Link.findOneAndUpdate === 'function') {
      const versionFilter = Number.isInteger(current.__v) ? { __v: current.__v } : { __v: { $exists: false } };
      const changed = await Link.findOneAndUpdate({ _id: id, ...versionFilter }, { $set: updates, $inc: { __v: 1 } }, { new: true, runValidators: true });
      if (!changed) throw Object.assign(new Error('This link changed while you were editing it. Reload it and try again.'), { status: 409 });
      return changed;
    }
    return Link.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true });
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

  return { create, update, checkAlias, suggestAliases };
}

export function normalizeLinkMetadata({ title, tags } = {}, { partial = false } = {}) {
  const normalized = {};
  if (!partial || title !== undefined) {
    const normalizedTitle = title === undefined || title === null ? '' : typeof title === 'string' ? title.trim() : null;
    if (normalizedTitle === null || normalizedTitle.length > 120) return { error: 'Title must be a string of up to 120 characters.' };
    normalized.title = normalizedTitle;
  }
  if (!partial || tags !== undefined) {
    const normalizedTags = tags ?? [];
    if (!Array.isArray(normalizedTags) || normalizedTags.length > 20 || normalizedTags.some((tag) => typeof tag !== 'string' || tag.trim().length === 0 || tag.trim().length > 40)) {
      return { error: 'Tags must be up to 20 non-empty strings of at most 40 characters each.' };
    }
    normalized.tags = [...new Set(normalizedTags.map((tag) => tag.trim()))];
  }
  return normalized;
}
