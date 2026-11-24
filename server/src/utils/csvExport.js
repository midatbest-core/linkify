/**
 * RFC 4180 CSV serializer with formula injection sanitization.
 * Prepends a single quote (') to values that start with =, +, -, @, \t, or \r.
 */

function sanitizeForCsv(value) {
  if (value === null || value === undefined) return '';
  let str = String(value);
  // Formula injection check: if the trimmed string begins with formula triggers
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // RFC 4180 escaping: if it contains comma, double-quote, or newline, wrap in double quotes
  if (/[",\r\n]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateCsv({ headers, rows }) {
  const headerLine = headers.map((h) => sanitizeForCsv(h.label ?? h)).join(',');
  const rowLines = rows.map((row) => {
    return headers.map((h) => {
      const key = h.key ?? h;
      const val = typeof row[key] === 'function' ? row[key]() : row[key];
      return sanitizeForCsv(val);
    }).join(',');
  });
  return [headerLine, ...rowLines].join('\r\n');
}
