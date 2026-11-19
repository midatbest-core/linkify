import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = 'linkify_admin';
const SESSION_MS = 8 * 60 * 60 * 1000;

function cookieValue(request) {
  const part = (request?.headers?.cookie ?? '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE_NAME}=`));
  if (!part) return null;
  try { return decodeURIComponent(part.slice(COOKIE_NAME.length + 1)); } catch { return null; }
}

function cookieOptions(production, expired = false) {
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${expired ? 0 : 28800}${production ? '; Secure' : ''}`;
}

export function isValidAdminPasswordHash(passwordHash) {
  const match = /^scrypt\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(passwordHash ?? '');
  if (!match) return false;
  return Buffer.from(match[1], 'base64url').length >= 16 && Buffer.from(match[2], 'base64url').length === 64;
}

function credentialsConfigured(username, passwordHash) {
  return Boolean(username && isValidAdminPasswordHash(passwordHash));
}

function credentialVersion(username, passwordHash) {
  return createHash('sha256').update(`${username}\0${passwordHash}`).digest('hex');
}

export async function verifyAdminPassword(password, encodedHash) {
  const [, salt, expected] = String(encodedHash ?? '').split('$');
  if (!salt || !expected) return false;
  try {
    const expectedBytes = Buffer.from(expected, 'base64url');
    const actual = await scrypt(password, Buffer.from(salt, 'base64url'), expectedBytes.length);
    return expectedBytes.length > 0 && timingSafeEqual(expectedBytes, actual);
  } catch { return false; }
}

export function createAdminAuth({ sessionModel, username = process.env.ADMIN_USERNAME, passwordHash = process.env.ADMIN_PASSWORD_HASH, clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5174', production = process.env.NODE_ENV === 'production' } = {}) {
  const issueCookie = (response, token) => response.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieOptions(production)}`);
  const clearCookie = (response) => response.setHeader('Set-Cookie', `${COOKIE_NAME}=; ${cookieOptions(production, true)}`);
  const login = async (request, response, next) => {
    if (!credentialsConfigured(username, passwordHash) || !sessionModel) return response.status(503).json({ error: 'Admin authentication is not configured.' });
    const suppliedUsername = typeof request.body?.username === 'string' ? request.body.username : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    try {
      const passwordValid = password.length <= 1024 && await verifyAdminPassword(password, passwordHash);
      if (!(suppliedUsername.length <= 128 && suppliedUsername === username && passwordValid)) return response.status(401).json({ error: 'Invalid username or password.' });
      const token = randomBytes(32).toString('base64url');
      const previousToken = cookieValue(request);
      if (previousToken) await sessionModel.deleteOne({ tokenHash: createHash('sha256').update(previousToken).digest('hex') });
      await sessionModel.create({ tokenHash: createHash('sha256').update(token).digest('hex'), credentialVersion: credentialVersion(username, passwordHash), expiresAt: new Date(Date.now() + SESSION_MS) });
      issueCookie(response, token);
      return response.json({ authenticated: true, username });
    } catch (error) { return next(error); }
  };
  const logout = async (request, response, next) => {
    try {
      const token = cookieValue(request);
      if (token && sessionModel) await sessionModel.deleteOne({ tokenHash: createHash('sha256').update(token).digest('hex') });
      clearCookie(response);
      return response.json({ authenticated: false });
    } catch (error) { return next(error); }
  };
  const status = async (request, response, next) => {
    const token = cookieValue(request);
    if (!token || !sessionModel || !credentialsConfigured(username, passwordHash)) return response.json({ authenticated: false });
    try {
      const session = await sessionModel.findOne({ tokenHash: createHash('sha256').update(token).digest('hex'), credentialVersion: credentialVersion(username, passwordHash), expiresAt: { $gt: new Date() } });
      return response.json({ authenticated: Boolean(session), ...(session ? { username } : {}) });
    } catch (error) { return next(error); }
  };
  const requireAdmin = async (request, response, next) => {
    if (!credentialsConfigured(username, passwordHash) || !sessionModel) return response.status(503).json({ error: 'Admin authentication is not configured.' });
    const token = cookieValue(request);
    if (!token) return response.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' });
    try {
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const session = await sessionModel.findOne({ tokenHash, credentialVersion: credentialVersion(username, passwordHash), expiresAt: { $gt: new Date() } });
      if (!session) { clearCookie(response); return response.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' }); }
      request.adminSession = session;
      return next();
    } catch (error) { return next(error); }
  };
  const requireSameOrigin = (request, response, next) => {
    if (request.headers.origin !== clientOrigin) return response.status(403).json({ error: 'Request origin is not allowed.' });
    next();
  };
  return { login, logout, status, requireAdmin, requireSameOrigin };
}

export { COOKIE_NAME as ADMIN_COOKIE_NAME, SESSION_MS as ADMIN_SESSION_MS };
