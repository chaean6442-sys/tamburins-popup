import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraErrorMessage, createCameraManager, openPhysicalCamera } from '../app/logic/cameraSession.ts';
const fakeStream = () => {
  const track = { stopped: false, stop() { this.stopped = true; } };
  return { track, getTracks: () => [track] };
};
const cameras = [
  { kind: 'videoinput', deviceId: 'virtual', label: 'Lenovo Virtual Camera' },
  { kind: 'videoinput', deviceId: 'physical', label: 'Integrated Camera' },
];
test('selects Integrated Camera instead of the default Lenovo virtual camera', async () => {
  const stream = fakeStream();
  assert.equal(await openPhysicalCamera({video:{facingMode:'user'},audio:false}, {
    enumerateDevices: async () => cameras,
    getUserMedia: async constraints => {
      assert.equal(constraints.video.deviceId.exact, 'physical');
      return stream;
    },
  }), stream);
});
test('re-enumerates after permission reveals camera names on a failed default request', async () => {
  let calls = 0;
  const stream = fakeStream();
  assert.equal(await openPhysicalCamera({video:true}, {
    enumerateDevices: async () => calls ? cameras : cameras.map(c => ({...c,label:''})),
    getUserMedia: async constraints => {
      if (!calls++) throw new DOMException('virtual failed', 'NotReadableError');
      assert.equal(constraints.video.deviceId.exact, 'physical');
      return stream;
    },
  }), stream);
});
test('preserves rear camera constraints for phone AR', async () => {
  const constraints = {video:{facingMode:{exact:'environment'}}};
  await openPhysicalCamera(constraints, {
    enumerateDevices: async () => { throw new Error('must not enumerate'); },
    getUserMedia: async received => { assert.equal(received, constraints); return fakeStream(); },
  });
});
test('lets the browser resolve an ideal phone camera facing mode', async () => {
  const constraints = {video:{facingMode:{ideal:'user'}}};
  await openPhysicalCamera(constraints, {
    enumerateDevices: async () => { throw new Error('must not enumerate'); },
    getUserMedia: async received => { assert.equal(received, constraints); return fakeStream(); },
  });
});
test('pending permission from an abandoned screen is released before the next request', async () => {
  let resolveFirst;
  let calls = 0;
  const firstStream = fakeStream(), secondStream = fakeStream();
  const create = createCameraManager(async () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { resolveFirst = resolve; });
    assert.equal(firstStream.track.stopped, true);
    return secondStream;
  });
  const first = create(), second = create();
  const pendingFirst = first.open({video:true});
  await Promise.resolve();
  first.stop();
  const pendingSecond = second.open({video:true});
  resolveFirst(firstStream);
  assert.equal(await pendingFirst, null);
  assert.equal(await pendingSecond, secondStream);
  first.stop();
  assert.equal(secondStream.track.stopped, false);
  second.stop();
  assert.equal(secondStream.track.stopped, true);
});
test('screen replacement stops the active stream before opening the next one', async () => {
  const streams = [fakeStream(), fakeStream()];
  let i = 0;
  const create = createCameraManager(async () => {
    if (i) assert.equal(streams[0].track.stopped, true);
    return streams[i++];
  });
  await create().open({video:true});
  await create().open({video:true});
});
test('a denied camera request does not block a later retry', async () => {
  let calls = 0;
  const stream = fakeStream();
  const create = createCameraManager(async () => {
    if (!calls++) throw new DOMException('denied', 'NotAllowedError');
    return stream;
  });
  await assert.rejects(create().open({video:true}), {name:'NotAllowedError'});
  assert.equal(await create().open({video:true}), stream);
});

test('rear camera errors identify the camera that failed', () => {
  assert.match(cameraErrorMessage(new DOMException('unavailable', 'NotFoundError'), 'environment'), /후면 카메라/);
});
