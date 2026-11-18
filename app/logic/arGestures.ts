export type ArLandmark = { x: number; y: number; z?: number };
export type ArPinchState = { armed: boolean; candidate: "open" | "closed" | null; since: number; lastStep: number };
export const newArPinchState = (): ArPinchState => ({ armed: false, candidate: null, since: 0, lastStep: -Infinity });

// MediaPipe assumes mirrored input. We feed the raw, unmirrored camera frame.
// https://chuoling.github.io/mediapipe/solutions/hands.html#multi_handedness
export function physicalHand(label: string): "Left" | "Right" | null {
  return label === "Right" ? "Left" : label === "Left" ? "Right" : null;
}

export function pinchRatio(points: ArLandmark[]) {
  const distance = (a: number, b: number) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
  return distance(4, 8) / Math.max(.001, distance(5, 17));
}

export function palmOpenness(points: ArLandmark[]) {
  const distance = (a: number, b: number) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
  return [8, 12, 16, 20].reduce((sum, tip) => sum + distance(tip, 0), 0) / (4 * Math.max(.001, distance(9, 0)));
}

export function advanceOpenPalm(state: ArPinchState, openness: number | null, enabled: boolean, now: number) {
  // Reuse the timed edge detector with folded fingers as the rearming gesture.
  const signal = openness === null ? null : openness < 1.3 ? .7 : openness > 1.7 ? .1 : .35;
  return advanceArPinch(state, signal, enabled, now);
}

export function newPalmStage() { return { level: 0, candidate: 0, since: 0 }; }
export function updatePalmStage(state: ReturnType<typeof newPalmStage>, openness: number | null, now: number) {
  if (openness === null || !Number.isFinite(openness)) { state.candidate = state.level; state.since = now; return state.level; }
  const thresholds = [1.3, 1.65, 2];
  let next = state.level;
  while (next < 3 && openness > thresholds[next] + .06) next++;
  while (next > 0 && openness < thresholds[next - 1] - .06) next--;
  if (next !== state.candidate) { state.candidate = next; state.since = now; }
  if (now - state.since >= 160) state.level = next;
  return state.level;
}

// Require a deliberate release before each press; missing hands never count as release.
export function advanceArPinch(state: ArPinchState, ratio: number | null, leftVisible: boolean, now: number) {
  if (!leftVisible || ratio === null) {
    state.armed = false;
    state.candidate = null;
    return false;
  }
  const candidate = ratio > .48 ? "open" : ratio < .27 ? "closed" : null;
  if (candidate !== state.candidate) { state.candidate = candidate; state.since = now; }
  if (candidate === "open") {
    if (now - state.since >= 120) state.armed = true;
    return false;
  }
  if (candidate !== "closed" || !state.armed || now - state.since < 120) return false;
  state.armed = false;
  if (now - state.lastStep < 650) return false;
  state.lastStep = now;
  return true;
}
