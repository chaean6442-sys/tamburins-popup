import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandCursorState, updateHandCursor } from '../app/logic/handCursor.ts';

test('one bad landmark frame does not jerk the cursor away from a steady hand', () => {
  const cursor = createHandCursorState();
  updateHandCursor(cursor, 0.2, -0.1, 1000);
  updateHandCursor(cursor, 0.205, -0.098, 1033);
  const before = { x: cursor.x, y: cursor.y };
  updateHandCursor(cursor, -0.6, 0.7, 1066);
  assert.ok(Math.hypot(cursor.x - before.x, cursor.y - before.y) < 0.015);
});

test('deliberate movement follows while a short tracking gap remains continuous', () => {
  const cursor = createHandCursorState();
  updateHandCursor(cursor, 0, 0, 1000);
  for (let frame = 1; frame <= 8; frame++) updateHandCursor(cursor, frame * 0.04, 0, 1000 + frame * 33);
  assert.ok(cursor.x > 0.27, 'a moving fingertip should remain close to the cursor');
  const beforeGap = cursor.x;
  updateHandCursor(cursor, 0.38, 0, 1544);
  assert.ok(cursor.x > beforeGap);
  assert.ok(cursor.x < 0.38);
  updateHandCursor(cursor, 0.4, 0, 2000);
  assert.equal(cursor.x, 0.4);
});

test('a real reposition is accepted after two matching frames', () => {
  const cursor = createHandCursorState();
  updateHandCursor(cursor, 0, 0, 1000);
  updateHandCursor(cursor, 0.6, 0.4, 1033);
  assert.equal(cursor.x, 0);
  updateHandCursor(cursor, 0.61, 0.41, 1066);
  assert.ok(cursor.x > 0.12);
  assert.ok(cursor.x < 0.2, 'accepted tracking must still move gradually');
  updateHandCursor(cursor, 0.62, 0.42, 1099);
  assert.ok(cursor.x > 0.24);
});
