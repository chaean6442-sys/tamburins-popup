import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('intro, sculpting, and object throws expose pointer controls without a 3D table', async () => {
  const source = await readFile('app/world/OpenGalleryExperience.tsx', 'utf8');

  assert.match(source, /onClick=\{handleIntroClick\}/);
  assert.match(source, /if \(!backgroundImage\) return;[\s\S]*?onClose\(\);/);
  assert.match(source, /function Clay[\s\S]*?onPointerDown=[\s\S]*?applyClaySelection[\s\S]*?onPointerUp=/);
  assert.doesNotMatch(source, /<RhinoSpace|<RhinoFallback|<DonutTurntable/);
  assert.match(source, /function ThrowableObject[\s\S]*?intersectSphere[\s\S]*?flying\.current = true/);
});

test('the new artwork supplies the photo table, loading page, and name entry', async () => {
  const css = await readFile('app/globals.css', 'utf8');
  const source = await readFile('app/world/OpenGalleryExperience.tsx', 'utf8');
  assert.match(css, /main-background\.png\?v=20261022/);
  assert.match(css, /loading\.png\?v=20261022/);
  assert.match(source, /name-entry\.png\?v=20261022/);
  for (const asset of ['main-background.png', 'loading.png', 'name-entry.png']) {
    const bytes = await readFile(`public/design/ui/${asset}`);
    assert.ok(bytes.length > 20_000, asset);
  }
});

test('the supplied stage artwork and its button hit targets stay above WebGL shadows', async () => {
  const css = await readFile('app/globals.css', 'utf8');

  assert.match(css, /\.spatial-shell > canvas \{ z-index: 1; \}/);
  assert.match(css, /\.muse-stage-ui \{ z-index: 30; \}/);
  assert.match(css, /\.experience-actions \{\s*z-index: 40;/);
});

test('object previews distribute over the full deformed clay surface', async () => {
  const source = await readFile('app/world/OpenGalleryExperience.tsx', 'utf8');

  assert.match(source, /const anchor = new THREE\.Vector3\(\.\.\.hitNormal\)\.normalize\(\)/);
  assert.match(source, /sample \* Math\.PI \* \(3 - Math\.sqrt\(5\)\)/);
  assert.match(source, /const y = 1 - 2 \* \(\(sample \+ 0\.5\) \/ sampleCount\)/);
  assert.match(source, /geometry\.getAttribute\("normal"\)/);
  assert.match(source, /setFromUnitVectors/);
  assert.match(source, /quaternion=\{orientation\}/);
  assert.doesNotMatch(source, /const theta = sequence \* 2\.3999632297/);
});

test('intro stage frame persists while only the warmed MUSE model changes', async () => {
  const source = await readFile('app/world/OpenGalleryExperience.tsx', 'utf8');
  assert.doesNotMatch(source, /<Suspense key=\{renderedModelUrl\}/);
  assert.match(source, /<GlbWarmup url=\{nextWarmupUrl\}/);
});

test('sculpt guide demonstrates a grip and hand tracking rejects micro jitter', async () => {
  const source = await readFile('app/world/OpenGalleryExperience.tsx', 'utf8');
  const css = await readFile('app/globals.css', 'utf8');
  assert.match(source, /guide-hand-frame guide-hand-open/);
  assert.match(source, /guide-hand-frame guide-hand-pinched/);
  assert.match(css, /@keyframes guide-hand-pull-left/);
  assert.match(source, /movement - 0\.012/);
  assert.match(source, /Math\.hypot\(dx, dy\) < 0\.018/);
  assert.match(source, /const sculptStrength = 1\.28/);
});
