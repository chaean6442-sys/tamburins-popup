import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) throw new Error("Usage: node optimize-mobile-glb.mjs input.glb output.glb");

const source = await readFile(sourcePath);
if (source.toString("ascii", 0, 4) !== "glTF" || source.readUInt32LE(4) !== 2) throw new Error("Expected a GLB v2 file");
const jsonLength = source.readUInt32LE(12);
const json = JSON.parse(source.toString("utf8", 20, 20 + jsonLength));
const binaryHeader = 20 + jsonLength;
const binaryLength = source.readUInt32LE(binaryHeader);
const binary = source.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength);
const primitive = json.meshes?.[0]?.primitives?.[0];
if (json.meshes?.length !== 1 || json.meshes[0].primitives.length !== 1 ||
    json.images?.length !== 3 || json.bufferViews?.length !== 7 ||
    primitive?.attributes?.POSITION !== 0 || primitive.attributes.NORMAL !== 1 ||
    primitive.attributes.TEXCOORD_0 !== 2 || primitive.indices !== 3) {
  throw new Error("Unexpected Tripo GLB layout; refusing to alter the model");
}

await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
function decodeView(index) {
  const extension = json.bufferViews[index].extensions?.EXT_meshopt_compression;
  if (!extension) throw new Error(`Missing meshopt data for buffer view ${index}`);
  const bytes = new Uint8Array(extension.count * extension.byteStride);
  const encoded = binary.subarray(extension.byteOffset, extension.byteOffset + extension.byteLength);
  MeshoptDecoder.decodeGltfBuffer(bytes, extension.count, extension.byteStride, encoded, extension.mode, extension.filter);
  return bytes;
}

const positions = new Float32Array(decodeView(3).buffer);
const normals = decodeView(4);
const uvs = new Float32Array(decodeView(5).buffer);
const indices = new Uint32Array(decodeView(6).buffer);
const targetIndices = Math.min(indices.length, 270_000);
let [simplified] = MeshoptSimplifier.simplify(indices, positions, 3, targetIndices, .035, ["Permissive"]);
if (simplified.length > targetIndices * 1.25) {
  [simplified] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, targetIndices, .05);
}
if (simplified.length < 3) throw new Error("Mesh simplification removed the object");
const compactIndices = Uint32Array.from(simplified);
const [remap, vertexCount] = MeshoptSimplifier.compactMesh(compactIndices);
const compactPositions = new Float32Array(vertexCount * 3);
const compactNormals = new Uint8Array(vertexCount * 4);
const compactUvs = new Float32Array(vertexCount * 2);
const minimum = [Infinity, Infinity, Infinity];
const maximum = [-Infinity, -Infinity, -Infinity];
for (let oldIndex = 0; oldIndex < remap.length; oldIndex++) {
  const nextIndex = remap[oldIndex];
  if (nextIndex === 0xffffffff) continue;
  for (let axis = 0; axis < 3; axis++) {
    const value = positions[oldIndex * 3 + axis];
    compactPositions[nextIndex * 3 + axis] = value;
    minimum[axis] = Math.min(minimum[axis], value);
    maximum[axis] = Math.max(maximum[axis], value);
  }
  compactNormals.set(normals.subarray(oldIndex * 4, oldIndex * 4 + 4), nextIndex * 4);
  compactUvs[nextIndex * 2] = uvs[oldIndex * 2];
  compactUvs[nextIndex * 2 + 1] = uvs[oldIndex * 2 + 1];
}

const parts = [];
const views = [];
let offset = 0;
function addPart(bytes, target, byteStride) {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const padding = (4 - offset % 4) % 4;
  if (padding) { parts.push(Buffer.alloc(padding)); offset += padding; }
  const view = { buffer: 0, byteOffset: offset, byteLength: data.length };
  if (target) view.target = target;
  if (byteStride) view.byteStride = byteStride;
  views.push(view);
  parts.push(data);
  offset += data.length;
}
for (const image of json.images) {
  const view = json.bufferViews[image.bufferView];
  const input = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
  const resized = sharp(input).resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true });
  const output = image.mimeType === "image/png"
    ? await resized.png({ compressionLevel: 9 }).toBuffer()
    : await resized.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  addPart(output);
}
addPart(new Uint8Array(compactPositions.buffer), 34962, 12);
addPart(compactNormals, 34962, 4);
addPart(new Uint8Array(compactUvs.buffer), 34962, 8);
addPart(new Uint8Array(compactIndices.buffer), 34963);

json.buffers = [{ byteLength: offset + (4 - offset % 4) % 4 }];
json.bufferViews = views;
json.accessors[0] = { ...json.accessors[0], bufferView: 3, byteOffset: 0, count: vertexCount, min: minimum, max: maximum };
json.accessors[1] = { ...json.accessors[1], bufferView: 4, byteOffset: 0, count: vertexCount };
json.accessors[2] = { ...json.accessors[2], bufferView: 5, byteOffset: 0, count: vertexCount };
json.accessors[3] = { ...json.accessors[3], bufferView: 6, byteOffset: 0, count: compactIndices.length };
json.extensionsUsed = json.extensionsUsed?.filter((name) => name !== "EXT_meshopt_compression");
json.extensionsRequired = json.extensionsRequired?.filter((name) => name !== "EXT_meshopt_compression");
if (!json.extensionsRequired?.length) delete json.extensionsRequired;
const jsonBytes = Buffer.from(JSON.stringify(json));
const jsonPad = (4 - jsonBytes.length % 4) % 4;
const paddedJson = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
const binaryPad = (4 - offset % 4) % 4;
if (binaryPad) parts.push(Buffer.alloc(binaryPad));
const paddedBinary = Buffer.concat(parts);
const result = Buffer.alloc(12 + 8 + paddedJson.length + 8 + paddedBinary.length);
result.write("glTF", 0, "ascii");
result.writeUInt32LE(2, 4);
result.writeUInt32LE(result.length, 8);
result.writeUInt32LE(paddedJson.length, 12);
result.writeUInt32LE(0x4e4f534a, 16);
paddedJson.copy(result, 20);
const binaryOffset = 20 + paddedJson.length;
result.writeUInt32LE(paddedBinary.length, binaryOffset);
result.writeUInt32LE(0x004e4942, binaryOffset + 4);
paddedBinary.copy(result, binaryOffset + 8);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, result);
console.log(`${sourcePath}: ${(indices.length / 3).toFixed(0)} → ${(compactIndices.length / 3).toFixed(0)} triangles, ${(source.length / 1e6).toFixed(1)} → ${(result.length / 1e6).toFixed(1)} MB`);
