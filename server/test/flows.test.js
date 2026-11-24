import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createTestAuth } from './testAuth.js';

function memoryFlowModel() {
  const records = new Map();
  const document = (value) => ({ ...value, toObject() { const { toObject, ...plain } = this; return structuredClone(plain); } });
  return {
    records,
    async create(value) { const now = new Date(); const saved = document({ ...structuredClone(value), createdAt: now, updatedAt: now }); records.set(saved.flowId, saved); return saved; },
    find() { const query = { sort: async () => [...records.values()] }; return query; },
    async findOne({ flowId, revision }) { const found = records.get(flowId); return found && (revision === undefined || found.revision === revision) ? found : null; },
    async findOneAndUpdate(filter, update) { const found = records.get(filter.flowId); if (!found || found.revision !== filter.revision) return null; Object.assign(found, structuredClone(update.$set)); found.revision += update.$inc.revision; found.updatedAt = new Date(); return found; },
    async findOneAndDelete({ flowId }) { const found = records.get(flowId); records.delete(flowId); return found ?? null; },
  };
}
function graph() {
  const nodes = [
    { id: 'entry', position: { x: 0, y: 0 }, data: { kind: 'entry', label: 'Entry' } },
    { id: 'router', position: { x: 200, y: 0 }, data: { kind: 'router', label: 'Router' } },
    ...['before', 'during', 'after'].map((phase, index) => ({ id: phase, position: { x: 500, y: index * 100 }, data: { kind: 'destination', phase, label: phase, destinationUrl: `https://example.com/${phase}`, schedule: {} } })),
    { id: 'fallback', position: { x: 500, y: 400 }, data: { kind: 'fallback', label: 'Fallback', destinationUrl: 'https://example.com/fallback' } },
  ];
  return { nodes, edges: [{ id: 'entry-router', source: 'entry', target: 'router' }, ...nodes.slice(2).map((node) => ({ id: `router-${node.id}`, source: 'router', target: node.id }))] };
}
const payload = () => ({ eventName: 'Launch', description: 'Main event', creatorTimeZone: 'Asia/Kolkata', eventStartLocal: '2026-12-01T09:00', eventEndLocal: '2026-12-01T17:00', graph: graph() });

let server; let baseUrl; let adminFetch; let model;
before(async () => {
  model = memoryFlowModel(); const auth = createTestAuth();
  server = createApp({ flowModel: model, ...auth }).listen(0); await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`; adminFetch = auth.fetch(baseUrl, await auth.login(baseUrl));
});
after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

test('flow APIs enforce authentication', async () => {
  const response = await fetch(`${baseUrl}/api/flows`);
  assert.equal(response.status, 401);
});

test('creates, lists and retrieves a creator-timezone flow', async () => {
  const created = await adminFetch(`${baseUrl}/api/flows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload()) });
  const body = await created.json();
  assert.equal(created.status, 201); assert.match(body.flow.id, /^[0-9a-f-]{36}$/); assert.equal(body.flow.creatorTimeZone, 'Asia/Kolkata'); assert.equal(body.flow.revision, 1); assert.equal(body.validation.publishable, true);
  const list = await adminFetch(`${baseUrl}/api/flows`); assert.ok((await list.json()).flows.some((flow) => flow.id === body.flow.id));
  const detail = await adminFetch(`${baseUrl}/api/flows/${body.flow.id}`); assert.equal((await detail.json()).flow.eventName, 'Launch');
  model.createdId = body.flow.id;
});

test('edits with optimistic concurrency and rejects stale revisions', async () => {
  const id = model.createdId; const changedPayload = { ...payload(), revision: 1, eventName: 'Updated launch' };
  const changed = await adminFetch(`${baseUrl}/api/flows/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(changedPayload) });
  assert.equal(changed.status, 200); assert.equal((await changed.json()).flow.revision, 2);
  const stale = await adminFetch(`${baseUrl}/api/flows/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(changedPayload) });
  assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'REVISION_CONFLICT');
});

test('validates drafts without persistence and rejects invalid destinations', async () => {
  const id = model.createdId; const incomplete = payload(); incomplete.graph.nodes.find((node) => node.id === 'fallback').data.destinationUrl = '';
  const validation = await adminFetch(`${baseUrl}/api/flows/${id}/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(incomplete) });
  assert.equal(validation.status, 200); assert.equal((await validation.json()).validation.publishable, false);
  const invalid = payload(); invalid.graph.nodes.find((node) => node.id === 'during').data.destinationUrl = 'ftp://example.com';
  const response = await adminFetch(`${baseUrl}/api/flows/${id}/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(invalid) });
  assert.equal(response.status, 400);
});

test('deletes an unlinked draft and protects linked or published flows', async () => {
  const id = model.createdId; model.records.get(id).linkId = 'linked';
  const protectedResponse = await adminFetch(`${baseUrl}/api/flows/${id}`, { method: 'DELETE' }); assert.equal(protectedResponse.status, 409);
  model.records.get(id).linkId = null;
  const removed = await adminFetch(`${baseUrl}/api/flows/${id}`, { method: 'DELETE' }); assert.equal(removed.status, 200);
  const missing = await adminFetch(`${baseUrl}/api/flows/${id}`); assert.equal(missing.status, 404);
});
