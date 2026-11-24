import { normalizeAndValidateUrl } from '../utils/validation.js';

export function normalizeAndValidateExperiments(input) {
  if (input === undefined) return { value: undefined };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Experiments configuration must be an object.' };
  }
  const enabled = Boolean(input.enabled);
  if (!enabled) {
    return { value: { enabled: false, variants: [] } };
  }
  const variants = input.variants;
  if (!Array.isArray(variants) || variants.length !== 2) {
    return { error: 'A/B experimentation requires exactly two variants (Variant A and Variant B).' };
  }
  const normalizedVariants = [];
  let totalWeight = 0;
  const seenIds = new Set();

  for (let i = 0; i < 2; i += 1) {
    const v = variants[i];
    if (!v || typeof v !== 'object') {
      return { error: `Variant ${i + 1} is invalid.` };
    }
    const defaultId = `variant-${String.fromCharCode(97 + i)}`;
    const variantId = typeof v.variantId === 'string' && v.variantId.trim() ? v.variantId.trim() : defaultId;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(variantId) || seenIds.has(variantId)) {
      return { error: `Variant ${i + 1} has an invalid or duplicate ID.` };
    }
    seenIds.add(variantId);
    const defaultLabel = `Variant ${String.fromCharCode(65 + i)}`;
    const label = typeof v.label === 'string' && v.label.trim() ? v.label.trim() : defaultLabel;
    if (!label || label.length > 80) {
      return { error: `Variant ${i + 1} label must be between 1 and 80 characters.` };
    }
    const dest = normalizeAndValidateUrl(v.destinationUrl);
    if (dest.error) {
      return { error: `Variant ${i + 1} URL: ${dest.error}` };
    }
    const weight = Number(v.weight);
    if (!Number.isInteger(weight) || weight < 1 || weight > 99) {
      return { error: `Variant ${i + 1} weight must be an integer between 1 and 99.` };
    }
    totalWeight += weight;
    normalizedVariants.push({
      variantId,
      label,
      destinationUrl: dest.value,
      weight,
    });
  }

  if (totalWeight !== 100) {
    return { error: `Variant weights must sum exactly to 100% (currently ${totalWeight}%).` };
  }

  return {
    value: {
      enabled: true,
      variants: normalizedVariants,
    },
  };
}

export function selectVariant(experiment, cookies = {}, { shortCode, stageId = 'default' } = {}) {
  if (!experiment?.enabled || !Array.isArray(experiment.variants) || experiment.variants.length !== 2) {
    return null;
  }
  const cookieName = `linkify_ab_${shortCode}_${stageId}`;
  const existingVariantId = cookies[cookieName];
  if (existingVariantId) {
    const matched = experiment.variants.find((v) => v.variantId === existingVariantId);
    if (matched) {
      return {
        variant: matched,
        isNewAssignment: false,
        cookieName,
        cookieValue: matched.variantId,
      };
    }
  }

  const [varA, varB] = experiment.variants;
  const roll = Math.random() * 100;
  const selected = roll < varA.weight ? varA : varB;
  return {
    variant: selected,
    isNewAssignment: true,
    cookieName,
    cookieValue: selected.variantId,
  };
}
