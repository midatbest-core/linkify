import { authenticatedFetch } from './authenticatedFetch.js';

const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:5000' : '');

async function request(path, options) {
  let response;
  try { response = await authenticatedFetch(`${API_URL}${path}`, options); }
  catch (error) { if (error?.name === 'AbortError') throw error; throw new Error('Could not reach Linkify. Check your connection and try again.'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('Linkify returned an unexpected response.'); }
  if (!response.ok) {
    const error = new Error(data.error ?? 'The flow request failed.');
    error.status = response.status;
    error.code = data.code;
    error.alias = data.alias;
    error.suggestions = data.suggestions;
    throw error;
  }
  return data;
}

export const flowApi = {
  list: () => request('/api/flows'),
  get: (id) => request(`/api/flows/${encodeURIComponent(id)}`),
  create: (flow) => request('/api/flows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flow) }),
  update: (id, flow) => request(`/api/flows/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flow) }),
  validate: (id, flow) => request(`/api/flows/${encodeURIComponent(id)}/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flow) }),
  remove: (id) => request(`/api/flows/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  publish: (id, body, idempotencyKey) => request(`/api/flows/${encodeURIComponent(id)}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) }),
  rollback: (id, body, idempotencyKey) => request(`/api/flows/${encodeURIComponent(id)}/rollback`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) }),
  archive: (id, body = {}, idempotencyKey) => {
    const key = typeof body === 'string' ? body : idempotencyKey;
    const payload = typeof body === 'object' ? body : {};
    return request(`/api/flows/${encodeURIComponent(id)}/archive`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(payload) });
  },
  restore: (id, body = {}, idempotencyKey) => {
    const key = typeof body === 'string' ? body : idempotencyKey;
    const payload = typeof body === 'object' ? body : {};
    return request(`/api/flows/${encodeURIComponent(id)}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(payload) });
  },
  activeDestination: (id) => request(`/api/flows/${encodeURIComponent(id)}/active-destination`),
  simulate: (id, body) => request(`/api/flows/${encodeURIComponent(id)}/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  analytics: (id, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/flows/${encodeURIComponent(id)}/analytics${q ? `?${q}` : ''}`);
  },
  history: (id, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/flows/${encodeURIComponent(id)}/history${q ? `?${q}` : ''}`);
  },
  diff: (id, from, to) => request(`/api/flows/${encodeURIComponent(id)}/history/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  aliasAvailability: (alias) => request(`/api/aliases/${encodeURIComponent(alias)}/availability`),
};
