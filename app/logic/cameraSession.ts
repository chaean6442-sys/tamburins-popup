// Serialize camera requests, including ones still waiting for browser permission.
// An abandoned screen must never retain a stream or stop the next screen's stream.
export function createCameraManager(open: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
  let queue: Promise<unknown> = Promise.resolve();
  let active: { stop: () => void } | null = null;
  return () => {
    let closed = false;
    let stream: MediaStream | null = null;
    const session = {
      stop() {
        closed = true;
        stream?.getTracks().forEach(track => track.stop());
        stream = null;
        if (active === session) active = null;
      },
      open(constraints: MediaStreamConstraints): Promise<MediaStream | null> {
        const request = queue.then(async () => {
          if (closed) return null;
          active?.stop();
          for (let attempt = 0; attempt < 2; attempt++) {
            if (closed) return null;
            try { stream = await open(constraints); break; }
            catch (error) {
              if (closed) return null;
              if (attempt || !(error instanceof Error) || !["NotReadableError", "AbortError"].includes(error.name)) throw error;
              await new Promise(resolve => setTimeout(resolve, 550));
            }
          }
          if (closed) { stream?.getTracks().forEach(track => track.stop()); stream = null; return null; }
          active = session;
          return stream;
        });
        queue = request.catch(() => {});
        return request;
      },
    };
    return session;
  };
}

export async function openPhysicalCamera(
  constraints: MediaStreamConstraints,
  devices: Pick<MediaDevices, "getUserMedia" | "enumerateDevices"> = navigator.mediaDevices,
) {
  const video = typeof constraints.video === "object" ? constraints.video : {};
  // Keep explicit device selection and the phone's rear-camera requirement.
  if (video.deviceId || (typeof video.facingMode === "object" && video.facingMode)) {
    return devices.getUserMedia(constraints);
  }
  const tried = new Set<string>();
  const candidates = async () => (await devices.enumerateDevices().catch(() => []))
    .filter(device => device.kind === "videoinput" && device.deviceId && device.label
      && !/virtual|가상|obs|manycam|snap camera|xsplit/i.test(device.label))
    .sort((a, b) => Number(/integrated|built.?in|내장/i.test(b.label)) - Number(/integrated|built.?in|내장/i.test(a.label)));
  let lastError: unknown;
  const tryPhysical = async () => {
    for (const device of await candidates()) {
      if (tried.has(device.deviceId)) continue;
      tried.add(device.deviceId);
      try { return await devices.getUserMedia({ ...constraints, video: { ...video, deviceId: { exact: device.deviceId } } }); }
      catch (error) {
        if (!(error instanceof Error) || !["NotReadableError", "NotFoundError", "OverconstrainedError", "AbortError"].includes(error.name)) throw error;
        lastError = error;
      }
    }
    return null;
  };
  const physical = await tryPhysical();
  if (physical) return physical;
  if (tried.size) throw lastError;
  try { return await devices.getUserMedia(constraints); }
  catch (error) {
    if (!(error instanceof Error) || !["NotReadableError", "NotFoundError", "AbortError"].includes(error.name)) throw error;
    // Labels can become available only after the first permission prompt.
    const fallback = await tryPhysical();
    if (fallback) return fallback;
    throw lastError ?? error;
  }
}

export const createCameraSession = createCameraManager(constraints => openPhysicalCamera(constraints));

export function cameraErrorMessage(error: unknown, facing: "user" | "environment" = "user") {
  if (error instanceof Error && error.name === "NotReadableError") return "카메라를 열지 못했습니다. 브라우저 카메라 설정에서 Integrated Camera 등 실제 카메라를 선택하고, 사용 중인 다른 앱을 닫은 뒤 재연결해주세요.";
  if (error instanceof Error && ["NotAllowedError", "SecurityError"].includes(error.name)) return "브라우저 주소창의 카메라 권한을 허용한 뒤 아래 버튼을 눌러 다시 연결해주세요.";
  if (error instanceof Error && ["AbortError", "NotFoundError", "OverconstrainedError"].includes(error.name)) return `${facing === "environment" ? "후면" : "전면"} 카메라를 찾지 못했습니다. 다른 앱의 카메라를 닫고 다시 연결해주세요.`;
  return error instanceof Error ? error.message : "카메라를 연결하지 못했습니다. 다시 연결해주세요.";
}
