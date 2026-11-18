const fract = (value: number) => value - Math.floor(value);
const fade = (value: number) => value * value * (3 - 2 * value);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function corner(x: number, y: number, z: number) {
  return fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453) * 2 - 1;
}

function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const layer = (dz: number) => lerp(
    lerp(corner(ix, iy, iz + dz), corner(ix + 1, iy, iz + dz), fx),
    lerp(corner(ix, iy + 1, iz + dz), corner(ix + 1, iy + 1, iz + dz), fx),
    fy,
  );
  return lerp(layer(0), layer(1), fz);
}

// Domain-warped 3D noise produces connected, irregular material patches.
// It has no preferred horizontal or vertical direction, unlike sine bands.
export function organicMaterialField(x: number, y: number, z: number) {
  const warpX = noise3(x * 1.7 + 9.4, y * 1.7, z * 1.7 - 3.1) * 0.28;
  const warpY = noise3(x * 1.7 - 4.8, y * 1.7 + 12.3, z * 1.7) * 0.28;
  const warpZ = noise3(x * 1.7, y * 1.7 - 7.6, z * 1.7 + 5.2) * 0.28;
  const px = x + warpX, py = y + warpY, pz = z + warpZ;
  return noise3(px * 3.3 + 2.9, py * 3.3 - 4.1, pz * 3.3 + 7.3) * 0.74
    + noise3(px * 6.7 - 8.2, py * 6.7 + 1.3, pz * 6.7) * 0.19
    + noise3(px * 12.6, py * 12.6 - 9.1, pz * 12.6 + 3.6) * 0.07;
}

export function balancedMaterialSplit(fields: number[]) {
  if (!fields.length) return 0;
  const sorted = [...fields].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
