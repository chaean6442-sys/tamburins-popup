export type DesktopPinchState = {
  pinch: boolean;
  pinchFrames: number;
  releaseFrames: number;
};

export function advanceDesktopPinch(state: DesktopPinchState, ratio: number) {
  state.pinchFrames = ratio < 0.42 ? Math.min(2, state.pinchFrames + 1) : 0;
  state.releaseFrames = ratio > 0.64 ? Math.min(2, state.releaseFrames + 1) : 0;
  const started = !state.pinch && state.pinchFrames === 2;
  const ended = state.pinch && state.releaseFrames === 2;
  if (started) {
    state.pinch = true;
    state.releaseFrames = 0;
  }
  if (ended) {
    state.pinch = false;
    state.pinchFrames = 0;
  }
  return { started, ended, openReady: !state.pinch && state.releaseFrames === 2 };
}
