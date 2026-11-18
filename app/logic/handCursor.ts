export type HandCursorState = {
  x: number;
  y: number;
  lastAt: number;
  active: boolean;
  outlier: { x: number; y: number } | null;
};

export function createHandCursorState(): HandCursorState {
  return { x: 0, y: 0, lastAt: 0, active: false, outlier: null };
}

export function updateHandCursor(state: HandCursorState, rawX: number, rawY: number, now: number) {
  const gap = now - state.lastAt;
  if (!state.active || gap > 420) {
    state.x = rawX;
    state.y = rawY;
    state.lastAt = now;
    state.active = true;
    state.outlier = null;
    return { x: state.x, y: state.y, alpha: 1 };
  }

  const elapsed = Math.min(100, Math.max(8, gap));
  const distance = Math.hypot(rawX - state.x, rawY - state.y);
  // Only reject a near-screen-wide one-frame tracking error. Smaller quick
  // reaches must continue moving instead of freezing for a frame.
  if (distance > 0.65 && gap < 80) {
    if (!state.outlier || Math.hypot(rawX - state.outlier.x, rawY - state.outlier.y) > 0.12) {
      state.outlier = { x: rawX, y: rawY };
      state.lastAt = now;
      return { x: state.x, y: state.y, alpha: 0 };
    }
  }
  state.outlier = null;
  // Small landmark jitter is damped; a deliberate reach follows promptly.
  const motion = Math.min(1, Math.max(0, (distance - 0.012) / 0.065));
  const timeConstant = 95 - 69 * motion;
  const alpha = 1 - Math.exp(-elapsed / timeConstant);
  const step = Math.min(distance * alpha, 0.18 * Math.max(0.7, Math.min(1.4, elapsed / 40)));
  if (distance > 0) {
    state.x += (rawX - state.x) / distance * step;
    state.y += (rawY - state.y) / distance * step;
  }
  state.lastAt = now;
  return { x: state.x, y: state.y, alpha };
}
