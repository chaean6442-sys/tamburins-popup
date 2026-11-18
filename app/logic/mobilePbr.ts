import * as THREE from "three";

const resizedTextures = new WeakMap<THREE.Texture, Map<number, THREE.Texture>>();

function shouldReduceTextureMemory() {
  if (typeof window === "undefined") return false;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return window.matchMedia("(max-width: 900px)").matches || (typeof memory === "number" && memory <= 4);
}

function reducedTexture(source: THREE.Texture, maxSize = 1024) {
  const variants = resizedTextures.get(source) ?? new Map<number, THREE.Texture>();
  const cached = variants.get(maxSize);
  if (cached) return cached;
  const image = source.image as CanvasImageSource & { width?: number; height?: number };
  const width = Number(image?.width) || 0;
  const height = Number(image?.height) || 0;
  if (!width || !height || Math.max(width, height) <= maxSize) {
    variants.set(maxSize, source);
    resizedTextures.set(source, variants);
    return source;
  }
  try {
    const ratio = maxSize / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return source;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const texture = source.clone();
    texture.image = canvas;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    variants.set(maxSize, texture);
    resizedTextures.set(source, variants);
    return texture;
  } catch {
    variants.set(maxSize, source);
    resizedTextures.set(source, variants);
    return source;
  }
}

export function optimizePbrForMobile(root: THREE.Object3D, maxTextureSize = 1024) {
  if (!shouldReduceTextureMemory()) return root;
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const optimized = materials.map((source) => {
      const material = source.clone();
      for (const key of Object.keys(material)) {
        const value = (material as unknown as Record<string, unknown>)[key];
        if (value instanceof THREE.Texture) {
          // Preserve the photographed color detail. Auxiliary normal/PBR maps
          // can be smaller without turning the object itself into a mosaic.
          const limit = key === "map" || key === "emissiveMap" ? maxTextureSize : Math.min(maxTextureSize, 512);
          (material as unknown as Record<string, unknown>)[key] = reducedTexture(value, limit);
        }
      }
      material.needsUpdate = true;
      return material;
    });
    node.material = Array.isArray(node.material) ? optimized : optimized[0];
  });
  return root;
}
