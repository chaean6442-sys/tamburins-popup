import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceDesktopPinch } from '../app/logic/desktopPinch.ts';

test('an open hand arms after two frames, then a pinch grabs and releases once', () => {
  const hand = { pinch: false, pinchFrames: 0, releaseFrames: 0 };
  assert.equal(advanceDesktopPinch(hand, 0.9).openReady, false);
  assert.equal(advanceDesktopPinch(hand, 0.85).openReady, true);
  assert.equal(advanceDesktopPinch(hand, 0.35).started, false);
  assert.equal(advanceDesktopPinch(hand, 0.34).started, true);
  assert.equal(hand.pinch, true);
  assert.equal(advanceDesktopPinch(hand, 0.51).ended, false);
  assert.equal(advanceDesktopPinch(hand, 0.7).ended, false);
  assert.equal(advanceDesktopPinch(hand, 0.72).ended, true);
  assert.equal(hand.pinch, false);
  assert.equal(advanceDesktopPinch(hand, 0.75).ended, false);
});
