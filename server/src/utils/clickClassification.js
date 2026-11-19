const BOT_PATTERN = /(bot|crawler|spider|slurp|preview|headless|curl|wget|python-requests|httpclient|facebookexternalhit|slackbot|discordbot|telegrambot|whatsapp|twitterbot|linkedinbot)/i;

export function classifyDevice(userAgent = '') {
  if (typeof userAgent !== 'string') return 'unknown';
  if (/ipad|tablet|kindle|silk/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(userAgent)) return 'mobile';
  if (/windows|macintosh|mac os|x11|linux|cros/i.test(userAgent)) return 'desktop';
  return 'unknown';
}

export function classifyBrowser(userAgent = '') {
  if (typeof userAgent !== 'string') return 'unknown';
  if (/edg\//i.test(userAgent)) return 'Edge';
  if (/opr\//i.test(userAgent)) return 'Opera';
  if (/samsungbrowser\//i.test(userAgent)) return 'Samsung Internet';
  if (/fxios\//i.test(userAgent)) return 'Firefox';
  if (/crios\//i.test(userAgent)) return 'Chrome';
  if (/firefox\//i.test(userAgent)) return 'Firefox';
  if (/chrome\//i.test(userAgent) && !/chromium\//i.test(userAgent)) return 'Chrome';
  if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)) return 'Safari';
  return 'unknown';
}

export function classifyOperatingSystem(userAgent = '') {
  if (typeof userAgent !== 'string') return 'unknown';
  if (/android/i.test(userAgent)) return 'Android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS';
  if (/windows/i.test(userAgent)) return 'Windows';
  if (/mac os|macintosh/i.test(userAgent)) return 'macOS';
  if (/cros/i.test(userAgent)) return 'Chrome OS';
  if (/linux|x11/i.test(userAgent)) return 'Linux';
  return 'unknown';
}

export function normalizeReferrer(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.hostname.toLowerCase() || null : null;
  } catch { return null; }
}

export function classifyClickRequest({ userAgent, referrer } = {}) {
  const safeAgent = typeof userAgent === 'string' ? userAgent.slice(0, 1024) : '';
  return {
    referrer: normalizeReferrer(referrer),
    deviceType: classifyDevice(safeAgent),
    browser: classifyBrowser(safeAgent),
    operatingSystem: classifyOperatingSystem(safeAgent),
    isBot: BOT_PATTERN.test(safeAgent),
  };
}
