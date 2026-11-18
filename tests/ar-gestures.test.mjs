import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceArPinch, newArPinchState, physicalHand, pinchRatio } from '../app/logic/arGestures.ts';

test('unmirrored camera labels map to physical left and right hands', () => {
  assert.equal(physicalHand('Right'), 'Left');
  assert.equal(physicalHand('Left'), 'Right');
  assert.equal(physicalHand(''), null);
});
test('holding a pinch advances once; a deliberate release is required to rearm', () => {
  const state = newArPinchState();
  const step = (ratio, now) => advanceArPinch(state, ratio, true, now);
  assert.equal(step(.1, 0), false);
  assert.equal(step(.1, 150), false);
  step(.7, 200); step(.7, 330);
  assert.equal(step(.1, 350), false);
  assert.equal(step(.1, 480), true);
  assert.equal(step(.1, 1500), false);
  step(.7, 1600); step(.7, 1730); step(.1, 1800);
  assert.equal(step(.1, 1930), true);
});
test('jitter and lost hands cannot create a stage change', () => {
  const state = newArPinchState();
  advanceArPinch(state, .7, true, 0); advanceArPinch(state, .7, true, 130);
  advanceArPinch(state, .1, true, 200);
  assert.equal(advanceArPinch(state, .35, true, 250), false);
  assert.equal(advanceArPinch(state, .1, true, 300), false);
  assert.equal(advanceArPinch(state, null, true, 350), false);
  assert.equal(advanceArPinch(state, .1, true, 600), false);
  advanceArPinch(state, .7, true, 700); advanceArPinch(state, .7, true, 850);
  assert.equal(advanceArPinch(state, .1, false, 900), false);
  assert.equal(advanceArPinch(state, .1, true, 1100), false);
});
test('pinch measurement is independent of distance from camera', () => {
  const points = Array.from({length:21}, () => ({x:0,y:0}));
  points[17].x=.2; points[8].x=.04;
  assert.ok(Math.abs(pinchRatio(points) - .2) < .0001);
  assert.equal(pinchRatio(points), pinchRatio(points.map(p => ({x:p.x*2,y:p.y*2}))));
});
