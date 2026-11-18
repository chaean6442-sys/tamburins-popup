import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../dist/server/index.js';

const viewNames = ['front', 'left', 'back', 'right'];
const views = Object.fromEntries(viewNames.map(name => [name, `data:image/png;base64,${Buffer.from(name).toString('base64')}`]));

async function request(t, suppliedViews, { rejectGeneration = false, forbidCurrentModel = false, balance = 100 } = {}) {
  const calls = [];
  const saved = new Map();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/account/balance')) {
      return Response.json({ code: 0, data: { balance, frozen: 0 } });
    }
    if (url.endsWith('/files')) {
      const file = options.body.get('file');
      return Response.json({ code: 0, data: { file_token: `token-${await file.text()}` } });
    }
    const generationPayload = JSON.parse(options.body);
    if (forbidCurrentModel && generationPayload.model === 'v3.1-20260211') {
      return Response.json({ code: 1003, message: 'model access denied' }, { status: 403 });
    }
    return rejectGeneration
      ? Response.json({ code: 1004 }, { status: 400 })
      : Response.json({ code: 0, data: { task_id: 'test-task-id' } });
  });
  const response = await worker.fetch(new Request('https://test.local/api/tripo-model', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ views: suppliedViews }),
  }), { TRIPO_API_KEY: 'test-only', AR_OBJECTS: { put: async (key, value) => saved.set(key, value) } }, {});
  return { response, calls, saved };
}

test('sends all four uploaded views in the Tripo v3 multiview input shape', async t => {
  const { response, calls, saved } = await request(t, views);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 6);
  assert.ok(calls[5].url.endsWith('/multiview-to-model'));
  const payload = JSON.parse(calls[5].options.body);
  assert.deepEqual(payload.inputs,
    viewNames.map(name => ({ [name]: `token-${name}` })));
  assert.equal('input' in payload, false);
  assert.equal(payload.model, 'v3.1-20260211');
  assert.equal(payload.texture_alignment, 'original_image');
  assert.equal(payload.texture_version, 'v3.5-20260815');
  const metadata = JSON.parse(saved.get('tripo/test-task-id.json'));
  assert.equal(metadata.generationMode, 'multiview');
  assert.deepEqual(metadata.inputViews, viewNames);
});

test('rejects a missing back view before uploading or generating', async t => {
  const { back, ...incomplete } = views;
  const { response, calls } = await request(t, incomplete);
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test('a rejected multiview request never falls back to a single image', async t => {
  const { response, calls, saved } = await request(t, views, { rejectGeneration: true });
  assert.equal(response.status, 502);
  assert.equal(calls.filter(call => call.url.includes('/generation/')).length, 1);
  assert.equal(saved.size, 0);
});

test('retries with the compatible model when the current model is forbidden', async t => {
  const { response, calls, saved } = await request(t, views, { forbidCurrentModel: true });
  assert.equal(response.status, 200);
  const generationCalls = calls.filter(call => call.url.includes('/generation/'));
  assert.equal(generationCalls.length, 2);
  assert.equal(JSON.parse(generationCalls[0].options.body).model, 'v3.1-20260211');
  assert.equal(JSON.parse(generationCalls[1].options.body).model, 'v2.5-20250123');
  const metadata = JSON.parse(saved.get('tripo/test-task-id.json'));
  assert.equal(metadata.generationModel, 'v2.5-20250123');
});

test('checks API balance before uploading views or starting a paid task', async t => {
  const { response, calls, saved } = await request(t, views, { balance: 29 });
  assert.equal(response.status, 402);
  const payload = await response.json();
  assert.match(payload.error, /30.*크레딧/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/account/balance'));
  assert.equal(saved.size, 0);
});

test('does not retry another model when Tripo reports insufficient credit', async t => {
  const calls = [];
  const saved = new Map();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/account/balance')) return Response.json({ code: 0, data: { balance: 100, frozen: 0 } });
    if (url.endsWith('/files')) return Response.json({ code: 0, data: { file_token: 'token' } });
    return Response.json({ code: 1003, message: "You don't have enough credit to create this task" }, { status: 403 });
  });
  const response = await worker.fetch(new Request('https://test.local/api/tripo-model', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ views }),
  }), { TRIPO_API_KEY: 'test-only', AR_OBJECTS: { put: async (key, value) => saved.set(key, value) } }, {});
  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.match(payload.error, /30.*크레딧/);
  assert.equal(calls.filter(call => call.url.includes('/generation/')).length, 1);
  assert.equal(saved.size, 0);
});

test('stores a completed Tripo model as fixed bytes and returns its AR URL', async t => {
  const saved = new Map();
  const taskId = 'completed-task-id';
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes(`/tasks/${taskId}`)) {
      return Response.json({ code: 0, data: { status: 'success', progress: 100, output: { model_url: 'https://cdn.test/model.glb' } } });
    }
    if (url === 'https://cdn.test/model.glb') return new Response(new Uint8Array([1, 2, 3, 4]));
    throw new Error(`Unexpected URL ${url}`);
  });
  const metadata = { collection: 'GUEST', effects: ['flower'], strength: 0.5 };
  const env = {
    TRIPO_API_KEY: 'test-only',
    AR_OBJECTS: {
      get: async key => key === `tripo/${taskId}.json`
        ? { json: async () => metadata }
        : key === `tripo/${taskId}.png`
          ? { body: new Uint8Array([9, 8, 7]) }
          : null,
      put: async (key, value) => saved.set(key, value),
    },
  };
  const response = await worker.fetch(new Request(`https://test.local/api/tripo-task/${taskId}`), env, {});
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.status, 'success');
  assert.match(payload.arUrl, /\?model=[a-f0-9]{32}$/);
  const modelKey = [...saved.keys()].find(key => key.endsWith('.glb'));
  assert.ok(modelKey);
  assert.ok(saved.get(modelKey) instanceof Uint8Array);
  assert.deepEqual([...saved.get(modelKey)], [1, 2, 3, 4]);
});

test('retries storage for the same completed task instead of returning a terminal error', async t => {
  const taskId = 'retry-storage-task';
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes(`/tasks/${taskId}`)) {
      return Response.json({ code: 0, data: { status: 'success', progress: 100, output: { model_url: 'https://cdn.test/missing.glb' } } });
    }
    return new Response('temporary failure', { status: 503 });
  });
  const response = await worker.fetch(new Request(`https://test.local/api/tripo-task/${taskId}`), {
    TRIPO_API_KEY: 'test-only',
    AR_OBJECTS: {
      get: async key => key === `tripo/${taskId}.json` ? { json: async () => ({ collection: 'GUEST' }) } : null,
      put: async () => { throw new Error('must not store an incomplete download'); },
    },
  }, {});
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.status, 'running');
  assert.equal(payload.progress, 99);
  assert.equal(payload.retryable, true);
});
