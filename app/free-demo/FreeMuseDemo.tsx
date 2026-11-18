"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

type ExportContext = {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
};

const FRUIT_URL = "/models/demo-fruit.glb";
const FABRIC_URL = "/models/demo-fabric.glb";

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function createMuseGeometry() {
  const geometry = new THREE.SphereGeometry(1.12, 112, 84);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const point = new THREE.Vector3();

  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    const direction = point.clone().normalize();
    const wave =
      Math.sin(direction.x * 4.1 + direction.y * 2.3) * 0.075 +
      Math.sin(direction.z * 5.2 - direction.y * 3.4) * 0.055 +
      Math.cos((direction.x - direction.z) * 3.1) * 0.04;
    const radius = 1 + wave;
    point.copy(direction).multiplyScalar(1.12 * radius);
    point.x *= 0.92 + (direction.y + 1) * 0.075;
    point.y *= 1.22;
    point.z *= 0.86;
    point.x += 0.13 * Math.sin((direction.y + 0.3) * Math.PI);
    point.z += 0.07 * Math.sin(direction.x * Math.PI * 1.5);
    position.setXYZ(index, point.x, point.y, point.z);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function useNormalizedModel(url: string, targetSize: number) {
  const gltf = useGLTF(url);
  return useMemo(() => {
    const model = gltf.scene.clone(true);
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      if (Array.isArray(object.material)) {
        object.material = object.material.map((material) => material.clone());
      } else if (object.material) {
        object.material = object.material.clone();
      }
    });
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const largest = Math.max(size.x, size.y, size.z) || 1;
    const scale = targetSize / largest;
    model.scale.setScalar(scale);
    model.position.copy(center.multiplyScalar(-scale));
    return model;
  }, [gltf.scene, targetSize]);
}

function Asset({
  url,
  targetSize,
  position,
  rotation,
  scale = 1,
}: {
  url: string;
  targetSize: number;
  position: [number, number, number];
  rotation: [number, number, number];
  scale?: number;
}) {
  const model = useNormalizedModel(url, targetSize);
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <primitive object={model.clone(true)} />
    </group>
  );
}

function ExportBridge({ onReady }: { onReady: (context: ExportContext) => void }) {
  const context = useThree();
  useEffect(() => onReady({ gl: context.gl, scene: context.scene, camera: context.camera }), [context, onReady]);
  return null;
}

function MuseAssembly({
  root,
  onReady,
}: {
  root: React.RefObject<THREE.Group | null>;
  onReady: (context: ExportContext) => void;
}) {
  const turntable = useRef<THREE.Group>(null);
  const geometry = useMemo(() => createMuseGeometry(), []);

  useFrame((_, delta) => {
    if (turntable.current) turntable.current.rotation.y += delta * 0.08;
  });

  return (
    <>
      <ExportBridge onReady={onReady} />
      <ambientLight intensity={0.38} />
      <directionalLight position={[-4, 6, 4]} intensity={1.8} color="#fff8e9" castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[4, 1, 2]} intensity={0.72} color="#d9ff6a" />
      <pointLight position={[0, -1, 3]} intensity={5.5} distance={7} color="#ffffff" />
      <group ref={turntable}>
        <group ref={root} position={[0, 0.15, 0]}>
          <mesh geometry={geometry} castShadow receiveShadow>
            <meshPhysicalMaterial
              color="#d7d8c9"
              roughness={0.2}
              metalness={0.16}
              clearcoat={1}
              clearcoatRoughness={0.11}
              transmission={0.025}
              thickness={0.8}
              ior={1.42}
              iridescence={0.18}
              iridescenceIOR={1.3}
              sheen={0.22}
              sheenColor="#d8ef57"
            />
          </mesh>

          <Suspense fallback={null}>
            <Asset url={FABRIC_URL} targetSize={1.38} position={[-0.54, -0.42, 0.87]} rotation={[0.42, -0.15, -0.55]} scale={0.96} />
            <Asset url={FABRIC_URL} targetSize={1.12} position={[0.52, -0.55, 0.7]} rotation={[-0.3, 0.42, 0.62]} scale={0.83} />
            <Asset url={FRUIT_URL} targetSize={0.7} position={[-0.52, 0.72, 0.92]} rotation={[0.1, -0.45, -0.22]} />
            <Asset url={FRUIT_URL} targetSize={0.61} position={[0.06, 1.0, 0.68]} rotation={[0.18, 0.18, 0.08]} />
            <Asset url={FRUIT_URL} targetSize={0.57} position={[0.58, 0.58, 0.82]} rotation={[0.22, 0.65, 0.12]} />
            <Asset url={FRUIT_URL} targetSize={0.45} position={[0.84, 0.02, 0.42]} rotation={[-0.2, 1.1, 0.55]} />
          </Suspense>
        </group>

        <mesh position={[0, -1.35, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[1.62, 1.68, 0.18, 128]} />
          <meshPhysicalMaterial color="#12120f" metalness={0.8} roughness={0.12} clearcoat={1} clearcoatRoughness={0.05} />
        </mesh>
        <mesh position={[0, -1.24, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.39, 0.025, 16, 128]} />
          <meshStandardMaterial color="#c8e61d" emissive="#7f9700" emissiveIntensity={0.65} />
        </mesh>
      </group>

      <ContactShadows position={[0, -1.46, 0]} opacity={0.68} scale={7} blur={2.5} far={4.2} />
      <Environment files="/environments/muse-studio.hdr" background={false} environmentIntensity={0.62} />
      <OrbitControls enablePan={false} minDistance={4.1} maxDistance={7.5} minPolarAngle={0.72} maxPolarAngle={2.1} target={[0, 0.05, 0]} />
    </>
  );
}

export default function FreeMuseDemo() {
  const exportRoot = useRef<THREE.Group>(null);
  const exportContext = useRef<ExportContext | null>(null);
  const [notice, setNotice] = useState("마우스로 돌려서 확인해보세요");

  const setContext = useCallback((context: ExportContext) => {
    exportContext.current = context;
  }, []);

  const savePng = () => {
    const context = exportContext.current;
    if (!context) return;
    context.gl.render(context.scene, context.camera);
    context.gl.domElement.toBlob((blob) => {
      if (!blob) return;
      download(blob, "MUSE_FREE_PIPELINE_SAMPLE.png");
      setNotice("렌더 이미지가 저장됐습니다");
    }, "image/png");
  };

  const saveGlb = async () => {
    if (!exportRoot.current) return;
    setNotice("GLB를 정리하고 있습니다");
    try {
      const exporter = new GLTFExporter();
      const output = await exporter.parseAsync(exportRoot.current, {
        binary: true,
        onlyVisible: true,
        maxTextureSize: 2048,
      });
      download(new Blob([output as ArrayBuffer], { type: "model/gltf-binary" }), "MUSE_FREE_PIPELINE_SAMPLE.glb");
      setNotice("완성된 3D가 저장됐습니다");
    } catch {
      setNotice("3D 저장 중 오류가 발생했습니다");
    }
  };

  return (
    <main className="free-demo-page">
      <header className="free-demo-header">
        <div>
          <p>NO GENERATION API · LIVE ASSEMBLY SAMPLE</p>
          <h1>Make Your MUSE</h1>
        </div>
        <a href="/">TAMBURINS</a>
      </header>

      <section className="free-demo-stage">
        <Canvas
          shadows
          camera={{ position: [0, 0.12, 6.45], fov: 36 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping }}
          onCreated={({ gl }) => {
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.toneMappingExposure = 0.78;
          }}
        >
          <MuseAssembly root={exportRoot} onReady={setContext} />
        </Canvas>
        <div className="free-demo-caption">
          <span>01 / SCULPT</span>
          <strong>유광 조형 + 과일 + 천</strong>
          <p>기존 3D 자산을 조형 표면에 직접 배치한 결과입니다.</p>
        </div>
      </section>

      <footer className="free-demo-footer">
        <p>{notice}</p>
        <div>
          <button type="button" onClick={savePng}>이미지로 저장</button>
          <button type="button" onClick={saveGlb}>3D로 저장</button>
        </div>
      </footer>
    </main>
  );
}

useGLTF.preload(FRUIT_URL);
useGLTF.preload(FABRIC_URL);
