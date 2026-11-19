const DAY_MS = 24 * 60 * 60 * 1000;

function parseUtcDate(value, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
    throw Object.assign(new Error(`${field} must use YYYY-MM-DD format.`), { status: 400 });
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw Object.assign(new Error(`${field} is not a valid calendar date.`), { status: 400 });
  }
  return date;
}

export function parseDateRange({ from, to } = {}, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = from ? parseUtcDate(from, 'from') : new Date(today.getTime() - 29 * DAY_MS);
  const lastDay = to ? parseUtcDate(to, 'to') : today;
  if (start > lastDay) throw Object.assign(new Error('from must be on or before to.'), { status: 400 });
  const days = Math.floor((lastDay - start) / DAY_MS) + 1;
  if (days > 366) throw Object.assign(new Error('Date ranges cannot exceed 366 days.'), { status: 400 });
  return {
    from: start,
    toExclusive: new Date(lastDay.getTime() + DAY_MS),
    fromDate: start.toISOString().slice(0, 10),
    toDate: lastDay.toISOString().slice(0, 10),
  };
}
