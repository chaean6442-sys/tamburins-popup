import * as THREE from "three";

type GrowthProfile = {
  origin: [number, number, number];
  direction: [number, number, number];
  unfurl: boolean;
};

// The prepared Tripo objects have different local axes. These coordinates
// identify the stem, calyx, or base in each original GLB, not its box center.
const PROFILES: Record<string, GrowthProfile> = {
  flower: { origin: [0, .5, .5], direction: [1, 0, 0], unfurl: true },
  rose: { origin: [0, .5, .5], direction: [1, 0, 0], unfurl: true },
  lily: { origin: [.5, 0, 0], direction: [0, .85, .52], unfurl: true },
  leaf: { origin: [.5, 0, 1], direction: [0, .85, -.52], unfurl: true },
  mushroom: { origin: [.5, 0, .5], direction: [0, 1, 0], unfurl: false },
  crystal: { origin: [.5, 0, .5], direction: [0, 1, 0], unfurl: false },
  branch: { origin: [.5, 0, .5], direction: [0, 1, 0], unfurl: false },
  fruit: { origin: [.5, 1, .5], direction: [0, -1, 0], unfurl: false },
};

export function growthMount(id: string, bounds: THREE.Box3) {
  const profile = PROFILES[id];
  if (!profile) return {
    origin: bounds.getCenter(new THREE.Vector3()),
    alignment: new THREE.Quaternion(),
    unfurl: false,
    rooted: false,
  };
  const size = bounds.getSize(new THREE.Vector3());
  const origin = bounds.min.clone().add(new THREE.Vector3(
    size.x * profile.origin[0], size.y * profile.origin[1], size.z * profile.origin[2],
  ));
  const direction = new THREE.Vector3(...profile.direction).normalize();
  return {
    origin,
    alignment: new THREE.Quaternion().setFromUnitVectors(direction, new THREE.Vector3(0, 1, 0)),
    unfurl: profile.unfurl,
    rooted: true,
  };
}
