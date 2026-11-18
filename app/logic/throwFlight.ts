import * as THREE from "three";

export function localThrowTarget(parent: THREE.Object3D | null, worldTarget: THREE.Vector3) {
  return parent ? parent.worldToLocal(worldTarget.clone()) : worldTarget.clone();
}

export function throwFlightPoint(from: THREE.Vector3, to: THREE.Vector3, progress: number, out: THREE.Vector3) {
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  const eased = 1 - (1 - t) * (1 - t);
  out.lerpVectors(from, to, eased);
  out.y += Math.sin(Math.PI * t) * .12;
  return out;
}
