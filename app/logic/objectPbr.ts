import * as THREE from "three";

type ObjectFinish = {
  roughness: number;
  metalness?: number;
  clearcoat?: number;
  sheen?: number;
  transmission?: number;
  opacity?: number;
  ior?: number;
  thickness?: number;
  tint?: [number, number, number];
};

// Tripo's prepared objects use one baked material. Restore the physical finish
// of each photographed object without changing the rest of the Muse model.
const OBJECT_FINISH: Record<string, ObjectFinish> = {
  branch: { roughness: .88, metalness: 0, tint: [1.10, 1.10, 1.10] },
  crystal: { roughness: .08, metalness: 0, clearcoat: .9, transmission: .68, ior: 1.52, thickness: .38 },
  fabric: { roughness: .45, metalness: 0, sheen: .8, transmission: .12, opacity: .87, ior: 1.38, thickness: .08 },
  feather: { roughness: .76, metalness: 0, sheen: .75 },
  flower: { roughness: .64, metalness: 0, sheen: .4, tint: [1.08, 1.04, 1.12] },
  fruit: { roughness: .32, metalness: 0, clearcoat: .42 },
  leaf: { roughness: .38, metalness: 0, clearcoat: .3, tint: [.98, .98, .96] },
  lily: { roughness: .56, metalness: 0, sheen: .35, tint: [.94, .94, .94] },
  mushroom: { roughness: .57, metalness: 0, clearcoat: .14, tint: [1.03, 1.06, 1.10] },
  ribbon: { roughness: .28, metalness: 0, sheen: .86, clearcoat: .22 },
  rose: { roughness: .67, metalness: 0, sheen: .48, tint: [1.05, 1.03, 1.04] },
};

export function enhancePreparedObjectMaterials(root: THREE.Object3D, id: string) {
  const finish = OBJECT_FINISH[id];
  if (!finish) return root;
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const convert = (source: THREE.Material) => {
      if (!(source instanceof THREE.MeshStandardMaterial)) return source;
      const material = new THREE.MeshPhysicalMaterial({
        name: source.name,
        color: source.color.clone(),
        map: source.map,
        lightMap: source.lightMap,
        lightMapIntensity: source.lightMapIntensity,
        normalMap: source.normalMap,
        bumpMap: source.bumpMap,
        bumpScale: source.bumpScale,
        displacementMap: source.displacementMap,
        displacementScale: source.displacementScale,
        displacementBias: source.displacementBias,
        roughnessMap: source.roughnessMap,
        metalnessMap: source.metalnessMap,
        aoMap: source.aoMap,
        aoMapIntensity: source.aoMapIntensity,
        alphaMap: source.alphaMap,
        emissive: source.emissive.clone(),
        emissiveMap: source.emissiveMap,
        emissiveIntensity: source.emissiveIntensity,
        side: id === "fabric" ? THREE.DoubleSide : source.side,
        alphaTest: source.alphaTest,
        vertexColors: source.vertexColors,
        roughness: finish.roughness,
        metalness: finish.metalness ?? source.metalness,
        clearcoat: finish.clearcoat ?? 0,
        sheen: finish.sheen ?? 0,
        transmission: finish.transmission ?? 0,
        opacity: finish.opacity ?? 1,
        ior: finish.ior ?? 1.5,
        thickness: finish.thickness ?? 0,
      });
      material.normalScale.copy(source.normalScale);
      material.envMapIntensity = source.envMapIntensity;
      if (finish.tint) material.color.multiply(new THREE.Color().setRGB(...finish.tint));
      // Only the mesh representing the transparent object can blend. The
      // opaque generated core and every other selected object stay opaque.
      material.transparent = (finish.opacity ?? 1) < 1;
      material.depthWrite = !material.transparent;
      material.needsUpdate = true;
      return material;
    };
    node.material = Array.isArray(node.material) ? node.material.map(convert) : convert(node.material);
  });
  return root;
}
