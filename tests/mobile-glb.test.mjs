import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ids = ['flower', 'branch', 'mushroom', 'crystal', 'fabric', 'fruit', 'leaf', 'feather', 'ribbon', 'lily', 'rose'];

test('every selected growth object has a valid lightweight phone model', async () => {
  for (const id of ids) {
    const file = await readFile(`public/models/mobile/${id}.glb`);
    assert.equal(file.toString('ascii', 0, 4), 'glTF', id);
    assert.equal(file.readUInt32LE(8), file.length, id);
    assert.ok(file.length < 4_000_000, `${id} is too large for the phone`);
    const jsonLength = file.readUInt32LE(12);
    const gltf = JSON.parse(file.toString('utf8', 20, 20 + jsonLength));
    const binaryHeader = 20 + jsonLength;
    const binary = file.subarray(binaryHeader + 8, binaryHeader + 8 + file.readUInt32LE(binaryHeader));
    assert.equal(gltf.meshes.length, 1, id);
    assert.equal(gltf.meshes[0].primitives.length, 1, id);
    assert.ok(gltf.accessors[gltf.meshes[0].primitives[0].indices].count <= 270_000, id);
    for (const view of gltf.bufferViews) assert.ok(view.byteOffset + view.byteLength <= binary.length, id);
    for (const image of gltf.images) {
      const view = gltf.bufferViews[image.bufferView];
      const bytes = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
      if (image.mimeType === 'image/jpeg') assert.equal(bytes.toString('hex', 0, 2), 'ffd8', id);
      else if (image.mimeType === 'image/png') assert.equal(bytes.toString('hex', 0, 4), '89504e47', id);
      else assert.fail(`${id} has an unsupported texture type`);
    }
  }
});
