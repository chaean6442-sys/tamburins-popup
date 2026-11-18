import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../dist/server/index.js';
const key = 'test-operator-key';
const request = (authorized = true) => new Request('https://test.local/api/operator/balance', { headers: authorized ? { 'X-Muse-Operator-Key': key } : {} });
test('operator balance rejects unauthenticated requests without contacting Tripo', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
  assert.equal((await worker.fetch(request(false), {}, {})).status, 401);
});
test('operator balance returns available and frozen credits with no-store', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, data: { balance: 12, frozen: 30 } }));
  const response = await worker.fetch(request(), { TRIPO_API_KEY: 'test', OPERATOR_MONITOR_KEY: key }, {});
  const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.balance, 12); assert.equal(data.frozen, 30); assert.equal(data.required, 30);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
});
test('operator balance treats malformed wallet and authentication failures as unavailable, never zero', async t => {
  for (const response of [Response.json({ code: 0, data: {} }), Response.json({}, { status: 401 })]) {
    t.mock.method(globalThis, 'fetch', async () => response);
    const result = await worker.fetch(request(), { TRIPO_API_KEY: 'test', OPERATOR_MONITOR_KEY: key }, {});
    assert.equal(result.status, 503); assert.equal('balance' in await result.json(), false);
    t.mock.restoreAll();
  }
});
