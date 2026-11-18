import assert from "node:assert/strict";
import test from "node:test";
import { assignDesktopHands } from "../app/logic/desktopHands.ts";

function hand(x, label, confidence = 0.9) {
  const landmarks = Array.from({ length: 21 }, () => ({ x, y: 0.5 }));
  landmarks[0] = { x, y: 0.6 };
  landmarks[5] = { x: x - 0.04, y: 0.48 };
  landmarks[17] = { x: x + 0.04, y: 0.48 };
  return { landmarks, label, confidence };
}

const tracks = () => [
  { x: 0, y: 0, lastAt: 0 },
  { x: 0, y: 0, lastAt: 0 },
];

test("one hand detected twice becomes one cursor", () => {
  const result = assignDesktopHands([hand(0.3, "Left"), hand(0.31, "Right", 0.7)], tracks(), 1000);
  assert.equal(result.length, 1);
  assert.equal(result[0].slot, 0);
});

test("two physical hands keep separate cursor slots", () => {
  const result = assignDesktopHands([hand(0.3, "Left"), hand(0.7, "Right")], tracks(), 1000);
  assert.deepEqual(result.map(({ slot }) => slot), [0, 1]);
});

test("a brief handedness label flip preserves the tracked hand", () => {
  const previous = tracks();
  previous[0] = { x: 0.3, y: 0.5, lastAt: 1000 };
  const result = assignDesktopHands([hand(0.31, "Right")], previous, 1033);
  assert.equal(result[0].slot, 0);
});
