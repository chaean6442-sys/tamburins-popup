import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createTableHitGeometry } from '../app/logic/tableHit.ts';

test('the table top and side can turn without turning the opening or background', () => {
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 20);
  camera.position.z = 10;
  camera.updateMatrixWorld();
  const surface = new THREE.Mesh(createTableHitGeometry(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  surface.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  const hits = (x, y) => {
    ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
    return ray.intersectObject(surface).length > 0;
  };

  for (const point of [[0.5, 0.445], [0.3, 0.56], [0.7, 0.56], [0.5, 0.7], [0.5, 0.82]]) {
    assert.ok(hits(...point), `table ${point}`);
  }
  for (const point of [[0.5, 0.25], [0.5, 0.52], [0.15, 0.65], [0.85, 0.65], [0.5, 0.93]]) {
    assert.equal(hits(...point), false, `outside table ${point}`);
  }
});
