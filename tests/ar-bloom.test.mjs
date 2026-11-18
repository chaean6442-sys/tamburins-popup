import test from 'node:test';
import assert from 'node:assert/strict';
import { planBloomInstances } from '../app/logic/arBloom.ts';

test('palm bloom adds copies of only the selected 3D objects within a mobile budget', () => {
  const plan = planBloomInstances(['flower', 'leaf', 'crystal'], 11);
  assert.equal(plan.length, 7);
  assert.deepEqual([...new Set(plan.map((item) => item.id))], ['flower', 'leaf', 'crystal']);
  assert.equal(new Set(plan.map((item) => item.anchorIndex)).size, 7);
  assert.ok(plan.every((item) => item.anchorIndex >= 0 && item.anchorIndex < 11));
  const visibleAt = (progress) => plan.filter((item) => progress > item.revealAt + .17).length;
  assert.ok(visibleAt(.2) < visibleAt(.44));
  assert.ok(visibleAt(.44) < visibleAt(.72));
  assert.equal(visibleAt(1), plan.length);
});

test('no unselected or missing object is invented for the bloom', () => {
  assert.deepEqual(planBloomInstances([], 12), []);
  assert.deepEqual(planBloomInstances(['flower'], 0), []);
  assert.ok(planBloomInstances(['flower'], 12).every((item) => item.id === 'flower'));
});
