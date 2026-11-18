import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('starts image generation as a pollable background response', async () => {
  const source = await readFile(new URL('../app/api/generate-world/route.ts', import.meta.url), 'utf8');
  assert.match(source, /fetch\("https:\/\/api\.openai\.com\/v1\/responses"/);
  assert.match(source, /background:\s*true/);
  assert.match(source, /store:\s*false/);
  assert.match(source, /type:\s*"image_generation"/);
  assert.match(source, /model:\s*"gpt-image-2"/);
  assert.match(source, /action:\s*"edit"/);
  assert.match(source, /status:\s*202/);
});

test('polls the same image task and prevents HTML error pages from leaking into the UI', async () => {
  const route = await readFile(new URL('../app/api/generate-world/route.ts', import.meta.url), 'utf8');
  const client = await readFile(new URL('../app/world/OpenGalleryExperience.tsx', import.meta.url), 'utf8');
  assert.match(route, /export async function GET\(request: Request\)/);
  assert.match(route, /v1\/responses\/\$\{encodeURIComponent\(taskId\)\}/);
  assert.match(route, /result\.status === "queued" \|\| result\.status === "in_progress"/);
  assert.match(client, /const raw = await response\.text\(\)/);
  assert.match(client, /JSON\.parse\(raw\)/);
  assert.match(client, /imageTaskIdRef\.current = data\.taskId/);
  assert.match(client, /pollImageTask\(data\.taskId\)/);
});

test('terminal image failures stay private to the operator and discard the failed phone task', async () => {
  const route = await readFile(new URL('../app/api/generate-world/route.ts', import.meta.url), 'utf8');
  const phone = await readFile(new URL('../app/phone/MobileMuseJob.tsx', import.meta.url), 'utf8');
  const operator = await readFile(new URL('../app/operator/page.tsx', import.meta.url), 'utf8');
  assert.match(route, /credit_balance_exhausted/);
  assert.match(route, /code: result\.error\?\.code/);
  assert.match(phone, /updateJob\(\{ imageTaskId: null \}\)/);
  assert.match(phone, /visitorSafeJobError/);
  assert.match(phone, /현장 스태프에게 문의해주세요/);
  assert.doesNotMatch(phone, /이미지 생성 API 충전하기/);
  assert.doesNotMatch(phone, /운영자 알림|setOperatorJobMonitors/);
  assert.match(operator, /새 오류/);
  assert.match(operator, /X-Muse-Operator-Key/);
});

test('locks generation to the current object cutouts and the sculpted four-view geometry', async () => {
  const route = await readFile(new URL('../app/api/generate-world/route.ts', import.meta.url), 'utf8');
  const client = await readFile(new URL('../app/world/OpenGalleryExperience.tsx', import.meta.url), 'utf8');
  assert.match(route, /OBJECT_REFERENCE_VERSION/);
  assert.match(route, /cache:\s*"no-store"/);
  assert.match(route, /non-negotiable geometry blueprint/);
  assert.match(route, /Do not beautify, normalize, round, inflate, symmetrize, straighten or redesign/);
  assert.match(route, /sole visual source of truth for the selected objects/);
  assert.match(route, /selectedObjects\.map\(\(id\) => fetchPublicAsset/);
  assert.doesNotMatch(route, /MUSE_REFERENCE_FILES|museReferenceAssets/);
  assert.match(route, /quality:\s*"high"/);
  assert.match(route, /EXACT OBJECT COUNT AUDIT/);
  assert.match(client, /context\.fillStyle = "#ffffff"/);
  assert.match(client, /142 \+ light \* 76/);
  assert.match(client, /const size = 1536/);
  assert.match(route, /OBJECT_SIGNATURES/);
  assert.match(route, /SIGNATURE ACTIONS FOR THIS EXACT SELECTION/);
  assert.doesNotMatch(route, /Build a strongly asymmetrical silhouette/);
});
