"use client";
import { useMemo, useRef, type RefObject } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { optimizePbrForMobile } from "../logic/mobilePbr";
import { enhancePreparedObjectMaterials } from "../logic/objectPbr";
import { planBloomInstances, type BloomInstance } from "../logic/arBloom";
import { growthMount } from "../logic/arGrowth";

type SurfaceAnchor = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  normal: THREE.Vector3;
};

const BODY_MATERIAL_IDS = new Set(["cloud", "metal", "sand", "stone", "light", "ice", "chrome", "moss", "wood", "cocoon", "water"]);
function TripoGrowthObject({ id, url, radius, placements, anchors }: { id: string; url: string; radius: number; placements: BloomInstance[]; anchors: SurfaceAnchor[] }) {
  const gltf = useLoader(GLTFLoader, url, (loader) => loader.setMeshoptDecoder(MeshoptDecoder));
  const normalized = useMemo(() => {
    // Keep the original 768px color detail; reduce only auxiliary PBR maps
    // when the phone needs to conserve WebGL memory.
    const clone = enhancePreparedObjectMaterials(optimizePbrForMobile(gltf.scene.clone(true), 768), id);
    const bounds = new THREE.Box3().setFromObject(clone);
    const size = bounds.getSize(new THREE.Vector3());
    const mount = growthMount(id, bounds);
    clone.position.sub(mount.origin);
    const root = new THREE.Group();
    root.add(clone);
    root.scale.setScalar(.9 / Math.max(size.x, size.y, size.z, .001));
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Use the prepared GLB's original maps and PBR settings, exactly as
        // the same object does when it attaches during sculpting.
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return { root, alignment: mount.alignment, unfurl: mount.unfurl, rooted: mount.rooted };
  }, [gltf.scene, id]);
  // The copies share geometry and PBR textures; only their transforms differ.
  const copies = useMemo(() => placements.map(() => normalized.root.clone(true)), [normalized, placements]);
  return <group>{placements.map((placement, i) => {
    const anchor = anchors[placement.anchorIndex];
    const position = normalized.rooted ? anchor.position.clone().addScaledVector(anchor.normal, -radius * .095) : anchor.position;
    return <group key={placement.index} position={position} quaternion={anchor.quaternion} scale={0} visible={false}
      userData={{ kind: "tripo-growth", index: placement.index, revealAt: placement.revealAt, size: placement.size, unfurl: normalized.unfurl, rooted: normalized.rooted, radius }}>
      <group rotation={[0, placement.index * 1.73, 0]} scale={radius}>
        <group quaternion={normalized.alignment}><primitive object={copies[i]} /></group>
      </group>
    </group>;
  })}</group>;
}

// Grow effects on the actual generated surface, preserving the original model.
export function ArEvolution({ model, effects, objectModels, openness, strength, radius }: {
  model: THREE.Object3D; effects: string[]; objectModels: Record<string, string>; openness: RefObject<number>; strength: number; radius: number;
}) {
  const root = useRef<THREE.Group>(null);
  const progress = useRef(0);
  const anchors = useMemo(() => {
    // Raycasting against the full Tripo mesh on camera switch can stall or
    // terminate a phone browser. Use its bounding ellipsoid instead.
    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    const extent = bounds.getSize(new THREE.Vector3()).multiplyScalar(.5);
    extent.set(Math.max(extent.x, radius * .6), Math.max(extent.y, radius * .6), Math.max(extent.z, radius * .6));
    return Array.from({ length: 18 }, (_, i) => {
      const y = 1 - 2 * (i + .5) / 18;
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      const normal = new THREE.Vector3(Math.cos(angle) * Math.sqrt(1 - y * y), y, Math.sin(angle) * Math.sqrt(1 - y * y));
      const position = center.clone().add(new THREE.Vector3(normal.x * extent.x, normal.y * extent.y, normal.z * extent.z));
      const outward = new THREE.Vector3(normal.x / extent.x, normal.y / extent.y, normal.z / extent.z).normalize();
      return { position: position.addScaledVector(outward, radius * .015), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward), normal: outward };
    });
  }, [model, radius]);
  const growthAnchors = useMemo(() => anchors.filter((anchor) => anchor.normal.z >= -.35), [anchors]);
  const tripoEffects = [...new Set(effects.filter((id) => objectModels[id] && !BODY_MATERIAL_IDS.has(id)))];
  const tripoKey = tripoEffects.join("|");
  const bloomPlan = useMemo(() => planBloomInstances(tripoKey ? tripoKey.split("|") : [], growthAnchors.length), [tripoKey, growthAnchors.length]);
  const bloomById = useMemo(() => {
    const result = new Map<string, BloomInstance[]>();
    bloomPlan.forEach((placement) => result.set(placement.id, [...(result.get(placement.id) ?? []), placement]));
    return result;
  }, [bloomPlan]);

  useFrame((_, delta) => {
    // The first selected 3D object should already be visible as soon as the
    // rear camera finds a palm; opening the hand grows the full composition.
    progress.current = THREE.MathUtils.damp(progress.current, Math.max(.16, openness.current), 8.5, delta);
    const p = progress.current;
    const updateEffect = (node: THREE.Object3D) => {
      const { kind } = node.userData;
      if (kind === "tripo-growth") {
        const { revealAt = 0, size = .38, unfurl = false, radius: objectRadius = radius } = node.userData;
        const growth = THREE.MathUtils.smoothstep(p, revealAt, Math.min(1, revealAt + .45));
        node.visible = growth > .015;
        node.scale.setScalar(size * (unfurl ? .14 + growth * .86 : growth) * (.72 + p * .63) * (.92 + strength * .12));
        if (unfurl && node.children[0]) {
          // The stem remains planted while the petal/leaf width opens around it.
          const opening = THREE.MathUtils.smoothstep(growth, .08, .95);
          node.children[0].scale.set(objectRadius * (.3 + .7 * opening), objectRadius * (.62 + .38 * opening), objectRadius * (.3 + .7 * opening));
        }
      }
      // A prepared GLB may contain hundreds of meshes. Only its outer growth
      // group animates, so never walk through its geometry on every frame.
      if (kind !== "tripo-growth") node.children.forEach(updateEffect);
    };
    if (root.current) updateEffect(root.current);
  });

  return <group ref={root}>
    {tripoEffects.map((id) => <TripoGrowthObject key={`tripo-${id}`} id={id} url={objectModels[id]} radius={radius}
      placements={bloomById.get(id) ?? []} anchors={growthAnchors} />)}
  </group>;
}
