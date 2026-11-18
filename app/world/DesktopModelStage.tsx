"use client";
import { useMemo, useRef, useEffect, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

export function DesktopModelStage({ children, enabled, visible = true, level = 0, twist = 0, squeeze = 0, model }: { children: ReactNode; enabled: boolean; visible?: boolean; level?: number; twist?: number; squeeze?: number; model: THREE.Object3D }) {
  const turntable = useRef<THREE.Group>(null);
  const frame = useRef<THREE.Group>(null);
  const content = useRef<THREE.Group>(null);
  const smoke = useRef<THREE.Points>(null);
  const reveal = useRef({ value: 0 });
  const deformation = useRef({ twist: { value: 0 }, squeeze: { value: 0 } });
  const burst = useRef(0);
  useEffect(() => { if (visible) burst.current = 1; }, [visible, level]);
  useEffect(() => {
    // The same stage survives the selfie-to-rear switch. Selfie mode may have
    // hidden its content while no hand was visible; restore it in rear mode.
    if (!enabled && content.current) content.current.visible = visible;
  }, [enabled, visible]);
  const { viewport } = useThree();
  const side = Math.min(viewport.width, viewport.height) * .5;
  const edges = useMemo(() => {
    const box = new THREE.BoxGeometry(side, side, side);
    const geometry = new THREE.EdgesGeometry(box);
    box.dispose();
    return geometry;
  }, [side]);
  useEffect(() => () => edges.dispose(), [edges]);
  const particles = useMemo(() => {
    const positions = new Float32Array(420 * 3);
    for (let i = 0; i < 420; i++) {
      const a = i * 2.39996;
      const r = side * (.12 + .27 * ((i * 37 % 101) / 101));
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = side * ((i * 71 % 419) / 419 - .5) * .85;
      positions[i * 3 + 2] = Math.sin(a) * r;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, [side]);
  useEffect(() => () => particles.dispose(), [particles]);
  useEffect(() => {
    if (!enabled || !content.current) return;
    const restored: Array<{ mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; clones: THREE.Material[] }> = [];
    content.current.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const original = node.material;
      const geometry = node.geometry as THREE.BufferGeometry;
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      const centerX = bounds ? (bounds.min.x + bounds.max.x) * .5 : 0;
      const centerY = bounds ? (bounds.min.y + bounds.max.y) * .5 : 0;
      const centerZ = bounds ? (bounds.min.z + bounds.max.z) * .5 : 0;
      const inverseHeight = 1 / Math.max(.0001, bounds ? bounds.max.y - bounds.min.y : 1);
      const radius = bounds ? Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * .5 : 1;
      const clones = (Array.isArray(original) ? original : [original]).map(material => {
        const clone = material.clone();
        clone.onBeforeCompile = shader => {
          shader.uniforms.uMuseReveal = reveal.current;
          shader.uniforms.uMuseTwist = deformation.current.twist;
          shader.uniforms.uMuseSqueeze = deformation.current.squeeze;
          shader.uniforms.uMuseCenterX = { value: centerX };
          shader.uniforms.uMuseCenterY = { value: centerY };
          shader.uniforms.uMuseCenterZ = { value: centerZ };
          shader.uniforms.uMuseInverseHeight = { value: inverseHeight };
          shader.uniforms.uMuseRadius = { value: radius };
          shader.vertexShader = "uniform float uMuseTwist; uniform float uMuseSqueeze; uniform float uMuseCenterX; uniform float uMuseCenterY; uniform float uMuseCenterZ; uniform float uMuseInverseHeight; uniform float uMuseRadius; varying vec3 vMusePosition;\n" + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
            #include <begin_vertex>
            float museY = clamp((position.y - uMuseCenterY) * uMuseInverseHeight * 2.0, -1.0, 1.0);
            float museAbsTwist = abs(uMuseTwist);
            float museAngle = uMuseTwist * (museY * 10.5 + sin(museY * 3.14159265) * 2.1);
            float museCos = cos(museAngle);
            float museSin = sin(museAngle);
            vec2 museLocal = transformed.xz - vec2(uMuseCenterX, uMuseCenterZ);
            museLocal = mat2(museCos, -museSin, museSin, museCos) * museLocal;
            float museWaist = 1.0 - smoothstep(0.0, 0.9, abs(museY));
            float musePinch = 1.0 - museAbsTwist * museWaist * 0.52;
            museLocal *= musePinch;
            museLocal.x *= 1.0 + uMuseSqueeze * museWaist * 0.72;
            museLocal.y *= 1.0 - uMuseSqueeze * museWaist * 0.48;
            transformed.xz = museLocal + vec2(uMuseCenterX, uMuseCenterZ);
            transformed.x += sin(museY * 4.2 + uMuseTwist * 2.4) * uMuseRadius * museAbsTwist * .38;
            transformed.z += cos(museY * 3.4 - uMuseTwist * 1.7) * uMuseRadius * museAbsTwist * .24;
            transformed.y = uMuseCenterY + (transformed.y - uMuseCenterY) * (1.0 - abs(uMuseSqueeze) * 0.2);
            vMusePosition = transformed;
          `);
          shader.fragmentShader = "uniform float uMuseReveal; varying vec3 vMusePosition;\n" + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace("#include <dithering_fragment>", `
            float grain = fract(sin(dot(floor(vMusePosition * 32.0), vec3(12.9898,78.233,45.164))) * 43758.5453);
            if (uMuseReveal < 0.999 && grain > uMuseReveal) discard;
            float edge = (1.0 - smoothstep(0.0, 0.12, uMuseReveal - grain)) * (1.0 - step(0.999, uMuseReveal));
            gl_FragColor.rgb += vec3(0.3, 0.95, 0.85) * edge * 0.8;
            #include <dithering_fragment>
          `);
        };
        clone.customProgramCacheKey = () => "muse-hand-twist-v3";
        return clone;
      });
      node.material = Array.isArray(original) ? clones : clones[0];
      restored.push({ mesh: node, original, clones });
    });
    return () => restored.forEach(({ mesh, original, clones }) => { mesh.material = original; clones.forEach(material => material.dispose()); });
  }, [enabled, model]);
  useFrame((_, delta) => {
    if (!enabled) {
      if (content.current) content.current.visible = visible;
      return;
    }
    const dt = Math.min(delta, .05);
    const twistTarget = THREE.MathUtils.clamp(twist, -1, 1) * (1.15 + level * .16);
    const squeezeTarget = THREE.MathUtils.clamp(squeeze, -1, 1);
    deformation.current.twist.value = THREE.MathUtils.damp(deformation.current.twist.value, twistTarget, 11, dt);
    deformation.current.squeeze.value = THREE.MathUtils.damp(deformation.current.squeeze.value, squeezeTarget, 10, dt);
    reveal.current.value = THREE.MathUtils.clamp(reveal.current.value + (visible ? dt / 1.5 : -dt / .7), 0, 1);
    burst.current = Math.max(0, burst.current - dt / 1.8);
    if (turntable.current) turntable.current.rotation.y += dt * .48;
    if (frame.current) {
      frame.current.rotation.y += dt * .48;
      frame.current.visible = visible || reveal.current.value > 0;
    }
    if (content.current) {
      content.current.visible = reveal.current.value > .005;
      content.current.rotation.z = deformation.current.twist.value * .16;
      content.current.scale.set(
        1 + Math.abs(deformation.current.squeeze.value) * .1,
        1 - Math.abs(deformation.current.squeeze.value) * .08,
        1 + Math.abs(deformation.current.twist.value) * .04,
      );
    }
    if (smoke.current) {
      smoke.current.rotation.y -= dt * .55;
      smoke.current.scale.setScalar(1 + (1 - burst.current) * .45);
      const material = smoke.current.material as THREE.PointsMaterial;
      material.opacity = Math.sin(burst.current * Math.PI) * .55;
      smoke.current.visible = burst.current > 0 && visible;
    }
  });
  return <>
    {enabled && <group ref={frame} rotation={[.12, -.28, 0]}>
      <lineSegments geometry={edges}><lineBasicMaterial color="#ffffff" transparent opacity={.85} /></lineSegments>
      {[-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => <mesh key={`${x}${y}${z}`} position={[x * side / 2, y * side / 2, z * side / 2]}>
        <sphereGeometry args={[side * .008, 8, 8]} /><meshBasicMaterial color="white" />
      </mesh>)))}
    </group>}
    {enabled && <points ref={smoke} geometry={particles}>
      <pointsMaterial color="#91fff0" size={side * .06} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} onBeforeCompile={shader => {
        shader.fragmentShader = shader.fragmentShader.replace("#include <premultiplied_alpha_fragment>", "gl_FragColor.a *= exp(-dot(gl_PointCoord - 0.5, gl_PointCoord - 0.5) * 18.0);\n#include <premultiplied_alpha_fragment>");
      }} />
    </points>}
    <group ref={turntable}><group ref={content}>{children}</group></group>
  </>;
}
