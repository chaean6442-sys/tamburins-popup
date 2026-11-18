import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { enhancePreparedObjectMaterials } from "../app/logic/objectPbr.ts";

test("transparent finishes stay on their selected object and preserve its color map", () => {
  const colorMap = new THREE.Texture();
  const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  const crystal = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: colorMap }));
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: colorMap }));
  const scene = new THREE.Group();
  scene.add(body, crystal, ribbon);

  enhancePreparedObjectMaterials(crystal, "crystal");
  enhancePreparedObjectMaterials(ribbon, "ribbon");

  assert.equal(crystal.material.map, colorMap);
  assert.ok(crystal.material.transmission > .5);
  assert.equal(ribbon.material.map, colorMap);
  assert.equal(ribbon.material.transmission, 0);
  assert.equal(body.material.type, "MeshStandardMaterial");
});
