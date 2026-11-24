import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const unlockAttempts = new Map();

function getSecret() {
  return process.env.SESSION_SECRET || process.env.COOKIE_SECRET || 'linkify-secret-key-campaign-protection';
}

export async function hashLinkPassword(password) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 1024) {
    throw new Error('Password must be between 1 and 1024 characters.');
  }
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyLinkPassword(password, storedHash) {
  if (!password || !storedHash || typeof password !== 'string' || typeof storedHash !== 'string') return false;
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const expectedBuffer = Buffer.from(expectedHex, 'hex');
  const derived = await scryptAsync(password, salt, expectedBuffer.length);
  if (derived.length !== expectedBuffer.length) return false;
  return timingSafeEqual(derived, expectedBuffer);
}

export function generateUnlockCookie(shortCode, passwordHash, secret = getSecret()) {
  const issuedAt = Date.now().toString();
  const payload = `${shortCode}:${passwordHash}:${issuedAt}`;
  const hmac = createHmac('sha256', secret).update(payload).digest('hex');
  return `${issuedAt}.${hmac}`;
}

export function verifyUnlockCookie(shortCode, passwordHash, cookieValue, secret = getSecret(), maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!cookieValue || typeof cookieValue !== 'string' || !passwordHash) return false;
  const [issuedAtStr, signature] = cookieValue.split('.');
  if (!issuedAtStr || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const issuedAt = parseInt(issuedAtStr, 10);
  if (Number.isNaN(issuedAt) || Date.now() - issuedAt > maxAgeMs || issuedAt > Date.now() + 60000) return false;
  const payload = `${shortCode}:${passwordHash}:${issuedAtStr}`;
  const expectedHmac = createHmac('sha256', secret).update(payload).digest('hex');
  const expectedBuf = Buffer.from(expectedHmac, 'hex');
  const sigBuf = Buffer.from(signature, 'hex');
  if (expectedBuf.length !== sigBuf.length) return false;
  return timingSafeEqual(expectedBuf, sigBuf);
}

export function checkUnlockRateLimit(ip, shortCode, { windowMs = 15 * 60 * 1000, maxAttempts = 5 } = {}) {
  const key = `${ip || 'unknown'}:${shortCode}`;
  const now = Date.now();
  const attempts = (unlockAttempts.get(key) || []).filter((ts) => now - ts < windowMs);
  if (attempts.length >= maxAttempts) {
    const oldest = attempts[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true };
}

export function recordUnlockAttempt(ip, shortCode) {
  const key = `${ip || 'unknown'}:${shortCode}`;
  const now = Date.now();
  const attempts = (unlockAttempts.get(key) || []).filter((ts) => now - ts < 15 * 60 * 1000);
  attempts.push(now);
  unlockAttempts.set(key, attempts);
}

export function clearUnlockAttemptsForTest() {
  unlockAttempts.clear();
}

export async function normalizeAndValidateProtection(input, existing = {}) {
  if (input === undefined) return { value: existing ?? { enabled: false, passwordHash: null, expiresAt: null, maxClicks: null } };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Protection configuration must be an object.' };
  }
  const enabled = Boolean(input.enabled);
  if (!enabled) {
    return {
      value: {
        enabled: false,
        passwordHash: null,
        expiresAt: null,
        maxClicks: null,
      },
    };
  }
  let passwordHash = existing?.passwordHash ?? null;
  if (input.password !== undefined && input.password !== null && input.password !== '') {
    if (typeof input.password !== 'string' || input.password.length > 1024) {
      return { error: 'Password must be a string between 1 and 1024 characters.' };
    }
    passwordHash = await hashLinkPassword(input.password);
  } else if (input.clearPassword) {
    passwordHash = null;
  }

  let expiresAt = null;
  if (input.expiresAt !== undefined && input.expiresAt !== null && input.expiresAt !== '') {
    const d = new Date(input.expiresAt);
    if (!Number.isFinite(d.getTime())) {
      return { error: 'Expiration date must be a valid date/time.' };
    }
    expiresAt = d;
  }

  let maxClicks = null;
  if (input.maxClicks !== undefined && input.maxClicks !== null && input.maxClicks !== '') {
    const num = Number(input.maxClicks);
    if (!Number.isInteger(num) || num < 1) {
      return { error: 'Max clicks must be an integer greater than or equal to 1.' };
    }
    maxClicks = num;
  }

  if (!passwordHash && !expiresAt && !maxClicks) {
    return { error: 'Link protection requires at least one rule (password, expiration date, or max clicks).' };
  }

  return {
    value: {
      enabled: true,
      passwordHash,
      expiresAt,
      maxClicks,
    },
  };
}

export function sanitizeProtectionForClient(protection) {
  if (!protection || !protection.enabled) {
    return { enabled: false, hasPassword: false, expiresAt: null, maxClicks: null };
  }
  return {
    enabled: true,
    hasPassword: Boolean(protection.passwordHash),
    expiresAt: protection.expiresAt ? new Date(protection.expiresAt).toISOString() : null,
    maxClicks: protection.maxClicks ?? null,
  };
}
