export async function authenticatedFetch(url, options = {}) {
  const response = await fetch(url, { credentials: 'include', ...options });
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('linkify:unauthorized'));
  }
  return response;
}

export async function invalidateSession(url) {
  const response = await authenticatedFetch(url, { method: 'POST' });
  if (!response.ok && response.status !== 401) {
    throw new Error('Could not sign out. Please try again.');
  }
  return response.status === 401 ? 'expired' : 'invalidated';
}
