import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../dist/server/index.js';

function memoryBucket() {
  const values = new Map();
  return {
    values,
    async put(key, value) {
      if (typeof value === 'string') values.set(key, new TextEncoder().encode(value));
      else if (value instanceof ArrayBuffer) values.set(key, new Uint8Array(value));
      else if (value instanceof Uint8Array) values.set(key, value);
      else values.set(key, new Uint8Array(await new Response(value).arrayBuffer()));
    },
    async get(key) {
      const value = values.get(key);
      if (!value) return null;
      return { body: new Blob([value]).stream(), json: async () => JSON.parse(new TextDecoder().decode(value)) };
    },
    async head(key) { return values.has(key) ? { key } : null; },
    async delete(key) { values.delete(key); },
  };
}

test('generates each selected object with Tripo once and serves the cached GLB', async () => {
  const AR_OBJECTS = memoryBucket();
  const originalFetch = globalThis.fetch;
  let generationCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/v3/files')) return Response.json({ code: 0, data: { file_token: 'file_flower_reference' } });
    if (url.endsWith('/v3/generation/image-to-model')) {
      generationCalls += 1;
      const body = JSON.parse(init.body);
      assert.equal(body.input, 'file_flower_reference');
      assert.equal(body.pbr, true);
      assert.equal(body.texture_quality, 'extreme');
      assert.equal(body.texture_alignment, 'original_image');
      return Response.json({ code: 0, data: { task_id: 'task_flower_model' } });
    }
    if (url.endsWith('/v3/tasks/task_flower_model')) return Response.json({ code: 0, data: { status: 'success', output: { pbr_model: 'https://cdn.test/flower-pbr.glb', model_url: 'https://cdn.test/flower-flat.glb' } } });
    if (url === 'https://cdn.test/flower-pbr.glb') return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    if (url === 'https://cdn.test/flower-flat.glb') throw new Error('must prefer the PBR model');
    return originalFetch(input, init);
  };
  const env = {
    AR_OBJECTS,
    TRIPO_API_KEY: 'test-key',
    OPERATOR_MONITOR_KEY: 'test-operator-key',
    ASSETS: { fetch: async () => new Response(new Uint8Array([9, 8, 7]), { headers: { 'Content-Type': 'image/png' } }) },
  };
  try {
    const operatorHeaders = { 'X-Muse-Operator-Key': 'test-operator-key' };
    const unauthorized = await worker.fetch(new Request('https://test.local/api/object-models/flower', { method: 'POST' }), env, {});
    assert.equal(unauthorized.status, 401);
    const start = await worker.fetch(new Request('https://test.local/api/object-models/flower', { method: 'POST', headers: operatorHeaders }), env, {});
    assert.equal(start.status, 202);
    const poll = await worker.fetch(new Request('https://test.local/api/object-models/flower'), env, {});
    assert.deepEqual(await poll.json(), { status: 'ready', modelUrl: '/api/object-models/flower/model?v=photo-pbr-v2' });
    const model = await worker.fetch(new Request('https://test.local/api/object-models/flower/model'), env, {});
    assert.equal(model.headers.get('Content-Type'), 'model/gltf-binary');
    assert.deepEqual([...new Uint8Array(await model.arrayBuffer())], [1, 2, 3, 4]);
    const cached = await worker.fetch(new Request('https://test.local/api/object-models/flower', { method: 'POST', headers: operatorHeaders }), env, {});
    assert.equal((await cached.json()).status, 'ready');
    assert.equal(generationCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
