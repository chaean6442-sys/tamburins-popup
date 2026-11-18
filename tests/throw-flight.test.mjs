import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { localThrowTarget, throwFlightPoint } from "../app/logic/throwFlight.ts";

test("a rotated table converts the clay hit into the object's local space", () => {
  const table = new THREE.Group();
  table.position.set(0, .34, 0);
  table.rotation.y = 1.2;
  table.updateMatrixWorld(true);
  const expected = new THREE.Vector3(.15, .87, .61);
  const worldHit = table.localToWorld(expected.clone());
  assert.ok(localThrowTarget(table, worldHit).distanceTo(expected) < 1e-6);
});

test("a valid throw reaches the clay without bouncing away", () => {
  const from = new THREE.Vector3(1.2, .18, .55);
  const to = new THREE.Vector3(.18, .87, .6);
  const out = new THREE.Vector3();
  throwFlightPoint(from, to, .5, out);
  assert.ok(out.y > (from.y + to.y) / 2);
  assert.ok(throwFlightPoint(from, to, 1, out).distanceTo(to) < 1e-6);
});
