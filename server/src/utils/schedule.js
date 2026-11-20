const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const TIME_ZONE_VALIDITY = new Map();

function formatter(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
}

function partsAt(format, timestamp) {
  return Object.fromEntries(format.formatToParts(new Date(timestamp))
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]));
}

function utcEpoch({ year, month, day, hour = 0, minute = 0, second = 0 }) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function wallParts(parts) {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length > 100) return false;
  if (TIME_ZONE_VALIDITY.has(timeZone)) return TIME_ZONE_VALIDITY.get(timeZone);
  let valid = true;
  try { formatter(timeZone); } catch { valid = false; }
  TIME_ZONE_VALIDITY.set(timeZone, valid);
  return valid;
}

// Local wall time to UTC. During a DST fold, choose the earlier occurrence;
// reject nonexistent local times in a DST gap instead of silently shifting.
export function localDateTimeToUtc(value, timeZone) {
  const match = typeof value === 'string' ? LOCAL_DATE_TIME.exec(value) : null;
  if (!match || !isValidTimeZone(timeZone)) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const wallUtc = utcEpoch({ year, month, day, hour, minute });
  const check = new Date(wallUtc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute) return null;
  const format = formatter(timeZone);
  const offsets = new Set();
  for (let delta = -48; delta <= 48; delta += 6) {
    const probe = wallUtc + delta * 3600000;
    const parts = partsAt(format, probe);
    const asUtc = utcEpoch(parts);
    offsets.add(Math.round((asUtc - probe) / 60000) * 60000);
  }
  const candidates = [...offsets]
    .map((offset) => wallUtc - offset)
    .filter((timestamp) => wallParts(partsAt(format, timestamp)) === value)
    .sort((a, b) => a - b);
  return candidates.length ? new Date(candidates[0]) : null;
}

export function utcDateTimeToLocal(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()) || !isValidTimeZone(timeZone)) return '';
  return wallParts(partsAt(formatter(timeZone), date.getTime()));
}
