import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../dist/server/index.js';

const archiveUrl = 'https://test.local/api/operator/archive-access';
const auraUrl = 'https://test.local/api/auras/0123456789abcdef0123456789abcdef';

function makeEnv() {
  const attempts = new Map();
  return {
    ARCHIVE_ACCESS_KEY: 'test-archive-key',
    OPERATOR_MONITOR_KEY: 'test-operator-key',
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes('archive_access_attempts')) return attempts.get(args[0]) ?? null;
                return null;
              },
              async run() {
                if (sql.startsWith('INSERT INTO archive_access_attempts')) attempts.set(args[0], { attempts: 1, windowStart: args[1] });
                if (sql.startsWith('UPDATE archive_access_attempts')) attempts.get(args[0]).attempts += 1;
                if (sql.startsWith('DELETE FROM archive_access_attempts')) attempts.delete(args[0]);
              },
            };
          },
          async run() {},
        };
      },
    },
    AR_OBJECTS: {
      delete() { throw new Error('unauthorized requests must not remove assets'); },
    },
  };
}

test('Ctrl+S archive uses its own key and limits repeated guesses', async () => {
  const env = makeEnv();
  const request = (key) => new Request(archiveUrl, { headers: key ? { 'X-Muse-Operator-Key': key } : {} });

  const missing = await worker.fetch(request(), env, {});
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get('Cache-Control'), 'private, no-store');

  const operatorKey = await worker.fetch(request('test-operator-key'), env, {});
  assert.equal(operatorKey.status, 401);

  const allowed = await worker.fetch(request('test-archive-key'), env, {});
  assert.equal(allowed.status, 204);

  for (let index = 0; index < 5; index += 1) {
    const result = await worker.fetch(request('wrong-key'), env, {});
    assert.equal(result.status, 401);
  }
  const limited = await worker.fetch(request('test-archive-key'), env, {});
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('Retry-After')) > 0);
});

test('archive deletion requires the archive key, not the operator monitor key', async () => {
  const env = makeEnv();
  const deletion = (key) => new Request(auraUrl, { method: 'DELETE', headers: key ? { 'X-Muse-Operator-Key': key } : {} });
  assert.equal((await worker.fetch(deletion(), env, {})).status, 401);
  assert.equal((await worker.fetch(deletion('test-operator-key'), env, {})).status, 401);
  assert.equal((await worker.fetch(deletion('test-archive-key'), env, {})).status, 404);
});
