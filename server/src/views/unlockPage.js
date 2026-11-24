function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderUnlockPage({ shortCode, error, retryAfterSeconds }) {
  const safeShortCode = escapeHtml(shortCode);
  let errorMessage = '';
  if (error === 'invalid_password') {
    errorMessage = '<div class="alert error" role="alert">Incorrect password. Please try again.</div>';
  } else if (error === 'rate_limited') {
    const retryText = retryAfterSeconds ? ` Please try again in ${retryAfterSeconds} seconds.` : ' Please try again later.';
    errorMessage = `<div class="alert error" role="alert">Too many failed attempts.${escapeHtml(retryText)}</div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Protected Link — Linkify</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #111827;
      --border: #1f2937;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --error-bg: #450a0a;
      --error-text: #fca5a5;
      --error-border: #7f1d1d;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
    }
    .card {
      background-color: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2.25rem;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
    }
    .logo {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.25rem;
      font-weight: 700;
      color: #60a5fa;
      margin-bottom: 1.5rem;
      text-decoration: none;
    }
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.25rem 0.6rem;
      border-radius: 9999px;
      background-color: rgba(59, 130, 246, 0.15);
      color: #93c5fd;
      border: 1px solid rgba(59, 130, 246, 0.3);
      margin-bottom: 0.75rem;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
    }
    p.desc {
      font-size: 0.95rem;
      color: var(--text-muted);
      margin-bottom: 1.75rem;
      line-height: 1.5;
    }
    .code-pill {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #93c5fd;
      background: #1e293b;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
    }
    .alert {
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.875rem;
      margin-bottom: 1.25rem;
    }
    .alert.error {
      background-color: var(--error-bg);
      color: var(--error-text);
      border: 1px solid var(--error-border);
    }
    .form-group {
      margin-bottom: 1.25rem;
    }
    label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      margin-bottom: 0.5rem;
      color: var(--text-muted);
    }
    input[type="password"] {
      width: 100%;
      padding: 0.75rem 1rem;
      background-color: #0f172a;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 1rem;
      outline: none;
      transition: border-color 0.15s ease;
    }
    input[type="password"]:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
    }
    button[type="submit"] {
      width: 100%;
      padding: 0.8rem 1rem;
      background-color: var(--primary);
      color: #ffffff;
      font-size: 0.95rem;
      font-weight: 600;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: background-color 0.15s ease;
    }
    button[type="submit"]:hover {
      background-color: var(--primary-hover);
    }
    .footer {
      margin-top: 1.75rem;
      text-align: center;
      font-size: 0.8rem;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="logo">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
      </svg>
      Linkify
    </div>
    <div><span class="badge">Protected Link</span></div>
    <h1>Password Required</h1>
    <p class="desc">The link <span class="code-pill">/${safeShortCode}</span> is protected. Enter the password below to access the destination.</p>
    ${errorMessage}
    <form method="POST" action="/${safeShortCode}/unlock">
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autofocus autocomplete="current-password" placeholder="Enter link password" maxlength="1024" />
      </div>
      <button type="submit">Unlock &amp; Continue</button>
    </form>
    <div class="footer">
      Protected with end-to-end access verification by Linkify
    </div>
  </main>
</body>
</html>`;
}
