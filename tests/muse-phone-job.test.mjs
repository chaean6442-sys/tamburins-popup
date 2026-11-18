import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import worker from '../dist/server/index.js';

function memoryBucket() {
  const values = new Map();
  return {
    values,
    async put(key, value) {
      if (typeof value === 'string') values.set(key, new TextEncoder().encode(value));
      else if (value instanceof Uint8Array) values.set(key, value);
      else values.set(key, new Uint8Array(await new Response(value).arrayBuffer()));
    },
    async get(key) {
      const value = values.get(key);
      if (!value) return null;
      return {
        body: new Blob([value]).stream(),
        json: async () => JSON.parse(new TextDecoder().decode(value)),
        arrayBuffer: async () => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
      };
    },
    async delete(key) { values.delete(key); },
    async list({ prefix = '' } = {}) {
      return {
        objects: [...values.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
        truncated: false,
      };
    },
  };
}

test('creates a resumable phone job and removes private sculpt data after completion', async () => {
  const AR_OBJECTS = memoryBucket();
  const silhouette = `data:image/png;base64,${Buffer.from('sculpt').toString('base64')}`;
  const create = await worker.fetch(new Request('https://test.local/api/muse-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      silhouette,
      name: 'MUSE USER',
      collection: 'SUNSHINE',
      objects: ['water', 'flower'],
      placements: [{ id: 'flower', normal: [0.2, 0.7, 0.6] }],
      effects: ['water', 'flower'],
      strength: 0.75,
    }),
  }), { AR_OBJECTS }, {});
  assert.equal(create.status, 200);
  const created = await create.json();
  assert.match(created.id, /^[a-f0-9]{32}$/);
  assert.equal(created.url, `https://test.local/?job=${created.id}`);

  const read = await worker.fetch(new Request(`https://test.local/api/muse-jobs/${created.id}`), { AR_OBJECTS }, {});
  const { job } = await read.json();
  assert.equal(job.status, 'waiting');
  assert.deepEqual(job.objects, ['water', 'flower']);
  assert.deepEqual(job.placements, [{ id: 'flower', normal: [0.2, 0.7, 0.6] }]);

  const claim = await worker.fetch(new Request(`https://test.local/api/muse-jobs/${created.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'image', imageTaskId: 'resp_test_task_1234' }),
  }), { AR_OBJECTS }, {});
  assert.equal(claim.status, 200);
  assert.equal((await claim.json()).job.imageTaskId, 'resp_test_task_1234');

  const resumedImage = await worker.fetch(new Request('https://test.local/api/generate-world', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: created.id }),
  }), { AR_OBJECTS }, {});
  assert.equal(resumedImage.status, 202);
  assert.equal((await resumedImage.json()).taskId, 'resp_test_task_1234');

  const clearFailedImage = await worker.fetch(new Request(`https://test.local/api/muse-jobs/${created.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'error', imageTaskId: null, error: 'image task failed' }),
  }), { AR_OBJECTS }, {});
  assert.equal(clearFailedImage.status, 200);
  assert.equal((await clearFailedImage.json()).job.imageTaskId, undefined);

  const publicFailedRead = await worker.fetch(new Request(`https://test.local/api/muse-jobs/${created.id}`), { AR_OBJECTS }, {});
  assert.equal((await publicFailedRead.json()).job.error, undefined);

  const unauthorizedOperatorRead = await worker.fetch(new Request('https://test.local/api/operator/muse-jobs'), { AR_OBJECTS }, {});
  assert.equal(unauthorizedOperatorRead.status, 401);

  const operatorRead = await worker.fetch(new Request('https://test.local/api/operator/muse-jobs', {
    headers: { 'X-Muse-Operator-Key': 'test-operator-key' },
  }), { AR_OBJECTS, OPERATOR_MONITOR_KEY: 'test-operator-key' }, {});
  assert.equal(operatorRead.status, 200);
  const operatorPayload = await operatorRead.json();
  assert.equal(operatorPayload.jobs[0].error, 'image task failed');

  const complete = await worker.fetch(new Request(`https://test.local/api/muse-jobs/${created.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'complete', arUrl: 'https://test.local/?model=0123456789abcdef0123456789abcdef' }),
  }), { AR_OBJECTS }, {});
  assert.equal(complete.status, 200);
  assert.equal(AR_OBJECTS.values.has(`jobs/${created.id}.png`), false);
  assert.equal(AR_OBJECTS.values.has(`jobs/${created.id}.json`), true);
});

test('a completed phone MUSE is archived once even if its save request is retried', async () => {
  const AR_OBJECTS = memoryBucket();
  const rows = new Map();
  const DB = {
    prepare(query) {
      return {
        bind(...values) {
          return {
            async first() { return rows.has(values[0]) ? { id: values[0] } : null; },
            async run() {
              if (query.includes('INSERT')) rows.set(values[0], { id: values[0], imageKey: values[2] });
              return { success: true };
            },
          };
        },
      };
    },
  };
  const env = { AR_OBJECTS, DB };
  const created = await worker.fetch(new Request('https://test.local/api/muse-jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ silhouette: `data:image/png;base64,${Buffer.from('sculpt').toString('base64')}` }),
  }), env, {});
  const { id } = await created.json();
  const payload = { jobId: id, image: `data:image/png;base64,${Buffer.from('finished image').toString('base64')}`, arUrl: `https://test.local/?model=${id}` };
  for (let attempt = 0; attempt < 2; attempt++) {
    const saved = await worker.fetch(new Request('https://test.local/api/auras', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }), env, {});
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).id, id);
  }
  assert.equal(rows.size, 1);
  assert.equal(AR_OBJECTS.values.has(`gallery/${id}.png`), true);
});

test('the phone archive uses the saved Tripo preview without posting a large base64 image again', async () => {
  const AR_OBJECTS = memoryBucket();
  const rows = new Map();
  const DB = {
    prepare(query) {
      return {
        bind(...values) {
          return {
            async first() { return rows.has(values[0]) ? { id: values[0] } : null; },
            async run() {
              if (query.includes('INSERT')) rows.set(values[0], { id: values[0], imageKey: values[2] });
              return { success: true };
            },
          };
        },
      };
    },
  };
  const env = { AR_OBJECTS, DB };
  const created = await worker.fetch(new Request('https://test.local/api/muse-jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ silhouette: `data:image/png;base64,${Buffer.from('sculpt').toString('base64')}` }),
  }), env, {});
  const { id } = await created.json();
  const tripoTaskId = 'tripo_test_task_1234';
  await worker.fetch(new Request(`https://test.local/api/muse-jobs/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'model', tripoTaskId }),
  }), env, {});
  const previewBytes = new TextEncoder().encode('finished preview');
  await AR_OBJECTS.put(`tripo/${tripoTaskId}.png`, previewBytes);
  const preview = await worker.fetch(new Request(`https://test.local/api/tripo-preview/${tripoTaskId}`), env, {});
  assert.equal(preview.status, 200);
  assert.equal(await preview.text(), 'finished preview');

  const saved = await worker.fetch(new Request('https://test.local/api/auras', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: id, tripoTaskId, arUrl: `https://test.local/?model=${id}` }),
  }), env, {});
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).id, id);
  assert.deepEqual(AR_OBJECTS.values.get(`gallery/${id}.png`), previewBytes);
});

test('phone job routes avoid the installation 3D bundle and resume paid image tasks', async () => {
  const page = await readFile('app/page.tsx', 'utf8');
  const phone = await readFile('app/phone/MobileMuseJob.tsx', 'utf8');
  const experience = await readFile('app/world/OpenGalleryExperience.tsx', 'utf8');
  assert.match(page, /return <MobileMuseJob jobId=\{job\} \/>/);
  assert.match(experience, /useObjectModelUrls\(phoneRoute \? \[\] :/);
  assert.match(phone, /let imageTaskId = job\.imageTaskId \?\? ""/);
  assert.doesNotMatch(phone, /job\.status === "error" \? "" : job\.imageTaskId/);
  assert.match(phone, /body: JSON\.stringify\(\{ jobId \}\)/);
  assert.doesNotMatch(phone, /blobAsDataUrl/);
});

test('the QR handoff reset returns the installation to the first intro', async () => {
  const source = await readFile('app/world/OpenGalleryExperience.tsx', 'utf8');
  assert.match(source, /setWaterIntroCleared\(false\)/);
  assert.match(source, /setIntroCleared\(false\)/);
  assert.match(source, />처음으로<\/button>/);
  assert.doesNotMatch(source, />다음 사람 시작<\/button>/);
});

test('operator errors are isolated from the kiosk and phone screens', async () => {
  const experience = await readFile('app/world/OpenGalleryExperience.tsx', 'utf8');
  const operator = await readFile('app/operator/page.tsx', 'utf8');
  assert.doesNotMatch(experience, /operator-alert|operatorJobMonitors|operatorAlerts/);
  assert.match(operator, /MUSE 운영 상태/);
  assert.match(operator, /X-Muse-Operator-Key/);
  assert.match(operator, /새 오류/);
});

test('phone AR assigns twist box interaction to selfie and palm growth to rear camera', async () => {
  const source = await readFile('app/world/OpenGalleryExperience.tsx', 'utf8');
  const phone = await readFile('app/phone/MobileMuseJob.tsx', 'utf8');
  assert.match(source, /activeCameraFacing === "user"/);
  assert.match(source, /facingMode: \{ ideal: requestedFacing \}/);
  assert.match(source, /desktop=\{boxedMode\}/);
  assert.match(source, /손목을 돌려 오브젝트를 꼬아보세요/);
  assert.match(source, /손을 펼수록 MUSE가 피어납니다/);
  assert.match(source, /navigator\.mediaDevices\.enumerateDevices/);
  assert.match(source, /first permission request/);
  assert.match(source, /detectedFacing !== requestedFacing/);
  assert.match(source, /void startCamera\(next\)/);
  assert.match(source, /getCapabilities/);
  assert.match(source, /visible=\{Boolean\(backgroundImage\) \|\| handDetected\}/);
  assert.match(source, /backgroundImage \? "intro-reveal"/);
  assert.doesNotMatch(source, /visible=\{boxedMode \|\| handDetected\}/);
  const styles = await readFile('app/globals.css', 'utf8');
  assert.match(styles, /\.ar-object-wrap\.intro-reveal\.no-hand \{ opacity: 1; \}/);
  assert.doesNotMatch(styles, /\.ar-object-wrap\.desktop-reveal\.no-hand \{ opacity: 1; \}/);
  assert.match(phone, />카메라로 3D 보기<\/button>/);
  assert.match(source, /effectObjectIds\.map\(\(id\) => \[id, `\/models\/mobile\/\$\{id\}\.glb`\]\)/);
  assert.match(source, /objectModels=\{objectModels\}/);
  assert.match(source, /boxInteraction \? 260 : 1400/);
  assert.match(source, /boxInteraction \? \.7 : \.42/);
  assert.match(source, /const active = bases\.map/);
  assert.doesNotMatch(source, /bases\.length \? bases : effects/);
  const mobilePbr = await readFile('app/logic/mobilePbr.ts', 'utf8');
  assert.match(mobilePbr, /maxSize = 1024/);
  assert.match(mobilePbr, /max-width: 900px/);
  assert.match(mobilePbr, /source\.clone\(\)/);
  assert.match(source, /optimizePbrForMobile\(gltf\.scene\.clone\(true\)\)/);
  assert.match(source, /effects\.length > 0 && !desktop/);
  assert.match(source, /const source = "\/mediapipe\/hands\/hands\.js"/);
  assert.match(source, /locateFile: \(file: string\) => `\/mediapipe\/hands\/\$\{file\}`/);
  assert.doesNotMatch(source, /cdn\.jsdelivr\.net\/npm\/@mediapipe\/hands/);
  assert.match(source, /maxNumHands: boxInteraction \? 2 : 1/);
  assert.match(source, /const inferenceInterval = boxInteraction \? 66 : 125/);
  assert.match(source, /modelComplexity: desktop && !backgroundImage \? 1 : 0/);
  assert.match(source, /const rearVideo = \{ width: \{ ideal: 640 \}, height: \{ ideal: 480 \}/);
  assert.match(source, /if \(!handDetected \|\| rearObjectCount >= selectedEffectIds\.length\) return/);
  assert.match(source, /selectedEffectIds\.slice\(0, rearObjectCount\)/);
  assert.match(source, /consecutiveFrameFailures >= 3/);
  assert.match(source, /trackingContext\.drawImage\(video, 0, 0, width, height\)/);
  assert.match(source, /className="ar-model-canvas" dpr=\{1\}/);
  assert.match(source, /scale=\{objectTransform\.scale \* \(boxedMode \? handPose\.scale : 1\)\}/);
  assert.match(source, /preserveSourceMaterial=\{completedMuseModel\}/);
  assert.match(source, /function mixClayBodyMaterial/);
  assert.match(source, /geometry\.setAttribute\("musePhysical"/);
  assert.match(source, /THREE\.MathUtils\.smoothstep\(field, -\.26, \.26\)/);
  assert.match(source, /material=\{clayMaterial\}/);
  assert.doesNotMatch(source, /roughness: average\("roughness"\)/);
  assert.doesNotMatch(source, /\[\.\.\.mixed\]\.reverse\(\)\.find\(\(id\) => BODY_MATERIAL_IDS\.has\(id\)\)/);
});

test('surface composition uses prepared 3D assets without flat image attachments', async () => {
  const source = await readFile('app/world/OpenGalleryExperience.tsx', 'utf8');
  const evolution = await readFile('app/world/ArEvolution.tsx', 'utf8');
  assert.doesNotMatch(source, /function SurfaceObjectImage/);
  assert.doesNotMatch(source, /function GrowthCluster/);
  assert.doesNotMatch(source, /fetch\(`\/api\/object-models\/\$\{id\}`,[\s\S]{0,100}method: "POST"/);
  assert.match(source, /if \(!modelUrl\) return null/);
  assert.match(source, /<Suspense fallback=\{null\}>/);
  assert.match(source, /impacts\.filter\(\(impact\) => !BODY_MATERIAL_IDS\.has\(impact\.id\)\)/);
  assert.match(source, /const bodyMaterials = useMemo/);
  assert.doesNotMatch(evolution, /key=\{`flower-/);
  assert.doesNotMatch(evolution, /key=\{`mushroom-/);
  assert.doesNotMatch(evolution, /key=\{`organic-/);
  assert.doesNotMatch(evolution, /key=\{`flow-/);
  assert.match(evolution, /Math\.max\(\.16, openness\.current\)/);
  assert.doesNotMatch(evolution, /pbr\.opacity = 1|pbr\.transmission = 0/);
  assert.doesNotMatch(evolution, /torusGeometry|kind: "spark"|kind: "drop"/);
  assert.match(source, /MobileArEnvironment/);
  assert.match(source, /size: 64/);
  assert.match(evolution, /optimizePbrForMobile\(gltf\.scene\.clone\(true\), 512\)/);
  assert.match(evolution, /tripoEffects\.map/);
  assert.doesNotMatch(evolution, /anchors\.slice\(effectIndex \* 3/);
  assert.doesNotMatch(evolution, /visibleTripoEffects = tripoEffects\.slice/);
  assert.match(evolution, /planBloomInstances\(/);
  assert.match(evolution, /placements\.map\(/);
  assert.doesNotMatch(evolution, /ray\.intersectObject\(model/);
  assert.doesNotMatch(evolution, /root\.current\?\.traverse/);
  assert.match(evolution, /<group rotation=\{\[0, placement\.index \* 1\.73, 0\]\} scale=\{radius\}>/);
  assert.doesNotMatch(evolution, /<primitive object=\{copies\[i\]\} scale=\{radius\}/);
});

test('objects require a real throw before they are absorbed', async () => {
  const source = await readFile('app/world/OpenGalleryExperience.tsx', 'utf8');
  assert.match(source, /handThrow\.current\.distance >= 0\.09/);
  assert.match(source, /pointerDrag\.current\.distance >= 36 && pointerSpeed >= 0\.08/);
  assert.match(source, /if \(!clayAim \|\| !wasThrown\)/);
  assert.match(source, /if \(current && worldHit && wasThrown\)/);
  assert.doesNotMatch(source, /const grab = \(id: ObjectId\) => \{\s*setMixed/);
});

