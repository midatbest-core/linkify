import { authenticatedFetch } from './authenticatedFetch.js';

const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:5000' : '');

async function request(path, options) {
  let response;
  try { response = await authenticatedFetch(`${API_URL}${path}`, options); }
  catch (error) { if (error?.name === 'AbortError') throw error; throw new Error('Could not reach Linkify. Check your connection and try again.'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('Linkify returned an unexpected response.'); }
  if (!response.ok) { const error = new Error(data.error ?? 'The flow request failed.'); error.status = response.status; error.code = data.code; throw error; }
  return data;
}

export const flowApi = {
  list: () => request('/api/flows'),
  get: (id) => request(`/api/flows/${encodeURIComponent(id)}`),
  create: (flow) => request('/api/flows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flow) }),
  update: (id, flow) => request(`/api/flows/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flow) }),
  validate: (id, flow) => request(`/api/flows/${encodeURIComponent(id)}/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flow) }),
  remove: (id) => request(`/api/flows/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
