import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../dist/server/index.js';

const auraId = '0123456789abcdef0123456789abcdef';
const modelId = 'fedcba9876543210fedcba9876543210';

test('deletes the archive record and every stored asset for its model', async () => {
  const deletedKeys = [];
  const queries = [];
  const env = {
    AR_OBJECTS: { delete: async key => deletedKeys.push(key) },
    DB: {
      prepare(query) {
        queries.push(query);
        return {
          bind() { return this; },
          first: async () => ({
            imageKey: `gallery/${auraId}.png`,
            arUrl: `https://test.local/ar?model=${modelId}`,
          }),
          run: async () => ({ success: true }),
        };
      },
    },
  };

  const response = await worker.fetch(new Request(`https://test.local/api/auras/${auraId}`, { method: 'DELETE' }), env, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  assert.deepEqual(deletedKeys.sort(), [
    `ar/${modelId}.glb`,
    `ar/${modelId}.json`,
    `ar/${modelId}.png`,
    `gallery/${auraId}.png`,
  ].sort());
  assert.ok(queries.some(query => query.startsWith('DELETE FROM auras')));
});

test('returns 404 without deleting storage when the archive record is missing', async () => {
  let storageDeletes = 0;
  const env = {
    AR_OBJECTS: { delete: async () => { storageDeletes += 1; } },
    DB: {
      prepare() {
        return { bind() { return this; }, first: async () => null };
      },
    },
  };

  const response = await worker.fetch(new Request(`https://test.local/api/auras/${auraId}`, { method: 'DELETE' }), env, {});
  assert.equal(response.status, 404);
  assert.equal(storageDeletes, 0);
});
