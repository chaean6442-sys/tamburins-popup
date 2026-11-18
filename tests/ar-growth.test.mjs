import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { growthMount } from '../app/logic/arGrowth.ts';

const bounds = new THREE.Box3(new THREE.Vector3(-1, -2, -3), new THREE.Vector3(1, 2, 3));

test('flowers attach from their rear calyx and face away from the Muse surface', () => {
  for (const id of ['flower', 'rose']) {
    const mount = growthMount(id, bounds);
    assert.deepEqual(mount.origin.toArray(), [-1, 0, 0]);
    assert.ok(new THREE.Vector3(1, 0, 0).applyQuaternion(mount.alignment).distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-6);
    assert.equal(mount.unfurl, true);
  }
});

test('lily and leaf roots stay at their stems while growth points outward', () => {
  const lily = growthMount('lily', bounds);
  const leaf = growthMount('leaf', bounds);
  assert.deepEqual(lily.origin.toArray(), [0, -2, -3]);
  assert.deepEqual(leaf.origin.toArray(), [0, -2, 3]);
  for (const mount of [lily, leaf]) {
    assert.equal(mount.rooted, true);
    assert.equal(mount.unfurl, true);
  }
});

test('other effects keep their original centered placement', () => {
  const mount = growthMount('ribbon', bounds);
  assert.deepEqual(mount.origin.toArray(), [0, 0, 0]);
  assert.equal(mount.rooted, false);
});
