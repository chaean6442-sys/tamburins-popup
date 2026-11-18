"use client";
import { Canvas, ThreeEvent, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Billboard, Environment, useTexture } from "@react-three/drei";
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import html2canvas from "html2canvas";
import QRCode from "qrcode";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { XRHandModelFactory } from "three/examples/jsm/webxr/XRHandModelFactory.js";
import { XR, XROrigin, createXRStore } from "@react-three/xr";
import {
  COLLECTIONS,
  ObjectId,
  VISUAL_OBJECTS,
  VisualObject,
} from "../data/experience";
import { createCameraSession, cameraErrorMessage } from "../logic/cameraSession";
import { optimizePbrForMobile } from "../logic/mobilePbr";
import { enhancePreparedObjectMaterials } from "../logic/objectPbr";
import { createHandCursorState, updateHandCursor } from "../logic/handCursor";
import { advanceDesktopPinch } from "../logic/desktopPinch";
import { localThrowTarget, throwFlightPoint } from "../logic/throwFlight";
import { balancedMaterialSplit, organicMaterialField } from "../logic/organicMaterialBlend";
import { assignDesktopHands, type DesktopHandTrack } from "../logic/desktopHands";
import { createTableHitGeometry } from "../logic/tableHit";
import { DesktopModelStage } from "./DesktopModelStage";
import { AntiWaterSurface } from "./AntiWaterSurface";
import { ArEvolution } from "./ArEvolution";
import { advanceOpenPalm, newArPinchState, physicalHand, palmOpenness, newPalmStage, updatePalmStage } from "../logic/arGestures";
import { scoreCollections } from "../logic/scoreCollections";
import MobileMuseJob, { type MusePhoneJob } from "../phone/MobileMuseJob";

type HandInput = {
  handedness: "Left" | "Right";
  x: number;
  y: number;
  px: number;
  py: number;
  grabX?: number;
  grabY?: number;
  vx: number;
  vy: number;
  pinch: boolean;
  armed: boolean;
  edgeOn: boolean;
  palmOpen?: boolean;
  palmX?: number;
  palmY?: number;
  present: boolean;
  grabbed: ObjectId | null;
  interaction: "object" | "clay" | "donut" | "ui" | null;
  pinchFrames: number;
  releaseFrames: number;
};
type HandsInput = [HandInput, HandInput];

function IdleVideoOverlay({ onDismiss }: { onDismiss: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [needsSoundTap, setNeedsSoundTap] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    const player = video.current;
    if (!player) return;
    const abort = new AbortController();
    let objectUrl = "";
    setLoadFailed(false);
    void Promise.all(["/videos/main-screen-1.bin", "/videos/main-screen-2.bin"].map(async (path) => {
      const response = await fetch(path, { signal: abort.signal });
      if (!response.ok) throw new Error(`video segment ${response.status}`);
      return response.blob();
    })).then((parts) => {
      if (abort.signal.aborted) return;
      // Each static asset stays below the host's file limit. Reassemble the
      // original MP4 byte-for-byte so its picture and soundtrack are intact.
      objectUrl = URL.createObjectURL(new Blob(parts, { type: "video/mp4" }));
      player.src = objectUrl;
      player.muted = false;
      void player.play().catch(() => {
        // Sound may be blocked before the first visitor gesture.
        player.muted = true;
        setNeedsSoundTap(true);
        void player.play().catch(() => setLoadFailed(true));
      });
    }).catch(() => { if (!abort.signal.aborted) setLoadFailed(true); });
    return () => {
      abort.abort();
      player.pause();
      player.removeAttribute("src");
      player.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [loadAttempt]);

  const enableSound = () => {
    const player = video.current;
    if (!player) return;
    player.muted = false;
    void player.play().then(() => setNeedsSoundTap(false)).catch(() => {
      player.muted = true;
      setNeedsSoundTap(true);
    });
  };

  return <section className="muse-idle-video" aria-label="Make Your MUSE 영상" onClick={onDismiss}>
    <video ref={video} playsInline loop preload="none" />
    {loadFailed && <button type="button" className="muse-idle-retry" onPointerDown={(event) => event.stopPropagation()} onPointerMove={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setLoadAttempt((attempt) => attempt + 1); }}>영상 다시 불러오기</button>}
    {needsSoundTap && <button type="button" className="muse-idle-sound" onPointerDown={(event) => event.stopPropagation()} onPointerMove={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); enableSound(); }}>소리 켜기</button>}
    <span className="muse-idle-dismiss">화면을 클릭하면 인터랙티브 체험이 시작됩니다</span>
  </section>;
}
type SaveDirectoryHandle = {
  name: string;
  queryPermission?: (options: { mode: "readwrite" }) => Promise<"granted" | "denied" | "prompt">;
  requestPermission?: (options: { mode: "readwrite" }) => Promise<"granted" | "denied" | "prompt">;
  getFileHandle: (name: string, options: { create: boolean }) => Promise<{
    createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
  }>;
};
type PaintImpact = {
  key: string;
  id: ObjectId;
  normal: [number, number, number];
  scale: number;
  rotation: number;
};
const CLAY_CENTER = new THREE.Vector3(0, 0.87, 0);
const OBJECT_RING_RADIUS = 1.345;
const OBJECT_RING_DEPTH_RADIUS = 0.875;
const OBJECT_RING_FRONT_INSET = 0.06;
const OBJECT_RING_BACK_OFFSET = 0.05;
const OBJECT_RING_CENTER_X = 0.035;
const OBJECT_PREVIEW_SCALE = 0.121;
const OBJECT_GLASS_HEIGHT = 0.078;
const OBJECT_ALPHA_BOTTOM: Record<ObjectId, number> = {
  branch: .931, chrome: .936, cloud: .790, cocoon: .784, crystal: .936,
  fabric: .783, feather: .907, flower: .867, fruit: .900, ice: .860,
  leaf: .863, light: .881, lily: .802, metal: .845, moss: .758,
  mushroom: .913, ribbon: .751, rose: .862, sand: .743, stone: .802,
  water: .761, wood: .719,
};
const objectPreviewHeight = (id: ObjectId) =>
  OBJECT_GLASS_HEIGHT + (OBJECT_ALPHA_BOTTOM[id] - .5) * 1.9 * OBJECT_PREVIEW_SCALE + .002;
const ringDepth = (angle: number) => {
  const sine = Math.sin(angle);
  return sine * (OBJECT_RING_DEPTH_RADIUS - OBJECT_RING_FRONT_INSET * Math.max(0, sine));
};
type OrbitArc = { aspect: number; lengths: Float32Array; total: number };
let orbitArcCache: OrbitArc | null = null;
function getOrbitArc(aspect: number): OrbitArc {
  if (orbitArcCache && Math.abs(orbitArcCache.aspect - aspect) < .002) return orbitArcCache;
  // Space objects by distance on the glass, not by the camera's projected distance.
  const horizontalFit = Math.min(1, Math.pow(aspect / (16 / 9), .65));
  const steps = 1024;
  const lengths = new Float32Array(steps + 1);
  let previousX = 0;
  let previousZ = 0;
  for (let i = 0; i <= steps; i += 1) {
    const angle = i / steps * Math.PI * 2;
    const x = Math.cos(angle) * OBJECT_RING_RADIUS * horizontalFit;
    const z = ringDepth(angle);
    if (i) lengths[i] = lengths[i - 1] + Math.hypot(x - previousX, z - previousZ);
    previousX = x;
    previousZ = z;
  }
  orbitArcCache = { aspect, lengths, total: lengths[steps] };
  return orbitArcCache;
}
function objectRingAngle(index: number, turn: number, aspect: number) {
  const arc = getOrbitArc(aspect);
  const progress = ((index / VISUAL_OBJECTS.length + turn / (Math.PI * 2)) % 1 + 1) % 1;
  const distance = progress * arc.total;
  let low = 0;
  let high = arc.lengths.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (arc.lengths[middle] < distance) low = middle;
    else high = middle;
  }
  const segment = arc.lengths[high] - arc.lengths[low];
  return (low + (segment ? (distance - arc.lengths[low]) / segment : 0)) / (arc.lengths.length - 1) * Math.PI * 2;
}
const objectOrbitPosition = (index: number, turn: number, height: number, out = new THREE.Vector3()) => {
  const aspect = typeof window === "undefined" ? 16 / 9 : window.innerWidth / Math.max(1, window.innerHeight);
  const angle = objectRingAngle(index, turn, aspect);
  const horizontalFit = Math.min(1, Math.pow(aspect / (16 / 9), 0.65));
  const x = Math.cos(angle) * OBJECT_RING_RADIUS * horizontalFit;
  const z = ringDepth(angle) - OBJECT_RING_BACK_OFFSET;
  const cosine = Math.cos(turn);
  const sine = Math.sin(turn);
  return out.set(cosine * x - sine * z + OBJECT_RING_CENTER_X, height, sine * x + cosine * z);
};
const DISPLAY_FOCUS_Y = 0.43;
const displayFocusForWidth = (_width: number) => new THREE.Vector3(0, DISPLAY_FOCUS_Y, CLAY_CENTER.z);
const CLAY_WORLD_RADIUS = 1.45 * 0.45;
class AlwaysVisiblePointerMaterial extends THREE.MeshBasicMaterial {
  constructor() {
    super({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  }
}
const xrStore = createXRStore({
  offerSession: false,
  enterGrantedSession: false,
  hand: {
    rayPointer: {
      rayModel: { color: "#77a7ff", opacity: 0.82, maxLength: 8, size: 0.0045, renderOrder: 9998, materialClass: AlwaysVisiblePointerMaterial },
      cursorModel: { color: "#5b95ff", opacity: 1, size: 0.085, renderOrder: 9999, materialClass: AlwaysVisiblePointerMaterial },
    },
  },
  controller: {
    rayPointer: {
      rayModel: { color: "#77a7ff", opacity: 0.82, maxLength: 8, size: 0.0045, renderOrder: 9998, materialClass: AlwaysVisiblePointerMaterial },
      cursorModel: { color: "#5b95ff", opacity: 1, size: 0.085, renderOrder: 9999, materialClass: AlwaysVisiblePointerMaterial },
    },
  },
  customSessionInit: {
    optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
  },
});
const makeHand = (handedness: "Left" | "Right"): HandInput => ({
  handedness,
  x: 0,
  y: 0,
  px: 0,
  py: 0,
  vx: 0,
  vy: 0,
  pinch: false,
  armed: false,
  edgeOn: false,
  present: false,
  grabbed: null,
  interaction: null,
  pinchFrames: 0,
  releaseFrames: 0,
});

function HandCamera({ handsInput, onStatus, onActivity }: {
  handsInput: React.MutableRefObject<HandsInput>;
  onStatus?: (status: "loading" | "live" | "detected" | "error") => void;
  onActivity?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const markers = useRef<Array<HTMLElement | null>>([]);
  const lastActivityHand = useRef<Array<{ x: number; y: number; pinch: boolean; open: boolean } | null>>([null, null]);
  const stream = useRef<MediaStream | null>(null);
  const detector = useRef<any>(null);
  const running = useRef(false);
  const starting = useRef(false);
  const cameraRun = useRef(0);
  const session = useRef<ReturnType<typeof createCameraSession> | null>(null);
  const [detectedHands, setDetectedHands] = useState(0);
  const [errorDetail, setErrorDetail] = useState("");
  const [cameraConnected, setCameraConnected] = useState(false);
  const [status, setStatus] = useState<"off" | "loading" | "live" | "error">(
    "off",
  );
  const start = async () => {
    if (starting.current || running.current) return;
    const run = ++cameraRun.current;
    session.current?.stop();
    const lease = createCameraSession();
    session.current = lease;
    void Promise.resolve(detector.current?.close?.()).catch(() => {});
    detector.current = null;
    setCameraConnected(false);
    starting.current = true;
    setErrorDetail("");
    setStatus("loading");
    onStatus?.("loading");
    let cameraReady = false;
    try {
      // Ask for camera access before loading the tracking runtime. Keeping
      // getUserMedia at the very beginning preserves the user's click gesture
      // and makes Chrome show its native permission prompt reliably.
      const camera = await lease.open({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (!camera || run !== cameraRun.current) return;
      stream.current = camera;
      const v = video.current;
      if (!v) throw new Error("camera unavailable");
      v.srcObject = camera;
      await v.play();
      if (run !== cameraRun.current) return;
      cameraReady = true;
      setCameraConnected(true);
      setStatus("live");
      onStatus?.("live");
      const load = (src: string) =>
        new Promise<void>((resolve, reject) => {
          const found = document.querySelector(
            `script[src="${src}"]`,
          ) as HTMLScriptElement | null;
          if (found) {
            if ((window as any).Hands) return resolve();
            found.addEventListener("load", () => resolve(), { once: true });
            return;
          }
          const s = document.createElement("script");
          s.src = src;
          s.crossOrigin = "anonymous";
          s.onload = () => resolve();
          s.onerror = () => reject(new Error("hand tracking load failed"));
          document.head.appendChild(s);
        });
      await load(
        "/mediapipe/hands/hands.js",
      );
      if (run !== cameraRun.current) return;
      const hands = new (window as any).Hands({
        locateFile: (f: string) =>
          `/mediapipe/hands/${f}`,
      });
      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 0,
        minDetectionConfidence: 0.65,
        minTrackingConfidence: 0.55,
      });
      const trackingCanvas = document.createElement("canvas");
      trackingCanvas.width = 480;
      trackingCanvas.height = 360;
      const trackingContext = trackingCanvas.getContext("2d", { alpha: false });
      const lastSeen = [0, 0];
      const cursorState = [createHandCursorState(), createHandCursorState()];
      const tracks: [DesktopHandTrack, DesktopHandTrack] = [
        { x: 0, y: 0, lastAt: 0 }, { x: 0, y: 0, lastAt: 0 },
      ];
      hands.onResults((res: any) => {
        if (run !== cameraRun.current) return;
        const now = performance.now();
        const detected = assignDesktopHands(
          (res.multiHandLandmarks ?? []).map((landmarks: any[], index: number) => ({
            landmarks,
            label: physicalHand(res.multiHandedness?.[index]?.label) ?? "Left",
            confidence: res.multiHandedness?.[index]?.score ?? 0,
          })),
          tracks,
          now,
        );
        setDetectedHands(detected.length);
        if (detected.length) onStatus?.("detected");
        const seen = [false, false];
        detected.forEach(({ hand, slot, center }) => {
          const lm = hand.landmarks;
          tracks[slot] = { ...center, lastAt: now };
          const h = handsInput.current[slot];
          const wasPresent = h.present;
          lastSeen[slot] = now;
          seen[slot] = true;
          h.px = h.x;
          h.py = h.y;
          // Point at the actual pinch position (midpoint of thumb/index tips),
          // not the palm center. This keeps grabbing aligned with what the
          // user is visibly touching in the camera preview.
          const pinchX = (lm[4].x + lm[8].x) * 0.5;
          const pinchY = (lm[4].y + lm[8].y) * 0.5;
          // The preview is mirrored, so mirror landmark X exactly once here.
          const targetX = (1 - pinchX) * 2 - 1;
          const targetY = -(pinchY * 2 - 1);
          const distance2D = (a: number, b: number) => Math.hypot(
            lm[a].x - lm[b].x,
            lm[a].y - lm[b].y,
          );
          // A turned palm looks artificially narrow in 2D. Keep the scale
          // anchored to palm length so a real pinch does not register as open.
          const palmWidth2D = Math.max(0.001, distance2D(5, 17), distance2D(0, 9) * 0.65);
          const pinchRatio = distance2D(4, 8) / palmWidth2D;
          // Follow the thumb/index midpoint throughout the gesture. A separate
          // press snapshot below holds the click target without freezing drag.
          const filtered = updateHandCursor(cursorState[slot], targetX, targetY, now);
          h.x = filtered.x;
          h.y = filtered.y;
          h.vx = THREE.MathUtils.lerp(h.vx, h.x - h.px, 0.42);
          h.vy = THREE.MathUtils.lerp(h.vy, h.y - h.py, 0.42);
          const distance3D = (a: number, b: number) => Math.hypot(
            lm[a].x - lm[b].x,
            lm[a].y - lm[b].y,
            (lm[a].z ?? 0) - (lm[b].z ?? 0),
          );
          const palmLength = Math.max(0.001, distance3D(0, 9));
          const fingers = [[8, 6, 5], [12, 10, 9], [16, 14, 13], [20, 18, 17]];
          const extended = fingers.filter(([tip, pip, mcp]) =>
            distance3D(tip, 0) > distance3D(pip, 0) + palmLength * 0.18 && distance3D(tip, mcp) > palmLength * 0.72,
          ).length;
          // Grabbing is controlled only by thumb-to-index contact. Normalizing
          // against palm length keeps the gesture stable as the hand moves
          // toward or away from the camera.
          // Separate grab/release thresholds and require two observations.
          const gesture = advanceDesktopPinch(h, pinchRatio);
          if (gesture.started) {
            // Use the fingertip location at the confirmed grab, not the first
            // tentative frame while the hand is still travelling.
            h.grabX = h.x;
            h.grabY = h.y;
            const clientX = (((h.grabX ?? h.x) + 1) * 0.5) * window.innerWidth;
            const clientY = ((1 - (h.grabY ?? h.y)) * 0.5) * window.innerHeight;
            const pointed = document.elementFromPoint(clientX, clientY);
            const control = pointed?.closest("button, a, [role='button']") as HTMLElement | null;
            const disabled = control instanceof HTMLButtonElement && control.disabled;
            if (control && !disabled && control.getAttribute("aria-disabled") !== "true") {
              h.interaction = "ui";
              control.click();
            }
          }
          if (gesture.openReady) {
            if (h.interaction === "ui") h.interaction = null;
            if (!h.interaction) h.armed = true;
          }
          const palmWidth = distance3D(5, 17);
          const palmPoints = [0, 5, 9, 13, 17];
          const palmX = (1 - palmPoints.reduce((sum, i) => sum + lm[i].x, 0) / 5) * 2 - 1;
          const palmY = 1 - palmPoints.reduce((sum, i) => sum + lm[i].y, 0) / 5 * 2;
          h.palmX = wasPresent ? THREE.MathUtils.lerp(h.palmX ?? palmX, palmX, filtered.alpha) : palmX;
          h.palmY = wasPresent ? THREE.MathUtils.lerp(h.palmY ?? palmY, palmY, filtered.alpha) : palmY;
          h.palmOpen = extended >= 3 && !h.pinch;
          h.edgeOn = palmWidth / palmLength < 0.52 && extended >= 2;
          h.present = true;
          const previousActivity = lastActivityHand.current[slot];
          if (!previousActivity || Math.hypot(h.x - previousActivity.x, h.y - previousActivity.y) > .045 || previousActivity.pinch !== h.pinch || previousActivity.open !== h.palmOpen) {
            onActivity?.();
            lastActivityHand.current[slot] = { x: h.x, y: h.y, pinch: h.pinch, open: h.palmOpen };
          }
          const marker = markers.current[slot];
          if (marker) {
            marker.style.opacity = "1";
            marker.style.left = `${(h.x + 1) * 50}%`;
            marker.style.top = `${(1 - h.y) * 50}%`;
            marker.classList.toggle("fist", h.pinch);
            marker.classList.toggle("edge", h.edgeOn && !h.pinch);
          }
        });
        handsInput.current.forEach((h, slot) => {
          if (seen[slot]) return;
          h.vx = 0; h.vy = 0;
          h.pinchFrames = 0; h.releaseFrames = 0;
          const marker = markers.current[slot];
          if (marker) marker.style.opacity = "0";
          // A brief missed detection must not drop or throw the held object.
          h.px = h.x; h.py = h.y;
          if (h.present && now - lastSeen[slot] < 420) return;
          h.present = false;
          cursorState[slot].active = false;
          lastActivityHand.current[slot] = null;
          h.pinchFrames = 0;
          h.releaseFrames = 0;
          h.pinch = false;
        });
      });
      detector.current = hands;
      running.current = true;
      let processing = false;
      let lastSentAt = 0;
      let lastVideoTime = -1;
      const tick = async () => {
        if (!running.current || run !== cameraRun.current) return;
        const now = performance.now();
        if (!processing && v.readyState >= 2 && now - lastSentAt >= 40 && v.currentTime !== lastVideoTime) {
          processing = true;
          lastSentAt = now;
          lastVideoTime = v.currentTime;
          try {
            if (trackingContext) {
              trackingContext.drawImage(v, 0, 0, trackingCanvas.width, trackingCanvas.height);
            }
            await hands.send({ image: trackingContext ? trackingCanvas : v });
          } catch {
            // A single MediaPipe frame failure must not stop hand tracking.
          } finally {
            processing = false;
          }
        }
        requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      if (run !== cameraRun.current) return;
      console.error(e);
      starting.current = false;
      const detail = cameraErrorMessage(e);
      setErrorDetail(detail);
      if (cameraReady) {
        // Keep showing a working camera even if the hand model fails to load.
        setStatus("live");
        onStatus?.("live");
      } else {
        setStatus("error");
        onStatus?.("error");
      }
    }
  };
  useEffect(() => {
    void start();
    const suspend = () => {
      cameraRun.current++;
      running.current = false;
      starting.current = false;
      session.current?.stop();
      stream.current = null;
      void Promise.resolve(detector.current?.close?.()).catch(() => {});
      detector.current = null;
      if (video.current) video.current.srcObject = null;
      handsInput.current.forEach(hand => { hand.present = false; hand.pinch = false; });
    };
    const visibility = () => {
      if (document.hidden) suspend();
      else void start();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", suspend);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", suspend);
      suspend();
    };
  }, []);
  return (
    <div className={`hand-camera ${status}`}>
      <video ref={video} muted playsInline />
      <span className={`hand-camera-state ${detectedHands ? "detected" : ""}`}>
        {errorDetail
          ? cameraConnected
            ? "HAND TRACKING ERROR"
            : "CAMERA ERROR"
          : status === "live"
          ? detectedHands
            ? `HANDS DETECTED ${detectedHands}`
            : "CAMERA LIVE · SHOW YOUR HANDS"
          : status === "loading"
            ? "CONNECTING CAMERA…"
            : status === "error"
              ? "CAMERA ERROR"
              : "CAMERA OFF"}
      </span>
      {errorDetail && <small className="hand-camera-error-detail">{errorDetail}</small>}
      <button
        onClick={start}
        disabled={status === "loading" || (status === "live" && !errorDetail)}
      >
        {errorDetail
          ? "RETRY CAMERA / HAND TRACKING"
          : status === "live"
          ? "HAND CAMERA LIVE"
          : status === "loading"
            ? "CONNECTING…"
            : status === "error"
              ? "RETRY HAND CAMERA"
              : "ENABLE HAND CAMERA"}
      </button>
      {status === "live" && handsInput.current.map((handState, index) => (
        <i
          key={handState.handedness}
          ref={(node) => { markers.current[index] = node; }}
          data-hand={handState.handedness === "Left" ? "L" : "R"}
        />
      ))}
    </div>
  );
}

function HandTrackingShell({ children, handsInput, cameraSessionKey, onStatus, onActivity }: {
  children: ReactNode;
  handsInput: React.MutableRefObject<HandsInput>;
  cameraSessionKey: number;
  onStatus: (status: "loading" | "live" | "detected" | "error") => void;
  onActivity?: () => void;
}) {
  return (
    <>
      {children}
      <HandCamera key={cameraSessionKey} handsInput={handsInput} onStatus={onStatus} onActivity={onActivity} />
    </>
  );
}

function Walker() {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const d = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      keys.current[e.code] = true;
    };
    const u = (e: KeyboardEvent) => (keys.current[e.code] = false);
    addEventListener("keydown", d);
    addEventListener("keyup", u);
    return () => {
      removeEventListener("keydown", d);
      removeEventListener("keyup", u);
    };
  }, []);
  useFrame((_, dt) => {
    if (gl.xr.isPresenting) return;
    const speed = (keys.current.ShiftLeft ? 6.5 : 3.7) * dt;
    const f = new THREE.Vector3();
    camera.getWorldDirection(f);
    f.y = 0;
    f.normalize();
    const r = new THREE.Vector3().crossVectors(f, camera.up).normalize();
    if (keys.current.KeyW) camera.position.addScaledVector(f, speed);
    if (keys.current.KeyS) camera.position.addScaledVector(f, -speed);
    if (keys.current.KeyA) camera.position.addScaledVector(r, -speed);
    if (keys.current.KeyD) camera.position.addScaledVector(r, speed);
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -3.7, 3.7);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -3.7, 3.7);
    camera.position.y = 1.6;
  });
  return null;
}

function KeepClayCentered({ phase }: { phase: "sculpt" | "mix" }) {
  const { camera, gl, size } = useThree();
  useEffect(() => {
    if (!gl.xr.isPresenting) camera.lookAt(displayFocusForWidth(size.width));
  }, [camera, gl, phase, size.width]);
  return null;
}

function VRSessionButton({ onPresenting }: { onPresenting: (value: boolean) => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const started = () => onPresenting(true);
    const ended = () => onPresenting(false);
    gl.xr.addEventListener("sessionstart", started);
    gl.xr.addEventListener("sessionend", ended);
    return () => {
      gl.xr.removeEventListener("sessionstart", started);
      gl.xr.removeEventListener("sessionend", ended);
    };
  }, [gl, onPresenting]);
  return null;
}

function VRHandBridge({
  handsInput,
  onAdvance,
  experienceStarted,
}: {
  handsInput: React.MutableRefObject<HandsInput>;
  onAdvance: () => void;
  experienceStarted: boolean;
}) {
  const { gl, camera, scene } = useThree();
  const rig = useRef<THREE.Group | null>(null);
  const xrHands = useRef<THREE.Group[]>([]);
  const xrControllers = useRef<THREE.Group[]>([]);
  const handedSlots = useRef<[number, number]>([0, 1]);
  const advanceHold = useRef(0);
  const advanceLatched = useRef(false);
  useEffect(() => {
    const player = new THREE.Group();
    player.name = "TAMBURINS_VR_RIG";
    scene.add(player);
    player.add(camera);
    rig.current = player;
    const sessionStarted = () => {
      player.position.set(0, 0, 0);
    };
    const sessionEnded = () => {
      player.position.set(0, 0, 0);
    };
    gl.xr.addEventListener("sessionstart", sessionStarted);
    gl.xr.addEventListener("sessionend", sessionEnded);
    const cleanups: Array<() => void> = [];
    xrHands.current = [0, 1].map((index) => {
      const xrHand = gl.xr.getHand(index);
      const handModel = new XRHandModelFactory().createHandModel(xrHand, "boxes");
      xrHand.add(handModel);
      player.add(xrHand);
      const connected = (event: any) => {
        const slot = event.data?.handedness === "left" ? 0 : 1;
        handedSlots.current[index] = slot;
        handsInput.current[slot].present = true;
      };
      const disconnected = () => {
        const hand = handsInput.current[handedSlots.current[index]];
        hand.present = false; hand.pinch = false; hand.interaction = null;
      };
      const pinchStart = () => {
        const hand = handsInput.current[handedSlots.current[index]];
        hand.present = true; hand.armed = true; hand.pinch = true;
      };
      const pinchEnd = () => { handsInput.current[handedSlots.current[index]].pinch = false; };
      xrHand.addEventListener("connected", connected);
      xrHand.addEventListener("disconnected", disconnected);
      xrHand.addEventListener("pinchstart", pinchStart);
      xrHand.addEventListener("pinchend", pinchEnd);
      cleanups.push(() => {
        xrHand.removeEventListener("connected", connected);
        xrHand.removeEventListener("disconnected", disconnected);
        xrHand.removeEventListener("pinchstart", pinchStart);
        xrHand.removeEventListener("pinchend", pinchEnd);
        xrHand.remove(handModel);
      });
      return xrHand;
    });
    xrControllers.current = [0, 1].map((index) => {
      const controller = gl.xr.getController(index);
      player.add(controller);
      const connected = (event: any) => {
        controller.userData.connected = true;
        handedSlots.current[index] = event.data?.handedness === "left" ? 0 : 1;
      };
      const disconnected = () => { controller.userData.connected = false; };
      const selectStart = () => {
        const hand = handsInput.current[handedSlots.current[index]];
        hand.present = true; hand.armed = true; hand.pinch = true;
      };
      const selectEnd = () => { handsInput.current[handedSlots.current[index]].pinch = false; };
      controller.addEventListener("connected", connected);
      controller.addEventListener("disconnected", disconnected);
      controller.addEventListener("selectstart", selectStart);
      controller.addEventListener("selectend", selectEnd);
      cleanups.push(() => {
        controller.removeEventListener("connected", connected);
        controller.removeEventListener("disconnected", disconnected);
        controller.removeEventListener("selectstart", selectStart);
        controller.removeEventListener("selectend", selectEnd);
      });
      return controller;
    });
    if (gl.xr.isPresenting) sessionStarted();
    return () => {
      sessionEnded();
      cleanups.forEach((cleanup) => cleanup());
      gl.xr.removeEventListener("sessionstart", sessionStarted);
      gl.xr.removeEventListener("sessionend", sessionEnded);
      scene.add(camera);
      scene.remove(player);
      xrHands.current = [];
      xrControllers.current = [];
      rig.current = null;
    };
  }, [camera, experienceStarted, gl, handsInput, onAdvance, scene]);
  useFrame((_, dt) => {
    if (!gl.xr.isPresenting) return;
    xrHands.current.forEach((xrHand, index) => {
      const hand = handsInput.current[handedSlots.current[index]];
      const joints = (xrHand as any).joints as Record<string, THREE.Object3D> | undefined;
      const tip = joints?.["index-finger-tip"];
      const controller = xrControllers.current[index];
      if (!tip && !controller?.userData.connected) { hand.present = false; return; }
      hand.present = true;
      const worldPoint = tip
        ? tip.getWorldPosition(new THREE.Vector3())
        : new THREE.Vector3(0, 0, -2.2).applyMatrix4(controller.matrixWorld);
      const point = worldPoint.project(gl.xr.getCamera(camera));
      hand.px = hand.x; hand.py = hand.y; hand.x = point.x; hand.y = point.y;
      hand.vx = THREE.MathUtils.lerp(hand.vx, hand.x - hand.px, 0.55);
      hand.vy = THREE.MathUtils.lerp(hand.vy, hand.y - hand.py, 0.55);
    });
    const canAdvance = handsInput.current.every((hand) => hand.present && hand.pinch && !hand.interaction);
    if (canAdvance) {
      advanceHold.current += dt;
      if (advanceHold.current > 1.1 && !advanceLatched.current) {
        advanceLatched.current = true;
        onAdvance();
      }
    } else {
      advanceHold.current = 0;
      advanceLatched.current = false;
    }
  });
  return null;
}

function HandSwipeOrbit({ hand }: { hand: React.MutableRefObject<HandInput> }) {
  const momentum = useRef(0);
  useFrame(({ camera }) => {
    const h = hand.current;
    const dx = h.x - h.px;
    const dy = h.y - h.py;
    if (h.present && !h.edgeOn && !h.pinch) {
      momentum.current = 0;
      return;
    }
    if (h.present && h.edgeOn && !h.pinch && Math.abs(dx) > 0.008 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      momentum.current = THREE.MathUtils.clamp(momentum.current - dx * 2.6, -0.075, 0.075);
    }
    if (Math.abs(momentum.current) < 0.0001) return;
    const target = displayFocusForWidth(window.innerWidth);
    const offset = camera.position.clone().sub(target).applyAxisAngle(new THREE.Vector3(0, 1, 0), momentum.current);
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
    momentum.current *= 0.9;
  });
  return null;
}

function Room() {
  return (
    <>
      <fog attach="fog" args={["#4d4841", 12, 30]} />
      <Suspense fallback={null}>
        <Environment files="/environments/muse-studio.hdr" environmentIntensity={1} />
      </Suspense>
    </>
  );
}

function Shape({ item }: { item: VisualObject }) {
  const texture = useTexture(`/objects/${item.id}.png?v=20261014c`);
  texture.colorSpace = THREE.SRGBColorSpace;
  return (
    <group>
      <Billboard follow lockX={false} lockY={false} lockZ={false}>
        <mesh position={[0, 0, 0.01]}>
          <planeGeometry args={[1.9, 1.9]} />
          <meshBasicMaterial map={texture} transparent alphaTest={0.05} toneMapped={false} />
        </mesh>
      </Billboard>
    </group>
  );
}

let glassShadowMap: THREE.CanvasTexture | null = null;
function getGlassShadowMap() {
  if (glassShadowMap) return glassShadowMap;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, "rgba(0,0,0,0.62)");
  gradient.addColorStop(0.42, "rgba(0,0,0,0.27)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  glassShadowMap = new THREE.CanvasTexture(canvas);
  return glassShadowMap;
}

function GlassContact({ item, index }: { item: VisualObject; index: number }) {
  const contact = useRef<THREE.Group>(null);
  const texture = useTexture(`/objects/${item.id}.png?v=20261014c`);
  const shadow = useMemo(getGlassShadowMap, []);
  texture.colorSpace = THREE.SRGBColorSpace;
  useFrame(() => {
    if (!contact.current) return;
    objectOrbitPosition(index, contact.current.parent?.rotation.y ?? 0, OBJECT_GLASS_HEIGHT, contact.current.position);
  });
  return (
    <group ref={contact} position={objectOrbitPosition(index, 0, OBJECT_GLASS_HEIGHT)} scale={OBJECT_PREVIEW_SCALE / 0.105}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
        <planeGeometry args={[0.34, 0.25]} />
        <meshBasicMaterial map={shadow} transparent opacity={0.64} depthWrite={false} depthTest toneMapped={false} />
      </mesh>
      <mesh position={[0.025, 0.002, 0.045]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <planeGeometry args={[0.23, 0.18]} />
        <meshBasicMaterial map={texture} color="#d0d3d0" transparent opacity={0.17} alphaTest={0.01} depthWrite={false} depthTest toneMapped={false} />
      </mesh>
    </group>
  );
}

function TurningGlass({ handsInput, enabled, target }: {
  handsInput: React.MutableRefObject<HandsInput>;
  enabled: boolean;
  target: React.RefObject<THREE.Group | null>;
}) {
  const surface = useRef<THREE.Mesh>(null);
  const handActive = useRef<number | null>(null);
  const lastHandX = useRef(0);
  const pointerActive = useRef(false);
  const lastPointerX = useRef(0);
  // The opening in this screen-space mesh leaves the empty center untouched.
  const hitGeometry = useMemo(createTableHitGeometry, []);
  useFrame(({ camera, scene, size }) => {
    if (!enabled || !surface.current || !(camera instanceof THREE.PerspectiveCamera)) return;
    const distance = 10;
    const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2);
    surface.current.scale.set(viewHeight * size.width / size.height, viewHeight, 1);
    surface.current.position.copy(camera.position).add(new THREE.Vector3(0, 0, -distance).applyQuaternion(camera.quaternion));
    surface.current.quaternion.copy(camera.quaternion);
    if (handActive.current === null) {
      for (let index = 0; index < handsInput.current.length; index += 1) {
        const h = handsInput.current[index];
        if (!h.present || !h.pinch || !h.armed || h.interaction) continue;
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(h.x, h.y), camera);
        const tableHit = ray.intersectObject(surface.current)[0];
        if (!tableHit) continue;
        const foreground: THREE.Object3D[] = [];
        scene.traverseVisible((node) => {
          if (node.userData.objectPickup || node.userData.clayPickup) foreground.push(node);
        });
        if (ray.intersectObjects(foreground, false).some((hit) => hit.distance < tableHit.distance)) continue;
        handActive.current = index;
        lastHandX.current = h.x;
        h.armed = false;
        h.interaction = "donut";
        break;
      }
    }
    if (handActive.current === null) return;
    const hand = handsInput.current[handActive.current];
    if (!hand.pinch) {
      hand.interaction = null;
      handActive.current = null;
      return;
    }
    if (target.current) target.current.rotation.y -= (hand.x - lastHandX.current) * 2.7;
    lastHandX.current = hand.x;
  });
  return (
    <mesh
      ref={surface}
      geometry={hitGeometry}
      visible={enabled}
      onPointerDown={(event) => {
        if (!enabled) return;
        if (event.intersections.some((hit) => {
          let node: THREE.Object3D | null = hit.object;
          let pickup = false;
          while (node) {
            if (!node.visible) return false;
            if (node.userData.objectPickup || node.userData.clayPickup) pickup = true;
            node = node.parent;
          }
          return pickup;
        })) return;
        event.stopPropagation();
        pointerActive.current = true;
        lastPointerX.current = event.clientX;
        event.target.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!pointerActive.current || !enabled) return;
        event.stopPropagation();
        if (target.current) target.current.rotation.y -= (event.clientX - lastPointerX.current) * 0.006;
        lastPointerX.current = event.clientX;
      }}
      onPointerUp={(event) => {
        pointerActive.current = false;
        event.target.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={(event) => {
        pointerActive.current = false;
        event.target.releasePointerCapture(event.pointerId);
      }}
    >
      <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function ClayTurnSync({ table, children }: {
  table: React.RefObject<THREE.Group | null>;
  children: ReactNode;
}) {
  const clayTurn = useRef<THREE.Group>(null);
  useFrame(() => {
    if (clayTurn.current) clayTurn.current.rotation.y = -2 * (table.current?.rotation.y ?? 0);
  });
  return <group ref={clayTurn}>{children}</group>;
}

function ThrowableObject({
  item,
  index,
  onGrab,
  onMixed,
  handsInput,
  enabled,
  visible,
}: {
  item: VisualObject;
  index: number;
  onGrab: (id: ObjectId) => void;
  onMixed: (id: ObjectId, normal: [number, number, number]) => void;
  handsInput: React.MutableRefObject<HandsInput>;
  enabled: boolean;
  visible: boolean;
}) {
  const mesh = useRef<THREE.Group>(null);
  const grabbed = useRef(false);
  const handGrab = useRef<number | null>(null);
  const flying = useRef(false);
  const flightTime = useRef(0);
  const flight = useRef({ from: new THREE.Vector3(), to: new THREE.Vector3(), duration: .3 });
  const xrHoldPosition = useRef<THREE.Vector3 | null>(null);
  const handThrow = useRef({ startX: 0, startY: 0, peakSpeed: 0 });
  const pointerDrag = useRef({ startX: 0, startY: 0, lastX: 0, lastY: 0, lastAt: 0, vx: 0, vy: 0, peakSpeed: 0 });
  const start = useMemo(
    () => objectOrbitPosition(index, 0, objectPreviewHeight(item.id)),
    [index, item.id],
  );
  const launch = (current: THREE.Group, target: THREE.Vector3, speed: number) => {
    flight.current.from.copy(current.position);
    flight.current.to.copy(target);
    flight.current.duration = THREE.MathUtils.clamp(current.position.distanceTo(target) / speed, .18, .42);
    flightTime.current = 0;
    flying.current = true;
  };
  useFrame(({ camera }, dt) => {
    const m = mesh.current;
    if (!m) return;
    objectOrbitPosition(index, m.parent?.rotation.y ?? 0, objectPreviewHeight(item.id), start);
    if (!grabbed.current && !flying.current) m.position.copy(start);
    if (!enabled) return;
    if (!grabbed.current) {
      const projected = m.getWorldPosition(new THREE.Vector3()).project(camera);
      for (let handIndex = 0; handIndex < handsInput.current.length; handIndex += 1) {
        const h = handsInput.current[handIndex];
        if (!h.present || !h.pinch || !h.armed || h.interaction || h.grabbed !== null) continue;
        const grabX = h.grabX ?? h.x;
        const grabY = h.grabY ?? h.y;
        const screenDistance = Math.hypot(projected.x - grabX, projected.y - grabY);
        if (screenDistance > 0.14) continue;
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(grabX, grabY), camera);
        const exactHit = ray.intersectObject(m, true)[0];
        if (!exactHit) continue;
        grabbed.current = true;
        handGrab.current = handIndex;
        flying.current = false;
        h.armed = false;
        h.grabbed = item.id;
        h.interaction = "object";
        handThrow.current = { startX: h.x, startY: h.y, peakSpeed: 0 };
        onGrab(item.id);
        break;
      }
    }
    const activeHand = handGrab.current === null ? null : handsInput.current[handGrab.current];
    if (grabbed.current && activeHand) {
      const speed = Math.hypot(activeHand.vx, activeHand.vy);
      handThrow.current.peakSpeed = Math.max(handThrow.current.peakSpeed, speed);
    }
    if (activeHand && !activeHand.pinch) {
      const h = activeHand;
      grabbed.current = false;
      handGrab.current = null;
      h.grabbed = null;
      h.interaction = null;
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(h.x, h.y), camera);
      const worldCenter = m.parent?.localToWorld(CLAY_CENTER.clone()) ?? CLAY_CENTER.clone();
      const claySphere = new THREE.Sphere(worldCenter, CLAY_WORLD_RADIUS * 1.15);
      let clayAim = ray.ray.intersectSphere(claySphere, new THREE.Vector3());
      const dx = h.x - handThrow.current.startX;
      const dy = h.y - handThrow.current.startY;
      const travel = Math.hypot(dx, dy);
      const wasThrown = travel >= .065 && handThrow.current.peakSpeed >= .007;
      // A release on the way to the sculpture still counts as a throw.
      if (!clayAim && wasThrown) {
        const projected = worldCenter.clone().project(camera);
        const toward = dx * (projected.x - handThrow.current.startX) + dy * (projected.y - handThrow.current.startY);
        const centerDistance = Math.hypot(projected.x - handThrow.current.startX, projected.y - handThrow.current.startY);
        if (toward > travel * centerDistance * .55) {
          ray.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
          clayAim = ray.ray.intersectSphere(claySphere, new THREE.Vector3());
        }
      }
      if (!clayAim || !wasThrown) {
        flying.current = false;
        m.position.copy(start);
        return;
      }
      const localAim = localThrowTarget(m.parent, clayAim);
      launch(m, localAim, 8 + handThrow.current.peakSpeed * 85);
    }
    m.rotation.y += dt * (grabbed.current ? 1.8 : 0.25);
    if (grabbed.current) {
      if (handGrab.current === null && xrHoldPosition.current) {
        const localHold = xrHoldPosition.current.clone();
        m.parent?.worldToLocal(localHold);
        m.position.lerp(localHold, Math.min(1, dt * 30));
        return;
      }
      const h = handGrab.current === null ? null : handsInput.current[handGrab.current];
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          h ? h.x : 0,
          h ? h.y : 0,
        ),
        camera,
      );
      const handTarget = ray.ray.origin.clone().add(ray.ray.direction.multiplyScalar(2.4));
      m.parent?.worldToLocal(handTarget);
      m.position.lerp(handTarget, Math.min(1, dt * 18));
      return;
    }
    if (flying.current) {
      flightTime.current += dt;
      const progress = Math.min(1, flightTime.current / flight.current.duration);
      throwFlightPoint(flight.current.from, flight.current.to, progress, m.position);
      if (progress >= 1) {
        flying.current = false;
        const surfaceNormal = flight.current.to.clone().sub(CLAY_CENTER).normalize();
        onMixed(item.id, surfaceNormal.toArray() as [number, number, number]);
        m.position.copy(start);
      }
    }
  });
  return (
    <group
      ref={mesh}
      position={start}
      scale={OBJECT_PREVIEW_SCALE}
      visible={visible}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        if (!enabled) return;
        e.stopPropagation();
        grabbed.current = true;
        flying.current = false;
        xrHoldPosition.current = e.ray.origin.clone().addScaledVector(e.ray.direction, 2.4);
        pointerDrag.current = {
          startX: e.clientX,
          startY: e.clientY,
          lastX: e.clientX,
          lastY: e.clientY,
          lastAt: performance.now(),
          vx: 0,
          vy: 0,
          peakSpeed: 0,
        };
        onGrab(item.id);
        e.target.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        if (!grabbed.current || handGrab.current !== null) return;
        xrHoldPosition.current = e.ray.origin.clone().addScaledVector(e.ray.direction, 2.4);
        const now = performance.now();
        const drag = pointerDrag.current;
        const dt = Math.max(8, now - drag.lastAt);
        const dx = e.clientX - drag.lastX;
        const dy = e.clientY - drag.lastY;
        drag.vx = THREE.MathUtils.lerp(drag.vx, dx / dt, 0.55);
        drag.vy = THREE.MathUtils.lerp(drag.vy, dy / dt, 0.55);
        drag.peakSpeed = Math.max(drag.peakSpeed, Math.hypot(dx / dt, dy / dt));
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        drag.lastAt = now;
      }}
      onPointerUp={(e: ThreeEvent<PointerEvent>) => {
        if (!enabled) return;
        if (!grabbed.current || handGrab.current !== null) return;
        e.stopPropagation();
        grabbed.current = false;
        xrHoldPosition.current = null;
        const current = mesh.current;
        const worldCenter = current?.parent?.localToWorld(CLAY_CENTER.clone()) ?? CLAY_CENTER.clone();
        const claySphere = new THREE.Sphere(worldCenter, CLAY_WORLD_RADIUS * 1.18);
        let worldHit = e.ray.intersectSphere(claySphere, new THREE.Vector3());
        const pointerTravel = Math.hypot(e.clientX - pointerDrag.current.startX, e.clientY - pointerDrag.current.startY);
        const wasThrown = pointerTravel >= 36 && pointerDrag.current.peakSpeed >= .065;
        if (!worldHit && wasThrown) {
          const camera = e.camera;
          const center = worldCenter.clone().project(camera);
          const startX = pointerDrag.current.startX / window.innerWidth * 2 - 1;
          const startY = 1 - pointerDrag.current.startY / window.innerHeight * 2;
          const dx = (e.clientX - pointerDrag.current.startX) / window.innerWidth * 2;
          const dy = -(e.clientY - pointerDrag.current.startY) / window.innerHeight * 2;
          const toward = dx * (center.x - startX) + dy * (center.y - startY);
          if (toward > Math.hypot(dx, dy) * Math.hypot(center.x - startX, center.y - startY) * .55) {
            const aimRay = new THREE.Raycaster();
            aimRay.setFromCamera(new THREE.Vector2(center.x, center.y), camera);
            worldHit = aimRay.ray.intersectSphere(claySphere, new THREE.Vector3());
          }
        }
        if (current && worldHit && wasThrown) {
          const localHit = localThrowTarget(current.parent, worldHit);
          launch(current, localHit, 9 + pointerDrag.current.peakSpeed * 20);
        } else {
          flying.current = false;
          current?.position.copy(start);
        }
        e.target.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={(e: ThreeEvent<PointerEvent>) => {
        if (handGrab.current !== null) return;
        grabbed.current = false;
        flying.current = false;
        xrHoldPosition.current = null;
        mesh.current?.position.copy(start);
        e.target.releasePointerCapture(e.pointerId);
      }}
    >
      <mesh userData={{ objectPickup: item.id }}>
        <sphereGeometry args={[2.2, 12, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Shape item={item} />
    </group>
  );
}

const BODY_MATERIAL_IDS = new Set<ObjectId>([
  "cloud", "metal", "sand", "stone", "light", "ice", "chrome", "moss", "wood", "cocoon", "water",
]);

type ObjectModelUrls = Partial<Record<ObjectId, string>>;
const objectModelCache = new Map<ObjectId, string>();
const objectModelRequests = new Map<ObjectId, Promise<string | null>>();

async function ensureObjectModel(id: ObjectId) {
  if (objectModelCache.has(id)) return objectModelCache.get(id)!;
  const pending = objectModelRequests.get(id);
  if (pending) return pending;
  const request = (async () => {
    try {
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const response = await fetch(`/api/object-models/${id}`, { cache: "no-store" });
        if (!response.ok) return null;
        const data = await response.json() as { status?: string; modelUrl?: string };
        if (data.status === "ready" && data.modelUrl) {
          objectModelCache.set(id, data.modelUrl);
          // Decode the GLB while the visitor is still choosing objects so the
          // growth can appear immediately after a successful throw.
          useLoader.preload(GLTFLoader, data.modelUrl, (loader) => loader.setMeshoptDecoder(MeshoptDecoder));
          return data.modelUrl;
        }
        if (data.status === "error" || data.status === "missing") return null;
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }
    } catch { /* The exhibition uses only operator-prepared GLB assets. */ }
    return null;
  })();
  objectModelRequests.set(id, request);
  return request.finally(() => objectModelRequests.delete(id));
}

function useObjectModelUrls(ids: ObjectId[]) {
  const preparedIds = ids.filter((id) => !BODY_MATERIAL_IDS.has(id));
  const key = [...new Set(preparedIds)].sort().join("|");
  const [urls, setUrls] = useState<ObjectModelUrls>(() => Object.fromEntries(preparedIds.flatMap((id) => {
    const url = objectModelCache.get(id);
    return url ? [[id, url]] : [];
  })) as ObjectModelUrls);
  useEffect(() => {
    const unique = [...new Set(preparedIds)];
    let cancelled = false;
    setUrls(Object.fromEntries(unique.flatMap((id) => {
      const url = objectModelCache.get(id);
      return url ? [[id, url]] : [];
    })) as ObjectModelUrls);
    unique.forEach((id) => {
      void ensureObjectModel(id).then((url) => {
        if (!cancelled && url) setUrls((current) => ({ ...current, [id]: url }));
      });
    });
    return () => { cancelled = true; };
  }, [key]);
  return urls;
}

function SurfaceObjectModel({ id, url, variationScale, rotation }: { id: ObjectId; url: string; variationScale: number; rotation: number }) {
  const gltf = useLoader(GLTFLoader, url, (loader) => loader.setMeshoptDecoder(MeshoptDecoder));
  const normalized = useMemo(() => {
    const clone = enhancePreparedObjectMaterials(optimizePbrForMobile(gltf.scene.clone(true)), id);
    const bounds = new THREE.Box3().setFromObject(clone);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    clone.position.sub(center);
    const root = new THREE.Group();
    root.add(clone);
    root.scale.setScalar(.48 / Math.max(size.x, size.y, size.z, .001));
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return root;
  }, [gltf.scene, id]);
  return <group rotation={[Math.PI / 2, 0, rotation]} scale={variationScale}><primitive object={normalized} /></group>;
}

function SurfaceObjectAsset({ item, modelUrl, variationScale, rotation }: {
  item: VisualObject;
  modelUrl?: string;
  variationScale: number;
  rotation: number;
}) {
  if (!modelUrl) return null;
  return <Suspense fallback={null}>
    <SurfaceObjectModel id={item.id} url={modelUrl} variationScale={variationScale} rotation={rotation} />
  </Suspense>;
}

const ORGANIC_IDS = new Set<ObjectId>(["moss", "flower", "leaf", "wood", "branch", "stone", "mushroom", "fruit", "lily", "rose"]);
const PHOTO_BASE_RATIO = 0.1;
const PHOTO_PLANE_SCALE = 5.35;

function PhotoCompositeCore({
  impacts,
  shapePoints,
  redrawRef,
  generatedImage,
}: {
  impacts: PaintImpact[];
  shapePoints: React.MutableRefObject<Array<{ x: number; y: number }>>;
  redrawRef: React.MutableRefObject<(() => void) | null>;
  generatedImage: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const revealRef = useRef<Map<string, number>>(new Map());
  const impactsRef = useRef(impacts);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !texture) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const size = canvas.width;
    const center = size / 2;
    // Keep a wide transparent margin around the clay so long pulls never hit a square texture edge.
    const baseRadius = size * PHOTO_BASE_RATIO;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    const outline = shapePoints.current.map((point) => ({
      x: center + point.x * baseRadius,
      y: center + point.y * baseRadius,
    }));
    const shapeBounds = outline.reduce(
      (bounds, point) => ({
        minX: Math.min(bounds.minX, point.x),
        maxX: Math.max(bounds.maxX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxY: Math.max(bounds.maxY, point.y),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    );
    const shapeCenterX = (shapeBounds.minX + shapeBounds.maxX) * 0.5;
    const shapeCenterY = (shapeBounds.minY + shapeBounds.maxY) * 0.5;
    const shapeRadius = Math.max(
      baseRadius,
      (shapeBounds.maxX - shapeBounds.minX) * 0.5,
      (shapeBounds.maxY - shapeBounds.minY) * 0.5,
    );
    const boundaryPoint = (directionX: number, directionY: number, distance = 1) => {
      const directionLength = Math.hypot(directionX, directionY) || 1;
      const dx = directionX / directionLength;
      const dy = directionY / directionLength;
      const point = outline.reduce((best, candidate) => {
        const candidateScore = (candidate.x - center) * dx + (candidate.y - center) * dy;
        const bestScore = (best.x - center) * dx + (best.y - center) * dy;
        return candidateScore > bestScore ? candidate : best;
      }, outline[0]);
      return {
        x: center + (point.x - center) * distance,
        y: center + (point.y - center) * distance,
      };
    };
    const first = outline[0];
    const lastPoint = outline[outline.length - 1];
    ctx.beginPath();
    ctx.moveTo((lastPoint.x + first.x) / 2, (lastPoint.y + first.y) / 2);
    outline.forEach((point, index) => {
      const next = outline[(index + 1) % outline.length];
      ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
    });
    ctx.closePath();
    ctx.shadowColor = "rgba(25,20,14,.34)";
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 18;
    const clay = ctx.createRadialGradient(
      shapeCenterX - shapeRadius * 0.34,
      shapeCenterY - shapeRadius * 0.4,
      shapeRadius * 0.04,
      shapeCenterX + shapeRadius * 0.12,
      shapeCenterY + shapeRadius * 0.14,
      shapeRadius * 1.35,
    );
    clay.addColorStop(0, "#ffffff");
    clay.addColorStop(0.42, "#f7f7f5");
    clay.addColorStop(0.76, "#dedfdf");
    clay.addColorStop(1, "#8f9193");
    ctx.fillStyle = clay;
    ctx.fill();
    ctx.shadowColor = "transparent";
    const rim = ctx.createLinearGradient(shapeBounds.minX, shapeCenterY, shapeBounds.maxX, shapeCenterY);
    rim.addColorStop(0, "rgba(255,255,255,.96)");
    rim.addColorStop(0.48, "rgba(255,255,255,.18)");
    rim.addColorStop(1, "rgba(75,78,81,.5)");
    ctx.strokeStyle = rim;
    ctx.lineWidth = 18;
    ctx.stroke();
    ctx.clip();

    const currentImpacts = impactsRef.current;
    const activeIds = new Set(currentImpacts.map((impact) => impact.id));
    const revealFor = (id: ObjectId) => Math.max(
      0,
      ...currentImpacts.filter((impact) => impact.id === id).map((impact) => revealRef.current.get(impact.key) ?? 0),
    );
    const mossCount = currentImpacts.filter((impact) => impact.id === "moss").length;
    const ecosystem = imagesRef.current.get("material-moss");
    if (ecosystem && activeIds.has("moss")) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.96, (0.66 + mossCount * 0.05) * revealFor("moss"));
      ctx.drawImage(
        ecosystem,
        shapeBounds.minX - shapeRadius * 0.08,
        shapeBounds.minY - shapeRadius * 0.08,
        shapeBounds.maxX - shapeBounds.minX + shapeRadius * 0.16,
        shapeBounds.maxY - shapeBounds.minY + shapeRadius * 0.16,
      );
      ctx.restore();
    }
    const metalMaterial = imagesRef.current.get("material-metal");
    const metalReveal = Math.max(revealFor("metal"), revealFor("chrome"), revealFor("crystal"));
    if (metalMaterial && metalReveal > 0) {
      ctx.save();
      ctx.globalAlpha = 0.88 * metalReveal;
      ctx.globalCompositeOperation = "source-atop";
      ctx.drawImage(
        metalMaterial,
        shapeBounds.minX - shapeRadius * 0.08,
        shapeBounds.minY - shapeRadius * 0.08,
        shapeBounds.maxX - shapeBounds.minX + shapeRadius * 0.16,
        shapeBounds.maxY - shapeBounds.minY + shapeRadius * 0.16,
      );
      ctx.restore();
    }
    currentImpacts.forEach((impact, index) => {
      if (["moss", "flower", "water", "metal", "chrome", "crystal"].includes(impact.id)) return;
      const image = imagesRef.current.get(impact.id);
      if (!image) return;
      const reveal = revealRef.current.get(impact.key) ?? 0;
      if (reveal <= 0) return;
      const normal = impact.normal;
      const seed = [...impact.key].reduce((sum, char) => sum + char.charCodeAt(0), 0);
      const attachment = boundaryPoint(normal[0], -normal[1], 0.72);
      const x = attachment.x;
      const y = attachment.y;
      const imageSize = (impact.id === "moss" || impact.id === "cloud" ? 360 : 285) * reveal;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(((seed % 19) - 9) * 0.035);
      ctx.globalAlpha = Math.min(1, reveal * 1.25);
      if (impact.id === "water" || impact.id === "light") ctx.globalCompositeOperation = "screen";
      else if (impact.id === "metal" || impact.id === "chrome") ctx.globalCompositeOperation = "source-over";
      else ctx.globalCompositeOperation = index % 2 ? "source-over" : "multiply";
      ctx.drawImage(image, -imageSize / 2, -imageSize / 2, imageSize, imageSize);
      ctx.restore();
    });

    // Populate the full sculpted surface, including its visual center. The previous
    // impact-only placement followed outward normals and left large stretched forms hollow.
    [...activeIds].forEach((id, objectIndex) => {
      if (id === "water" || id === "light") return;
      const image = imagesRef.current.get(id);
      const reveal = revealFor(id);
      if (!image || reveal <= 0) return;
      const stampCount = ORGANIC_IDS.has(id) ? 11 : 9;
      for (let index = 0; index < stampCount; index += 1) {
        const radius = index === 0 ? 0 : Math.sqrt(index / (stampCount - 1)) * 0.68;
        const angle = index * 2.3999632297 + objectIndex * 0.83;
        const x = shapeCenterX + Math.cos(angle) * (shapeBounds.maxX - shapeBounds.minX) * 0.5 * radius;
        const y = shapeCenterY + Math.sin(angle) * (shapeBounds.maxY - shapeBounds.minY) * 0.5 * radius;
        const stampSize = shapeRadius * (0.28 + (index % 3) * 0.055);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle * 0.17);
        ctx.globalAlpha = Math.min(0.9, reveal * (id === "cloud" || id === "fabric" ? 0.56 : 0.72));
        ctx.globalCompositeOperation = id === "metal" || id === "chrome" || id === "crystal"
          ? "source-over"
          : "multiply";
        ctx.drawImage(image, -stampSize / 2, -stampSize / 2, stampSize, stampSize);
        ctx.restore();
      }
    });
    const generated = imagesRef.current.get("generated-world");
    if (generated) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(
        generated,
        shapeBounds.minX - shapeRadius * 0.08,
        shapeBounds.minY - shapeRadius * 0.08,
        shapeBounds.maxX - shapeBounds.minX + shapeRadius * 0.16,
        shapeBounds.maxY - shapeBounds.minY + shapeRadius * 0.16,
      );
      ctx.restore();
    }

    // Image-based volume: directional falloff, reflected lower light and a soft specular bloom.
    const volumeShade = ctx.createRadialGradient(
      shapeCenterX - shapeRadius * 0.32,
      shapeCenterY - shapeRadius * 0.38,
      shapeRadius * 0.12,
      shapeCenterX + shapeRadius * 0.12,
      shapeCenterY + shapeRadius * 0.08,
      shapeRadius * 1.42,
    );
    volumeShade.addColorStop(0, "rgba(255,255,255,.3)");
    volumeShade.addColorStop(0.52, "rgba(255,255,255,0)");
    volumeShade.addColorStop(0.82, "rgba(65,54,44,.12)");
    volumeShade.addColorStop(1, "rgba(32,27,22,.42)");
    ctx.fillStyle = volumeShade;
    ctx.fillRect(0, 0, size, size);
    const bounce = ctx.createLinearGradient(shapeCenterX, shapeCenterY, shapeCenterX, shapeBounds.maxY);
    bounce.addColorStop(0, "rgba(255,255,255,0)");
    bounce.addColorStop(0.72, "rgba(218,199,173,.04)");
    bounce.addColorStop(1, "rgba(255,238,210,.28)");
    ctx.fillStyle = bounce;
    ctx.fillRect(shapeBounds.minX, shapeCenterY, shapeBounds.maxX - shapeBounds.minX, shapeBounds.maxY - shapeCenterY);

    const sheen = ctx.createRadialGradient(
      shapeCenterX - shapeRadius * 0.34,
      shapeCenterY - shapeRadius * 0.38,
      5,
      shapeCenterX - shapeRadius * 0.22,
      shapeCenterY - shapeRadius * 0.25,
      shapeRadius * 0.72,
    );
    sheen.addColorStop(0, "rgba(255,255,255,.54)");
    sheen.addColorStop(0.5, "rgba(255,255,255,.08)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    const drawCutout = (
      id: ObjectId,
      angle: number,
      distance: number,
      imageSize: number,
      rotation: number,
      alpha = 1,
    ) => {
      const sourceId = id === "moss"
          ? "material-moss"
          : id === "water"
            ? "material-water"
            : id === "metal" || id === "chrome" || id === "crystal"
              ? "material-metal"
              : id;
      const image = imagesRef.current.get(sourceId);
      if (!image) return;
      const reveal = revealFor(id);
      if (reveal <= 0) return;
      const attachment = boundaryPoint(Math.cos(angle), Math.sin(angle), distance);
      const x = attachment.x;
      const y = attachment.y;
      const grownSize = imageSize * (0.45 + reveal * 0.55);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.globalAlpha = alpha * reveal;
      ctx.drawImage(image, -grownSize / 2, -grownSize / 2, grownSize, grownSize);
      ctx.restore();
    };

    // Object-specific states extend beyond the original circle so the whole form changes.
    if (activeIds.has("moss") && ecosystem) {
      for (let i = 0; i < 7; i += 1) drawCutout("moss", i * 0.898 + 0.2, 0.98, 62 + (i % 3) * 12, i * 0.31, 0.82);
    }
    if (activeIds.has("flower")) {
      for (let i = 0; i < 11; i += 1) drawCutout("flower", i * 0.571 + 0.12, 0.96, 54 + (i % 4) * 12, i * 0.42, 0.96);
    }
    (["leaf", "branch", "wood"] as ObjectId[]).forEach((id, groupIndex) => {
      if (!activeIds.has(id)) return;
      for (let i = 0; i < 6; i += 1) drawCutout(id, i * 1.047 + groupIndex * 0.34, 0.92 + (i % 2) * 0.18, 145 + (i % 3) * 24, i * 0.38, 0.88);
    });
    (["crystal", "metal", "chrome"] as ObjectId[]).forEach((id, groupIndex) => {
      if (!activeIds.has(id)) return;
      for (let i = 0; i < 5; i += 1) drawCutout(id, i * 1.257 + groupIndex * 0.27, 0.98, 58 + (i % 2) * 18, i * 0.56, 0.9);
    });
    (["mushroom", "fruit", "stone"] as ObjectId[]).forEach((id, groupIndex) => {
      if (!activeIds.has(id)) return;
      for (let i = 0; i < 6; i += 1) drawCutout(id, i * 1.047 + groupIndex * 0.41, 0.74 + (i % 3) * 0.17, 105 + (i % 3) * 20, i * 0.3, 0.94);
    });
    (["cloud", "fabric", "cocoon"] as ObjectId[]).forEach((id, groupIndex) => {
      if (!activeIds.has(id)) return;
      for (let i = 0; i < 7; i += 1) drawCutout(id, i * 0.898 + groupIndex * 0.29, 0.83 + (i % 2) * 0.2, 160 + (i % 3) * 26, i * 0.24, 0.72);
    });
    if (activeIds.has("light")) {
      const glowReveal = revealFor("light");
      const glow = ctx.createRadialGradient(
        shapeCenterX,
        shapeCenterY,
        shapeRadius * 0.18,
        shapeCenterX,
        shapeCenterY,
        shapeRadius * 1.35,
      );
      glow.addColorStop(0, `rgba(199,188,255,${0.34 * glowReveal})`);
      glow.addColorStop(0.65, `rgba(139,120,255,${0.12 * glowReveal})`);
      glow.addColorStop(1, "rgba(139,120,255,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);
    }
    if (activeIds.has("water")) {
      const waterReveal = revealFor("water");
      ctx.save();
      ctx.beginPath();
      ctx.moveTo((lastPoint.x + first.x) / 2, (lastPoint.y + first.y) / 2);
      outline.forEach((point, index) => {
        const next = outline[(index + 1) % outline.length];
        ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
      });
      ctx.closePath();
      const waterFill = ctx.createRadialGradient(
        shapeCenterX - shapeRadius * 0.36,
        shapeCenterY - shapeRadius * 0.44,
        10,
        shapeCenterX,
        shapeCenterY,
        shapeRadius * 1.3,
      );
      waterFill.addColorStop(0, `rgba(255,255,255,${0.22 * waterReveal})`);
      waterFill.addColorStop(0.58, `rgba(170,225,244,${0.055 * waterReveal})`);
      waterFill.addColorStop(0.9, `rgba(99,176,213,${0.16 * waterReveal})`);
      waterFill.addColorStop(1, `rgba(224,249,255,${0.34 * waterReveal})`);
      ctx.fillStyle = waterFill;
      ctx.fill();
      ctx.lineWidth = 13;
      ctx.strokeStyle = `rgba(214,246,255,${0.78 * waterReveal})`;
      ctx.shadowColor = `rgba(107,196,231,${0.7 * waterReveal})`;
      ctx.shadowBlur = 24;
      ctx.stroke();
      ctx.shadowColor = "transparent";
      ctx.lineWidth = 5;
      ctx.strokeStyle = `rgba(255,255,255,${0.86 * waterReveal})`;
      ctx.beginPath();
      const highlightStart = outline[Math.floor(outline.length * 0.58)];
      const highlightEnd = outline[Math.floor(outline.length * 0.82)];
      ctx.moveTo(highlightStart.x, highlightStart.y);
      ctx.quadraticCurveTo(
        shapeCenterX - shapeRadius * 0.72,
        shapeCenterY - shapeRadius * 0.72,
        highlightEnd.x,
        highlightEnd.y,
      );
      ctx.stroke();
      for (let i = 0; i < 15; i += 1) {
        const angle = i * 2.399;
        const distance = 90 + (i % 5) * 62;
        const bubbleSize = 5 + (i % 4) * 4;
        ctx.beginPath();
        const bubble = boundaryPoint(Math.cos(angle), Math.sin(angle), distance / baseRadius);
        ctx.arc(bubble.x, bubble.y, bubbleSize, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(238,253,255,${0.68 * waterReveal})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    }
    texture.needsUpdate = true;
  }, [shapePoints, texture]);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    // Keep the original object-detail scale while providing a much wider transparent
    // margin for unrestricted clay pulls in every direction.
    canvas.width = 3584;
    canvas.height = 3584;
    canvasRef.current = canvas;
    const nextTexture = new THREE.CanvasTexture(canvas);
    nextTexture.colorSpace = THREE.SRGBColorSpace;
    nextTexture.minFilter = THREE.LinearFilter;
    nextTexture.magFilter = THREE.LinearFilter;
    setTexture(nextTexture);
    return () => nextTexture.dispose();
  }, []);
  useEffect(() => {
    const sources: Array<[string, string]> = [
      ["material-moss", "/growth/materials/moss-photoreal.png"],
      ["material-flowers", "/growth/materials/flowers-photoreal.png"],
      ["material-water", "/growth/materials/water-shell-photoreal.png"],
      ["material-metal", "/growth/materials/metal-crystal-photoreal.png"],
      ...VISUAL_OBJECTS.map((item) => [item.id, `/objects/${item.id}.png?v=20261014c`] as [string, string]),
    ];
    let cancelled = false;
    Promise.all(sources.map(([id, src]) => new Promise<void>((resolve) => {
      const image = new Image();
      image.onload = () => { if (!cancelled) imagesRef.current.set(id, image); resolve(); };
      image.onerror = () => resolve();
      image.src = src;
    }))).then(() => { if (!cancelled) draw(); });
    return () => { cancelled = true; };
  }, [draw]);
  useEffect(() => {
    if (!generatedImage) {
      imagesRef.current.delete("generated-world");
      draw();
      return;
    }
    const image = new Image();
    image.onload = () => {
      imagesRef.current.set("generated-world", image);
      draw();
    };
    image.src = generatedImage;
  }, [generatedImage, draw]);
  useEffect(() => {
    impactsRef.current = impacts;
    impacts.forEach((impact) => {
      if (!revealRef.current.has(impact.key)) revealRef.current.set(impact.key, 0);
    });
    draw();
  }, [impacts, draw]);
  useEffect(() => {
    redrawRef.current = draw;
    draw();
    return () => { redrawRef.current = null; };
  }, [draw, redrawRef]);
  useFrame((_, delta) => {
    let animating = false;
    impactsRef.current.forEach((impact) => {
      const value = revealRef.current.get(impact.key) ?? 0;
      if (value < 1) {
        revealRef.current.set(impact.key, Math.min(1, value + delta * 2.4));
        animating = true;
      }
    });
    if (animating) draw();
  });
  if (!texture) return null;
  return (
    <Billboard position={CLAY_CENTER} follow lockX={false} lockY={false} lockZ={false}>
      <mesh scale={PHOTO_PLANE_SCALE} renderOrder={20}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={texture} transparent alphaTest={0.015} depthWrite={false} depthTest={false} toneMapped={false} />
      </mesh>
    </Billboard>
  );
}

type ClayBodyMaterial = {
  color: string;
  roughness: number;
  metalness: number;
  clearcoat: number;
  transmission: number;
  opacity: number;
  bumpScale: number;
};

const DEFAULT_CLAY_BODY_MATERIAL: ClayBodyMaterial = { color: "#e5ded2", roughness: .24, metalness: 0, clearcoat: .46, transmission: 0, opacity: 1, bumpScale: .012 };
const CLAY_BODY_MATERIALS: Partial<Record<ObjectId, ClayBodyMaterial>> = {
  cloud: { color: "#eee9df", roughness: .92, metalness: 0, clearcoat: .04, transmission: 0, opacity: 1, bumpScale: .018 },
  metal: { color: "#77736e", roughness: .16, metalness: .96, clearcoat: .72, transmission: 0, opacity: 1, bumpScale: .006 },
  sand: { color: "#c7ab82", roughness: 1, metalness: 0, clearcoat: 0, transmission: 0, opacity: 1, bumpScale: .034 },
  stone: { color: "#77736e", roughness: .86, metalness: .04, clearcoat: .05, transmission: 0, opacity: 1, bumpScale: .03 },
  light: { color: "#d7eaf3", roughness: .04, metalness: .03, clearcoat: 1, transmission: .72, opacity: .8, bumpScale: .002 },
  ice: { color: "#d8eef4", roughness: .08, metalness: .02, clearcoat: 1, transmission: .82, opacity: .74, bumpScale: .006 },
  chrome: { color: "#d9dce0", roughness: .035, metalness: .18, clearcoat: 1, transmission: .88, opacity: .72, bumpScale: .002 },
  moss: { color: "#687243", roughness: .96, metalness: 0, clearcoat: 0, transmission: 0, opacity: 1, bumpScale: .038 },
  wood: { color: "#57463b", roughness: .94, metalness: 0, clearcoat: 0, transmission: 0, opacity: 1, bumpScale: .028 },
  cocoon: { color: "#ece7dc", roughness: .72, metalness: .04, clearcoat: .28, transmission: .08, opacity: 1, bumpScale: .02 },
  water: { color: "#b7dce8", roughness: .025, metalness: 0, clearcoat: 1, transmission: .9, opacity: .68, bumpScale: .002 },
};

function mixClayBodyMaterial(a: ClayBodyMaterial, b: ClayBodyMaterial, amount: number): ClayBodyMaterial {
  const color = new THREE.Color(a.color).lerp(new THREE.Color(b.color), amount);
  const mix = (first: number, second: number) => THREE.MathUtils.lerp(first, second, amount);
  return {
    color: `#${color.getHexString()}`,
    roughness: mix(a.roughness, b.roughness),
    metalness: mix(a.metalness, b.metalness),
    clearcoat: mix(a.clearcoat, b.clearcoat),
    transmission: mix(a.transmission, b.transmission),
    opacity: mix(a.opacity, b.opacity),
    bumpScale: mix(a.bumpScale, b.bumpScale),
  };
}

function makeClayBodyMaterial(profile: ClayBodyMaterial, bumpMap: THREE.Texture | null) {
  const transparent = profile.opacity < .999 || profile.transmission > .01;
  return new THREE.MeshPhysicalMaterial({
    color: profile.color,
    bumpMap: bumpMap ?? null,
    bumpScale: profile.bumpScale,
    roughness: profile.roughness,
    metalness: profile.metalness,
    clearcoat: profile.clearcoat,
    clearcoatRoughness: .18,
    transmission: profile.transmission,
    thickness: profile.transmission ? 1.2 : 0,
    transparent,
    opacity: profile.opacity,
    depthWrite: !transparent,
    ior: 1.42,
    sheen: .1,
    sheenColor: new THREE.Color("#fff7e8"),
    sheenRoughness: .42,
    envMapIntensity: 1.18,
    side: THREE.DoubleSide,
  });
}

function Clay({
  changed,
  stretched,
  handsInput,
  mixed,
  impacts,
  enabled,
  generatedImage,
  silhouetteRef,
  objectModels,
}: {
  changed: () => void;
  stretched: () => void;
  handsInput: React.MutableRefObject<HandsInput>;
  mixed: ObjectId[];
  impacts: PaintImpact[];
  enabled: boolean;
  generatedImage: string | null;
  silhouetteRef: React.MutableRefObject<(() => string) | null>;
  objectModels: ObjectModelUrls;
}) {
  void generatedImage;
  const meshRef = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.58, 64, 48), []);
  const claySurfaceTexture = useMemo(() => {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const pixels = context.createImageData(size, size);
    let seed = 712367;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const grain = (random() - 0.5) * 30;
        const fiber = Math.sin(x * 0.31 + Math.sin(y * 0.08) * 2.4) * 4;
        const value = Math.round(132 + grain + fiber);
        const offset = (y * size + x) * 4;
        pixels.data[offset] = value;
        pixels.data[offset + 1] = value;
        pixels.data[offset + 2] = value;
        pixels.data[offset + 3] = 255;
      }
    }
    context.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4.5, 3.5);
    texture.anisotropy = 8;
    return texture;
  }, []);
  const pointerActive = useRef(false);
  type ClaySelection = {
    startX: number;
    startY: number;
    points: Array<{ index: number; start: THREE.Vector3; weight: number }>;
    displacement?: THREE.Vector3;
  };
  const pointerSelection = useRef<ClaySelection | null>(null);
  const handSelections = useRef<[ClaySelection | null, ClaySelection | null]>([null, null]);
  const palmPress = useRef({ dwell: 0, depth: 0 });
  useEffect(() => {
    if (enabled) return;
    pointerActive.current = false;
    pointerSelection.current = null;
    handSelections.current = [null, null];
    palmPress.current = { dwell: 0, depth: 0 };
    handsInput.current.forEach((hand) => {
      if (hand.interaction === "clay") hand.interaction = null;
      hand.armed = false;
    });
  }, [enabled, handsInput]);
  useEffect(() => {
    silhouetteRef.current = () => {
      // Each quadrant is 768 px so the generated image can read the visitor's
      // small pinches and stretched edges instead of a softened 512 px sketch.
      const size = 1536;
      const quadrant = size / 2;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) return "";
      // Give the image model an unambiguous high-contrast geometry blueprint.
      // The previous near-white mesh on transparency hid subtle sculpted bends.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size, size);
      const position = geometry.getAttribute("position") as THREE.BufferAttribute;
      const index = geometry.index;
      if (!index) return "";
      const vertices = Array.from({ length: position.count }, (_, i) => new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)));
      const extent = Math.max(0.75, ...vertices.map((v) => Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z))));
      const views = [
        (v: THREE.Vector3) => new THREE.Vector3(v.x, v.y, v.z),
        (v: THREE.Vector3) => new THREE.Vector3(v.z, v.y, -v.x),
        (v: THREE.Vector3) => new THREE.Vector3(-v.x, v.y, -v.z),
        (v: THREE.Vector3) => new THREE.Vector3(-v.z, v.y, v.x),
      ];
      views.forEach((project, viewIndex) => {
        const ox = (viewIndex % 2) * quadrant;
        const oy = Math.floor(viewIndex / 2) * quadrant;
        const projected = vertices.map(project);
        const triangles: Array<{ a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; depth: number; light: number }> = [];
        for (let i = 0; i < index.count; i += 3) {
          const a = projected[index.getX(i)];
          const b = projected[index.getX(i + 1)];
          const c = projected[index.getX(i + 2)];
          const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
          if (normal.z <= 0) continue;
          triangles.push({ a, b, c, depth: (a.z + b.z + c.z) / 3, light: THREE.MathUtils.clamp(0.56 + normal.dot(new THREE.Vector3(-0.35, 0.55, 0.75).normalize()) * 0.36, 0.2, 1) });
        }
        triangles.sort((one, two) => one.depth - two.depth);
        const scale = (quadrant * .4) / extent;
        triangles.forEach(({ a, b, c, light }) => {
          context.beginPath();
          context.moveTo(ox + quadrant / 2 + a.x * scale, oy + quadrant / 2 - a.y * scale);
          context.lineTo(ox + quadrant / 2 + b.x * scale, oy + quadrant / 2 - b.y * scale);
          context.lineTo(ox + quadrant / 2 + c.x * scale, oy + quadrant / 2 - c.y * scale);
          context.closePath();
          const shade = Math.round(142 + light * 76);
          context.fillStyle = `rgb(${shade},${shade},${Math.min(255, shade + 1)})`;
          context.fill();
        });
      });
      return canvas.toDataURL("image/png");
    };
    return () => { silhouetteRef.current = null; };
  }, [geometry, silhouetteRef]);
  useEffect(() => () => {
    geometry.dispose();
    claySurfaceTexture?.dispose();
  }, [claySurfaceTexture, geometry]);
  const createClaySelection = useCallback((anchor: THREE.Vector3, startX: number, startY: number): ClaySelection => {
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const anchorDirection = anchor.clone().normalize();
    const points: ClaySelection["points"] = [];
    for (let index = 0; index < position.count; index += 1) {
      const start = new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index));
      const angle = Math.acos(THREE.MathUtils.clamp(start.clone().normalize().dot(anchorDirection), -1, 1));
      if (angle < 0.88) points.push({ index, start, weight: Math.exp(-(angle * angle) / 0.16) });
    }
    return { startX, startY, points };
  }, [geometry]);
  const applyClaySelection = useCallback(
    (selection: ClaySelection, currentX: number, currentY: number, camera: THREE.Camera) => {
      const dx = currentX - selection.startX;
      const dy = currentY - selection.startY;
      if (Math.hypot(dx, dy) < 0.018) return;
      const mesh = meshRef.current;
      if (!mesh) return;
      const inverseWorldRotation = mesh.getWorldQuaternion(new THREE.Quaternion()).invert();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).applyQuaternion(inverseWorldRotation);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).applyQuaternion(inverseWorldRotation);
      const sculptStrength = 1.28;
      const displacement = right.multiplyScalar(dx * sculptStrength).add(up.multiplyScalar(dy * sculptStrength));
      const delta = displacement.clone().sub(selection.displacement ?? new THREE.Vector3());
      selection.displacement = displacement.clone();
      const position = geometry.getAttribute("position") as THREE.BufferAttribute;
      selection.points.forEach((entry) => {
        const point = new THREE.Vector3().fromBufferAttribute(position, entry.index).addScaledVector(delta, entry.weight);
        position.setXYZ(entry.index, point.x, point.y, point.z);
      });
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      if (Math.hypot(dx, dy) >= 0.045) stretched();
      changed();
    },
    [changed, geometry, stretched],
  );
  useFrame(({ camera }, delta) => {
    if (!enabled) return;
    const mesh = meshRef.current;
    if (!mesh) return;
    handsInput.current.forEach((h, handIndex) => {
      if (h.present && h.pinch && h.armed && !handSelections.current[handIndex] && !h.interaction) {
        const raycaster = new THREE.Raycaster();
        const grabX = h.grabX ?? h.x;
        const grabY = h.grabY ?? h.y;
        raycaster.setFromCamera(new THREE.Vector2(grabX, grabY), camera);
        const hit = raycaster.intersectObject(mesh, false)[0];
        if (hit) {
          const anchor = mesh.worldToLocal(hit.point.clone());
          h.armed = false;
          h.interaction = "clay";
          handSelections.current[handIndex] = createClaySelection(anchor, grabX, grabY);
        }
      }
      const selection = handSelections.current[handIndex];
      if (!selection) return;
      if (!h.present || !h.pinch) {
        handSelections.current[handIndex] = null;
        h.interaction = null;
        return;
      }
      applyClaySelection(selection, h.x, h.y, camera);
    });
    const left = handsInput.current.find(hand => hand.handedness === "Left");
    if (!left?.present || !left.palmOpen || left.pinch || (left.interaction && left.interaction !== "clay")) {
      palmPress.current = { dwell: 0, depth: 0 };
      if (left?.interaction === "clay") left.interaction = null;
      return;
    }
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(left.palmX ?? left.x, left.palmY ?? left.y), camera);
    const hit = ray.intersectObject(mesh, false)[0];
    if (!hit) {
      palmPress.current = { dwell: 0, depth: 0 };
      if (left.interaction === "clay") left.interaction = null;
      return;
    }
    left.interaction = "clay";
    const dt = Math.min(delta, .05);
    palmPress.current.dwell += dt;
    if (palmPress.current.dwell < .16 || palmPress.current.depth >= .25) return;
    const amount = Math.min(dt * .22, .25 - palmPress.current.depth);
    palmPress.current.depth += amount;
    const anchor = mesh.worldToLocal(hit.point.clone());
    const inward = (hit.face?.normal.clone() ?? anchor.clone().normalize()).negate();
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(position, i);
      const distance = point.distanceTo(anchor);
      if (distance > .38) continue;
      const weight = Math.pow(1 - (distance / .38) ** 2, 2);
      point.addScaledVector(inward, amount * weight);
      position.setXYZ(i, point.x, point.y, point.z);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    changed();
  });
  const bodyMaterials = useMemo(() => [...new Set(mixed)]
    .map((id) => CLAY_BODY_MATERIALS[id])
    .filter((profile): profile is ClayBodyMaterial => Boolean(profile)), [mixed]);
  const clayMaterial = useMemo(() => {
    const profiles = bodyMaterials.length ? bodyMaterials : [DEFAULT_CLAY_BODY_MATERIAL];
    const firstImpact = impacts.find((impact) => Boolean(CLAY_BODY_MATERIALS[impact.id]));
    const rotation = firstImpact
      ? new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...firstImpact.normal).normalize()).invert()
      : new THREE.Quaternion();
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colors: number[] = [];
    const physical: number[] = [];
    const opacities: number[] = [];
    const sources = profiles.map((profile) => new THREE.Color(profile.color));
    const patchFields = profiles.length === 2
      ? Array.from({ length: positions.count }, (_, index) => {
          const direction = new THREE.Vector3().fromBufferAttribute(positions, index).normalize().applyQuaternion(rotation);
          return organicMaterialField(direction.x, direction.y, direction.z);
        })
      : [];
    const patchSplit = balancedMaterialSplit(patchFields);
    for (let index = 0; index < positions.count; index += 1) {
      const direction = new THREE.Vector3().fromBufferAttribute(positions, index).normalize().applyQuaternion(rotation);
      // Warped 3D patches follow the sculpted surface without directional stripes.
      const weights = profiles.length === 1 ? [1] : profiles.length === 2
        ? [1 - THREE.MathUtils.smoothstep(patchFields[index], patchSplit - .075, patchSplit + .075),
          THREE.MathUtils.smoothstep(patchFields[index], patchSplit - .075, patchSplit + .075)]
        : profiles.map((_, materialIndex) => Math.exp(3 * (
            Math.sin(direction.x * 8.3 + direction.y * 6.1 + materialIndex * 2.4) * .55
            + Math.sin(direction.z * 10.7 - direction.x * 4.3 + materialIndex * 4.1) * .45
          )));
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const color = new THREE.Color(0, 0, 0);
      const mixedProfile = { roughness: 0, metalness: 0, transmission: 0, clearcoat: 0, opacity: 0 };
      profiles.forEach((profile, materialIndex) => {
        const weight = weights[materialIndex] / total;
        color.r += sources[materialIndex].r * weight;
        color.g += sources[materialIndex].g * weight;
        color.b += sources[materialIndex].b * weight;
        mixedProfile.roughness += profile.roughness * weight;
        mixedProfile.metalness += profile.metalness * weight;
        mixedProfile.transmission += profile.transmission * weight;
        mixedProfile.clearcoat += profile.clearcoat * weight;
        mixedProfile.opacity += profile.opacity * weight;
      });
      colors.push(color.r, color.g, color.b);
      physical.push(mixedProfile.roughness, mixedProfile.metalness, mixedProfile.transmission, mixedProfile.clearcoat);
      opacities.push(mixedProfile.opacity);
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute("musePhysical", new THREE.Float32BufferAttribute(physical, 4));
    geometry.setAttribute("museOpacity", new THREE.Float32BufferAttribute(opacities, 1));
    geometry.clearGroups();
    const transparent = profiles.some((profile) => profile.opacity < .999 || profile.transmission > .01);
    const material = makeClayBodyMaterial({
      ...DEFAULT_CLAY_BODY_MATERIAL,
      color: "#ffffff",
      bumpScale: profiles.reduce((sum, profile) => sum + profile.bumpScale, 0) / profiles.length,
      clearcoat: Math.max(...profiles.map((profile) => profile.clearcoat)),
      transmission: Math.max(...profiles.map((profile) => profile.transmission)),
    }, claySurfaceTexture);
    material.vertexColors = true;
    material.transparent = transparent;
    material.depthWrite = !transparent;
    // The studio HDR has a dark floor that otherwise reflects as blotchy
    // shadows on the sculpture, especially when a glass material is mixed in.
    material.envMapIntensity = transparent ? .42 : .28;
    material.emissive.set("#ffffff");
    material.emissiveIntensity = transparent ? .035 : .07;
    material.customProgramCacheKey = () => "muse-clay-organic-blend-v2";
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = `attribute vec4 musePhysical; attribute float museOpacity; varying vec4 vMusePhysical; varying float vMuseOpacity;\n${shader.vertexShader}`
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMusePhysical = musePhysical; vMuseOpacity = museOpacity;");
      shader.fragmentShader = `varying vec4 vMusePhysical; varying float vMuseOpacity;\n${shader.fragmentShader}`
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= vMuseOpacity;")
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = vMusePhysical.x;")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = vMusePhysical.y;")
        .replace("#include <lights_physical_fragment>", THREE.ShaderChunk.lights_physical_fragment.replace("material.clearcoat = clearcoat;", "material.clearcoat = vMusePhysical.w;"))
        .replace("#include <transmission_fragment>", THREE.ShaderChunk.transmission_fragment.replace("material.transmission = transmission;", "material.transmission = vMusePhysical.z;"));
    };
    return material;
  }, [bodyMaterials, claySurfaceTexture, geometry, impacts]);
  useEffect(() => () => clayMaterial.dispose(), [clayMaterial]);
  const attachedGrowth = impacts.filter((impact) => !BODY_MATERIAL_IDS.has(impact.id)).map((impact) => {
    const direction = new THREE.Vector3(...impact.normal).normalize();
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const normals = geometry.getAttribute("normal") as THREE.BufferAttribute;
    let surface = direction.clone().multiplyScalar(0.58);
    let bestDot = -Infinity;
    let bestIndex = 0;
    for (let index = 0; index < position.count; index += 1) {
      const vertex = new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index));
      const dot = vertex.clone().normalize().dot(direction);
      if (dot > bestDot) {
        bestDot = dot;
        surface = vertex;
        bestIndex = index;
      }
    }
    const surfaceNormal = new THREE.Vector3(
      normals.getX(bestIndex),
      normals.getY(bestIndex),
      normals.getZ(bestIndex),
    ).normalize();
    if (surfaceNormal.dot(direction) < 0) surfaceNormal.negate();
    const orientation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      surfaceNormal,
    );
    return {
      impact,
      orientation,
      surface: surface.addScaledVector(surfaceNormal, 0.025),
    };
  });
  return (
    <group position={CLAY_CENTER}>
        <mesh
          ref={meshRef}
          userData={{ clayPickup: true }}
          geometry={geometry}
          material={clayMaterial}
          castShadow
          receiveShadow={false}
          onPointerDown={(e: ThreeEvent<PointerEvent>) => {
            if (!enabled || !meshRef.current) return;
            e.stopPropagation();
            pointerSelection.current = createClaySelection(meshRef.current.worldToLocal(e.point.clone()), e.clientX * 0.0035, -e.clientY * 0.0035);
            pointerActive.current = true;
            e.target.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e: ThreeEvent<PointerEvent>) => {
            if (!pointerActive.current || !pointerSelection.current) return;
            applyClaySelection(pointerSelection.current, e.clientX * 0.0035, -e.clientY * 0.0035, e.camera);
          }}
          onPointerUp={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            pointerActive.current = false;
            pointerSelection.current = null;
          }}
          onPointerCancel={() => {
            pointerActive.current = false;
            pointerSelection.current = null;
          }}
        >
        </mesh>
        {attachedGrowth.map(({ impact, surface, orientation }) => {
          const item = VISUAL_OBJECTS.find((candidate) => candidate.id === impact.id);
          if (!item) return null;
          return (
            <group key={impact.key} position={surface} quaternion={orientation}>
              <SurfaceObjectAsset item={item} modelUrl={objectModels[impact.id]} variationScale={impact.scale} rotation={impact.rotation} />
            </group>
          );
        })}
    </group>
  );
}

function ResultPortal({ color, visible }: { color: string; visible: boolean }) {
  return (
    <group position={[0, 2.8, -10.35]} visible={visible}>
      <mesh>
        <circleGeometry args={[2.1, 64]} />
        <meshStandardMaterial color="#1d1e1a" />
      </mesh>
      <mesh position={[0, 0, 0.05]}>
        <torusGeometry args={[2.15, 0.14, 20, 80]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.5}
        />
      </mesh>
      <pointLight
        position={[0, 0, 1]}
        color={color}
        intensity={35}
        distance={8}
      />
    </group>
  );
}

function VRResultPanel({ imageUrl }: { imageUrl: string }) {
  const texture = useLoader(THREE.TextureLoader, imageUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  const image = texture.image as { width?: number; height?: number } | undefined;
  const aspect = Math.max(0.05, (image?.width ?? 1) / (image?.height ?? 1));
  const width = 2.8;
  const height = width / aspect;
  return (
    <Billboard position={[0, 2.45, 2.15]} follow lockX={false} lockY={false} lockZ={false}>
      <mesh position={[0, -height / 2, 0]} renderOrder={100}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} toneMapped={false} depthTest={false} />
      </mesh>
    </Billboard>
  );
}

function VRActionButton({ label, position, enabled, onClick }: {
  label: string;
  position: [number, number, number];
  enabled: boolean;
  onClick: () => void;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024; canvas.height = 256;
    const context = canvas.getContext("2d")!;
    context.fillStyle = enabled ? "#dfff3f" : "#77776f";
    context.fillRect(0, 0, 1024, 256);
    context.strokeStyle = "#181915"; context.lineWidth = 10; context.strokeRect(5, 5, 1014, 246);
    context.fillStyle = "#181915"; context.font = "700 58px Arial";
    context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(label, 512, 128);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    return map;
  }, [enabled, label]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={position} onClick={(event) => { event.stopPropagation(); if (enabled) onClick(); }}>
      <planeGeometry args={[1.05, 0.25]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

function VRNamePanel({ name, input, onVoice, onSubmit }: {
  name: string;
  input: React.RefObject<HTMLInputElement | null>;
  onVoice: () => void;
  onSubmit: () => void;
}) {
  const { gl, scene } = useThree();
  const panel = useRef<THREE.Group>(null);
  const actions = useRef({ onVoice, onSubmit });
  actions.current = { onVoice, onSubmit };
  const texture = useMemo(() => new THREE.CanvasTexture(document.createElement("canvas")), []);
  useEffect(() => {
    const canvas = texture.image as HTMLCanvasElement;
    canvas.width = 1024; canvas.height = 768;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#eee9de"; context.fillRect(0, 0, 1024, 768);
    context.fillStyle = "#1b1c18"; context.font = "700 22px Arial";
    context.fillText("TAMBURINS · PERSONAL WORLD ARCHIVE", 72, 72);
    context.font = "72px Georgia"; context.fillText("Make your", 72, 172); context.fillText("Muse", 72, 252);
    context.font = "28px Arial"; context.fillText("당신의 이름으로 감각의 세계를 시작합니다.", 72, 312);
    context.font = "700 20px Arial"; context.fillText("NAME", 72, 385);
    context.strokeStyle = "#1b1c18"; context.lineWidth = 3; context.strokeRect(72, 410, 880, 82);
    context.font = "36px Arial"; context.fillText(name || "이름 입력 영역을 손으로 선택하세요", 94, 462);
    context.fillStyle = "#dfff3f"; context.fillRect(72, 535, 420, 88);
    context.fillStyle = "#1b1c18"; context.font = "700 24px Arial"; context.fillText("음성으로 이름 말하기", 112, 590);
    context.fillStyle = name.trim() ? "#1b1c18" : "#8b8b85"; context.fillRect(532, 535, 420, 88);
    context.fillStyle = "#fff"; context.fillText("시작하기", 690, 590);
    texture.needsUpdate = true;
  }, [name, texture]);
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => {
    const cleanups = [0, 1].map((index) => {
      const hand = gl.xr.getHand(index);
      const pinch = () => {
        const joints = (hand as any).joints as Record<string, THREE.Object3D> | undefined;
        const wrist = joints?.wrist; const tip = joints?.["index-finger-tip"];
        if (!wrist || !tip || !panel.current) return;
        const origin = wrist.getWorldPosition(new THREE.Vector3());
        const direction = tip.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
        const hit = new THREE.Raycaster(origin, direction, 0, 4).intersectObject(panel.current, true)
          .find((item) => item.object.userData.nameAction);
        const action = hit?.object.userData.nameAction;
        if (action === "input") input.current?.focus();
        if (action === "voice") actions.current.onVoice();
        if (action === "submit") actions.current.onSubmit();
      };
      hand.addEventListener("pinchstart", pinch);
      return () => hand.removeEventListener("pinchstart", pinch);
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [gl, input, scene]);
  return (
    <group ref={panel} position={[0, 1.58, -1.8]} visible={gl.xr.isPresenting}>
      <mesh><planeGeometry args={[2.5, 1.875]} /><meshBasicMaterial map={texture} /></mesh>
      <mesh position={[0, 0.2, 0.02]} userData={{ nameAction: "input" }} onClick={() => input.current?.focus()}><planeGeometry args={[2.15, 0.2]} /><meshBasicMaterial transparent opacity={0} /></mesh>
      <mesh position={[-0.56, -0.53, 0.02]} userData={{ nameAction: "voice" }} onClick={() => actions.current.onVoice()}><planeGeometry args={[1.03, 0.23]} /><meshBasicMaterial transparent opacity={0} /></mesh>
      <mesh position={[0.56, -0.53, 0.02]} userData={{ nameAction: "submit" }} onClick={() => actions.current.onSubmit()}><planeGeometry args={[1.03, 0.23]} /><meshBasicMaterial transparent opacity={0} /></mesh>
    </group>
  );
}

function VRNameBackdrop() {
  return (
    <>
      <color attach="background" args={["#d8d5ca"]} />
      <ambientLight intensity={2} />
      <mesh position={[0, 1.55, -1.8]}>
        <planeGeometry args={[2.7, 1.6]} />
        <meshStandardMaterial color="#eee9de" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.55, -1.76]}>
        <torusGeometry args={[0.5, 0.06, 16, 64]} />
        <meshStandardMaterial color="#dfff3f" emissive="#dfff3f" emissiveIntensity={0.7} />
      </mesh>
    </>
  );
}

function VRKey({ label, value, position, interactive = true }: { label: string; value: string; position: [number, number, number]; interactive?: boolean }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 128;
    const context = canvas.getContext("2d")!;
    context.fillStyle = value === "MIC" ? "#dfff3f" : "#24251f";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = value === "MIC" ? "#181915" : "#ffffff";
    context.font = "700 44px Arial";
    context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(label, 128, 64);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return map;
  }, [label, value]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={position} userData={interactive ? { vrNameKey: value } : {}}>
      <boxGeometry args={[!interactive ? 1.7 : value === "SPACE" ? 0.7 : value === "MIC" || value === "ENTER" ? 0.42 : 0.19, 0.13, 0.045]} />
      <meshBasicMaterial map={texture} />
    </mesh>
  );
}

function VRNameKeyboard({ value, onChange, onVoice, onSubmit }: {
  value: string;
  onChange: (value: string) => void;
  onVoice: () => void;
  onSubmit: () => void;
}) {
  const { gl, scene } = useThree();
  const keyboard = useRef<THREE.Group>(null);
  const actionRef = useRef({ value, onChange, onVoice, onSubmit });
  actionRef.current = { value, onChange, onVoice, onSubmit };
  useEffect(() => {
    const cleanups = [0, 1].map((index) => {
      const hand = gl.xr.getHand(index);
      scene.add(hand);
      const press = () => {
        const joints = (hand as any).joints as Record<string, THREE.Object3D> | undefined;
        const wrist = joints?.wrist;
        const tip = joints?.["index-finger-tip"];
        if (!wrist || !tip || !keyboard.current) return;
        const origin = wrist.getWorldPosition(new THREE.Vector3());
        const target = tip.getWorldPosition(new THREE.Vector3());
        const raycaster = new THREE.Raycaster(origin, target.sub(origin).normalize(), 0, 2.5);
        const hit = raycaster.intersectObject(keyboard.current, true).find((item) => item.object.userData.vrNameKey);
        const key = hit?.object.userData.vrNameKey as string | undefined;
        if (!key) return;
        const current = actionRef.current;
        if (key === "MIC") current.onVoice();
        else if (key === "ENTER") current.onSubmit();
        else if (key === "BACK") current.onChange(current.value.slice(0, -1));
        else if (key === "SPACE") current.onChange((current.value + " ").slice(0, 20));
        else current.onChange((current.value + key).slice(0, 20));
      };
      hand.addEventListener("pinchstart", press);
      return () => { hand.removeEventListener("pinchstart", press); scene.remove(hand); };
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [gl, scene]);
  const rows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
  return (
    <group ref={keyboard} position={[0, 1.12, -0.82]} rotation={[-0.32, 0, 0]}>
      <VRKey label={`NAME: ${value || "..."}`} value="DISPLAY" interactive={false} position={[0, 0.24, 0]} />
      {rows.map((row, rowIndex) => Array.from(row).map((key, index) => (
        <VRKey key={key} label={key} value={key} position={[(index - (row.length - 1) / 2) * 0.205, -rowIndex * 0.155, 0]} />
      )))}
      <VRKey label="VOICE" value="MIC" position={[-0.78, -0.49, 0]} />
      <VRKey label="SPACE" value="SPACE" position={[0, -0.49, 0]} />
      <VRKey label="⌫" value="BACK" position={[0.58, -0.49, 0]} />
      <VRKey label="START" value="ENTER" position={[0.94, -0.49, 0]} />
    </group>
  );
}

class ArModelErrorBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function ArLiveEffects({ effects, level, strength, radius }: { effects: string[]; level: number; strength: number; radius: number }) {
  const amount = Math.max(0, Math.round(level * (1.3 + strength)));
  const has = (...ids: string[]) => ids.some((id) => effects.includes(id));
  const points = useMemo(() => Array.from({ length: 16 }, (_, index) => {
    const phi = Math.acos(1 - 2 * (index + .5) / 16);
    const theta = Math.PI * (1 + Math.sqrt(5)) * index;
    return new THREE.Vector3(Math.cos(theta) * Math.sin(phi), Math.cos(phi), Math.sin(theta) * Math.sin(phi));
  }), []);
  return (
    <group>
      {has("moss", "leaf", "wood", "branch", "mushroom") && points.slice(0, amount * 2).map((point, index) => (
        <mesh key={`moss-${index}`} position={point.clone().multiplyScalar(radius * 1.02)} scale={radius * (.1 + (index % 3) * .025)}>
          <dodecahedronGeometry args={[1, 1]} /><meshStandardMaterial color={index % 2 ? "#718642" : "#9aaa57"} roughness={1} />
        </mesh>
      ))}
      {has("flower", "fruit", "leaf") && points.slice(2, 2 + amount).map((point, index) => (
        <group key={`flower-${index}`} position={point.clone().multiplyScalar(radius * 1.16)} scale={radius * .15} rotation={[point.y, point.x, index]}>
          {[0, 1, 2, 3, 4].map((petal) => (
            <mesh key={petal} position={[Math.cos(petal * 1.256) * .55, Math.sin(petal * 1.256) * .55, 0]} scale={[.55, .28, .16]}>
              <sphereGeometry args={[1, 10, 8]} /><meshStandardMaterial color={index % 2 ? "#f4dce8" : "#fff8ef"} roughness={.7} />
            </mesh>
          ))}
          <mesh><sphereGeometry args={[.22, 10, 8]} /><meshStandardMaterial color="#d9bd51" emissive="#6d5414" emissiveIntensity={.35 * level} /></mesh>
        </group>
      ))}
      {has("metal", "chrome", "crystal") && points.slice(5, 5 + amount).map((point, index) => (
        <mesh key={`metal-${index}`} position={point.clone().multiplyScalar(radius * 1.13)} scale={radius * .13} rotation={[index, index * .7, 0]}>
          <octahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#dfe5eb" metalness={.92} roughness={.12} emissive="#9baeff" emissiveIntensity={.12 * level} />
        </mesh>
      ))}
      {has("water", "cloud", "fabric", "cocoon") && level > 0 && (
        <mesh scale={radius * (1.13 + level * .025)}>
          <sphereGeometry args={[1, 32, 24]} /><meshPhysicalMaterial color="#bfe8ff" transparent opacity={.07 + level * .025} transmission={.7} roughness={.08} thickness={.2} />
        </mesh>
      )}
      {has("light", "metal", "chrome", "crystal") && level > 0 && (
        <>
          <pointLight color="#d8d7ff" intensity={level * (1.5 + strength * 2)} distance={radius * 8} />
          {points.slice(0, amount * 2).map((point, index) => (
            <mesh key={`light-${index}`} position={point.clone().multiplyScalar(radius * 1.28)} scale={radius * .025 * (1 + level * .15)}>
              <sphereGeometry args={[1, 8, 8]} /><meshBasicMaterial color={index % 2 ? "#ffffff" : "#c8c5ff"} />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}

type MuseMaterialProfile = Partial<{
  metalness: number;
  roughness: number;
  transmission: number;
  opacity: number;
  clearcoat: number;
  clearcoatRoughness: number;
  ior: number;
  thickness: number;
  iridescence: number;
  sheen: number;
  envMapIntensity: number;
}>;

const EMPTY_MUSE_EFFECTS: string[] = [];
const WHOLE_BODY_MATERIALS = new Set(["cloud", "metal", "sand", "stone", "light", "ice", "chrome", "moss", "wood", "cocoon", "water"]);
const MUSE_MATERIAL_PROFILES: Record<string, MuseMaterialProfile> = {
  cloud: { metalness: 0, roughness: .95, sheen: .75, transmission: .04, clearcoat: .04, envMapIntensity: .7 },
  metal: { metalness: .96, roughness: .16, clearcoat: .7, clearcoatRoughness: .08, envMapIntensity: 1.8 },
  sand: { metalness: 0, roughness: .98, sheen: .04, envMapIntensity: .55 },
  stone: { metalness: 0, roughness: .92, clearcoat: .03, envMapIntensity: .62 },
  light: { metalness: 0, roughness: .035, transmission: .9, opacity: .58, clearcoat: 1, clearcoatRoughness: .02, ior: 1.34, thickness: .18, iridescence: 1, envMapIntensity: 1.9 },
  ice: { metalness: 0, roughness: .1, transmission: .62, opacity: .86, clearcoat: 1, clearcoatRoughness: .04, ior: 1.31, thickness: .8, envMapIntensity: 1.65 },
  chrome: { metalness: 0, roughness: .045, transmission: .84, opacity: .72, clearcoat: 1, clearcoatRoughness: .02, ior: 1.5, thickness: .7, envMapIntensity: 1.9 },
  moss: { metalness: 0, roughness: 1, sheen: .4, envMapIntensity: .48 },
  wood: { metalness: 0, roughness: .98, sheen: .05, envMapIntensity: .5 },
  cocoon: { metalness: 0, roughness: .3, transmission: .18, opacity: .97, clearcoat: .45, clearcoatRoughness: .16, ior: 1.54, envMapIntensity: 1.1 },
  water: { metalness: 0, roughness: .025, transmission: .92, opacity: .63, clearcoat: 1, clearcoatRoughness: .01, ior: 1.333, thickness: .6, envMapIntensity: 2 },
  flower: { metalness: 0, roughness: .68, sheen: .42, transmission: .035, envMapIntensity: .72 },
  leaf: { metalness: 0, roughness: .36, sheen: .25, clearcoat: .38, clearcoatRoughness: .22, envMapIntensity: .92 },
  branch: { metalness: 0, roughness: .94, sheen: .05, envMapIntensity: .56 },
  mushroom: { metalness: 0, roughness: .62, sheen: .18, clearcoat: .16, envMapIntensity: .76 },
  fruit: { metalness: 0, roughness: .34, clearcoat: .48, clearcoatRoughness: .2, envMapIntensity: 1 },
  fabric: { metalness: 0, roughness: .42, transmission: .12, opacity: .94, sheen: .86, envMapIntensity: .8 },
  crystal: { metalness: 0, roughness: .07, transmission: .58, opacity: .85, clearcoat: 1, clearcoatRoughness: .025, ior: 1.54, thickness: .55, iridescence: .32, envMapIntensity: 1.8 },
  feather: { metalness: 0, roughness: .78, sheen: .72, transmission: .025, envMapIntensity: .68 },
  ribbon: { metalness: 0, roughness: .3, sheen: .9, clearcoat: .24, clearcoatRoughness: .18, envMapIntensity: 1.05 },
  lily: { metalness: 0, roughness: .58, sheen: .4, transmission: .045, clearcoat: .12, envMapIntensity: .78 },
  rose: { metalness: 0, roughness: .7, sheen: .5, transmission: .025, envMapIntensity: .72 },
};

function museMaterialProfile(effects: string[]) {
  const bases = effects.filter((id) => WHOLE_BODY_MATERIALS.has(id));
  // Attached objects keep their own PBR materials. Applying a flower,
  // crystal or ribbon profile to the whole MUSE made the complete model
  // translucent instead of only the selected transparent growth.
  const active = bases.map((id) => MUSE_MATERIAL_PROFILES[id]).filter(Boolean);
  if (!active.length) return null;
  // A single averaged opacity makes an opaque/transparent mixture uniformly
  // see-through. Keep that generated core opaque; individual Tripo objects
  // receive their own transparent finish instead.
  if (active.length > 1 && active.some((profile) => (profile.transmission ?? 0) > .1 || (profile.opacity ?? 1) < .99)) return null;
  const keys = [...new Set(active.flatMap((profile) => Object.keys(profile)))] as Array<keyof MuseMaterialProfile>;
  return Object.fromEntries(keys.map((key) => {
    const values = active.map((profile) => profile[key]).filter((value): value is number => typeof value === "number");
    return [key, values.reduce((sum, value) => sum + value, 0) / values.length];
  })) as MuseMaterialProfile;
}

function enhanceMuseMaterial(source: THREE.Material, profile: MuseMaterialProfile | null) {
  const original = source as THREE.MeshStandardMaterial;
  if (!profile || !original.isMeshStandardMaterial) return source;
  const material = new THREE.MeshPhysicalMaterial({
    color: original.color,
    map: original.map,
    lightMap: original.lightMap,
    lightMapIntensity: original.lightMapIntensity,
    aoMap: original.aoMap,
    aoMapIntensity: original.aoMapIntensity,
    emissive: original.emissive,
    emissiveIntensity: original.emissiveIntensity,
    emissiveMap: original.emissiveMap,
    bumpMap: original.bumpMap,
    bumpScale: original.bumpScale,
    normalMap: original.normalMap,
    displacementMap: original.displacementMap,
    displacementScale: original.displacementScale,
    displacementBias: original.displacementBias,
    roughnessMap: original.roughnessMap,
    metalnessMap: original.metalnessMap,
    alphaMap: original.alphaMap,
    side: original.side,
    vertexColors: original.vertexColors,
  });
  material.name = original.name;
  material.normalScale.copy(original.normalScale);
  material.metalness = profile.metalness ?? original.metalness;
  material.roughness = profile.roughness ?? original.roughness;
  material.envMapIntensity = profile.envMapIntensity ?? original.envMapIntensity;
  material.transmission = profile.transmission ?? 0;
  material.clearcoat = profile.clearcoat ?? 0;
  material.clearcoatRoughness = profile.clearcoatRoughness ?? .1;
  material.ior = profile.ior ?? 1.5;
  material.thickness = profile.thickness ?? 0;
  material.iridescence = profile.iridescence ?? 0;
  material.sheen = profile.sheen ?? 0;
  material.opacity = profile.opacity ?? original.opacity;
  material.transparent = material.opacity < .999 || material.transmission > .01;
  material.depthWrite = !material.transparent;
  material.needsUpdate = true;
  return material;
}

// Tripo often bakes glass and opaque attachments into one mesh and one color
// atlas, without an alpha channel. Give only the cool glass/crystal colors
// physical transmission; leave fabric, wood, flowers and the rest opaque.
// This is a conservative no-credit fallback when the GLB has no material mask.
function enhanceGeneratedTransparency(source: THREE.Material, effects: string[]) {
  const original = source as THREE.MeshStandardMaterial;
  if (!original.isMeshStandardMaterial || !original.map) return source;
  const sourcePhysical = source as THREE.MeshPhysicalMaterial;
  if (original.transparent || original.opacity < .999 || (sourcePhysical.transmission ?? 0) > .01) return source;
  const coolGlass = effects.some((id) => id === "chrome" || id === "ice" || id === "water" || id === "light");
  const violetCrystal = effects.some((id) => id === "crystal" || id === "light");
  if (!coolGlass && !violetCrystal) return source;

  const material = enhanceMuseMaterial(source, {
    transmission: .88,
    clearcoat: .9,
    clearcoatRoughness: .06,
    ior: 1.45,
    thickness: .45,
  }) as THREE.MeshPhysicalMaterial;
  // Transmission is evaluated per fragment below. Opaque pixels still write
  // depth normally instead of turning the entire Tripo mesh transparent.
  material.transparent = false;
  material.opacity = 1;
  material.depthWrite = true;
  const cyanMask = "smoothstep(0.018, 0.10, diffuseColor.b - diffuseColor.r) * smoothstep(-0.018, 0.055, diffuseColor.g - diffuseColor.r)";
  const violetMask = "smoothstep(0.025, 0.12, diffuseColor.b - diffuseColor.g) * smoothstep(0.015, 0.09, diffuseColor.r - diffuseColor.g) * smoothstep(0.015, 0.08, diffuseColor.b - diffuseColor.r)";
  const mask = coolGlass && violetCrystal ? `max(${cyanMask}, ${violetMask})` : coolGlass ? cyanMask : violetMask;
  material.customProgramCacheKey = () => `muse-selective-transmission-v1-${coolGlass}-${violetCrystal}`;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <color_fragment>", `${THREE.ShaderChunk.color_fragment}\nfloat museTransparencyMask = clamp(${mask}, 0.0, 1.0);`)
      .replace("#include <roughnessmap_fragment>", `${THREE.ShaderChunk.roughnessmap_fragment}\nroughnessFactor = mix(roughnessFactor, 0.07, museTransparencyMask);`)
      .replace("#include <metalnessmap_fragment>", `${THREE.ShaderChunk.metalnessmap_fragment}\nmetalnessFactor = mix(metalnessFactor, 0.02, museTransparencyMask);`)
      .replace("#include <lights_physical_fragment>", THREE.ShaderChunk.lights_physical_fragment.replace("material.clearcoat = clearcoat;", "material.clearcoat = clearcoat * museTransparencyMask;"))
      .replace("#include <transmission_fragment>", THREE.ShaderChunk.transmission_fragment.replace("material.transmission = transmission;", "material.transmission = transmission * museTransparencyMask;"));
  };
  material.needsUpdate = true;
  return material;
}

function ArGlbModel({ url, scale, rotation, pressed, onReady, effects, effectLevel, strength, objectModels, bloomOpenness, twist = 0, squeeze = 0, desktop = false, visible = true, preserveSourceMaterial = false }: { objectModels: Record<string, string>; bloomOpenness?: RefObject<number>; visible?: boolean; desktop?: boolean; preserveSourceMaterial?: boolean; twist?: number; squeeze?: number; url: string; scale: number; rotation: [number, number, number]; pressed: boolean; onReady: () => void; effects: string[]; effectLevel: number; strength: number }) {
  const { viewport } = useThree();
  const idleOpenness = useRef(0);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const renderedModelRef = useRef<string | null>(null);
  useEffect(() => { renderedModelRef.current = null; }, [desktop]);
  const gltf = useLoader(GLTFLoader, url, (loader) => loader.setMeshoptDecoder(MeshoptDecoder));
  const model = useMemo(() => {
    const clone = optimizePbrForMobile(gltf.scene.clone(true), url.startsWith("/api/ar-model/") ? 1024 : 512);
    const materialProfile = preserveSourceMaterial ? null : museMaterialProfile(effects);
    const bounds = new THREE.Box3().setFromObject(clone);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    clone.position.sub(center);
    const fit = Math.min(viewport.width, viewport.height) * .42 / Math.max(size.x, size.y, size.z, 0.001);
    const normalized = new THREE.Group();
    normalized.add(clone);
    normalized.scale.setScalar(fit);
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        const enhanced = materials.map((material) => {
          const withProfile = enhanceMuseMaterial(material, materialProfile);
          return preserveSourceMaterial ? enhanceGeneratedTransparency(withProfile, effects) : withProfile;
        });
        child.material = Array.isArray(child.material) ? enhanced : enhanced[0];
        child.castShadow = true;
        child.receiveShadow = true;
        child.onAfterRender = () => {
          if (renderedModelRef.current === url) return;
          renderedModelRef.current = url;
          onReadyRef.current();
        };
      }
    });
    return normalized;
  }, [effects, gltf.scene, preserveSourceMaterial, url, viewport.height, viewport.width]);
  const effectRadius = Math.min(viewport.width, viewport.height) * .205;
  return (
    <group scale={scale * (pressed ? .9 : 1)} rotation={rotation}>
      <DesktopModelStage enabled={desktop} visible={visible} level={effectLevel} twist={twist} squeeze={squeeze} model={model}>
        <primitive object={model} />
        {effects.length > 0 && !desktop && <ArModelErrorBoundary onError={() => console.warn("AR bloom unavailable")}>
          <Suspense fallback={null}>
            <ArEvolution model={model} effects={effects} objectModels={objectModels} openness={bloomOpenness ?? idleOpenness} strength={strength} radius={effectRadius} />
          </Suspense>
        </ArModelErrorBoundary>}
      </DesktopModelStage>
    </group>
  );
}

function GlbWarmup({ url, onReady }: { url: string; onReady: (url: string) => void }) {
  useLoader(GLTFLoader, url, (loader) => loader.setMeshoptDecoder(MeshoptDecoder));
  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => { ready.current(url); }, [url]);
  return null;
}

function MobileArEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const room = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(gl);
    const previousEnvironment = scene.environment;
    const previousIntensity = scene.environmentIntensity;
    try {
      // A small, generated reflection map lights metallic GLB materials
      // without loading the large HDR map alongside the rear-camera models.
      const target = generator.fromScene(room, .04, .1, 100, { size: 64 });
      scene.environment = target.texture;
      scene.environmentIntensity = .9;
      return () => {
        scene.environment = previousEnvironment;
        scene.environmentIntensity = previousIntensity;
        target.dispose();
        generator.dispose();
        room.dispose();
      };
    } catch {
      generator.dispose();
      room.dispose();
    }
  }, [gl, scene]);
  return null;
}

function PhoneArViewer({ image, modelUrl, modelUrls, collection, effects, strength, onClose, onActivity, interactionPaused = false, desktop = false, backgroundImage, waterIntro = false }: { waterIntro?: boolean; backgroundImage?: string; desktop?: boolean; interactionPaused?: boolean; image?: string; modelUrl?: string; modelUrls?: string[]; collection: string; effects: string[]; strength: number; onClose: () => void; onActivity?: () => void }) {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const arObjectWrapRef = useRef<HTMLDivElement>(null);
  const arRenderRef = useRef<{ gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera } | null>(null);
  const gesturePreviewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handDetectorRef = useRef<any>(null);
  const handTrackingRef = useRef(false);
  const lastActivityPalm = useRef<{ x: number; y: number; pinch: number } | null>(null);
  const cameraRun = useRef(0);
  const cameraStarting = useRef(false);
  const session = useRef<ReturnType<typeof createCameraSession> | null>(null);
  const [cameraError, setCameraError] = useState("");
  const mirrorRef = useRef(false);
  const [mirrored, setMirrored] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<"user" | "environment">("user");
  const [activeCameraFacing, setActiveCameraFacing] = useState<"user" | "environment">("user");
  const cameraFacingRef = useRef<"user" | "environment">("user");
  const [trackingError, setTrackingError] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ distance: 1, angle: 0, scale: 1, rotation: 0 });
  const drag = useRef({ x: 0, y: 0, objectX: 0, objectY: 0, moved: false });
  const [cameraState, setCameraState] = useState<"starting" | "live" | "error">("starting");
  const [objectTransform, setObjectTransform] = useState({ x: 0, y: 0, scale: 1, rotation: 0 });
  const [modelRotation, setModelRotation] = useState({ x: 0, y: 0 });
  const [handPose, setHandPose] = useState({ x: 0, y: 0, scale: 1, rx: 0, ry: 0, rz: 0 });
  const [gestureWarp, setGestureWarp] = useState({ twist: 0, squeeze: 0 });
  const [handDetected, setHandDetected] = useState(false);
  const [readyModelUrl, setReadyModelUrl] = useState<string | null>(null);
  const [modelFailed, setModelFailed] = useState(false);
  const [modelRetry, setModelRetry] = useState(0);
  const [pressed, setPressed] = useState(false);
  const [effectLevel, setEffectLevel] = useState(0);
  const bloomOpenness = useRef(0);
  const [imageSaveState, setImageSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const photoBlobRef = useRef<Blob | null>(null);
  const fixedFinalMuse = modelUrl === "/models/muse-stage-4.glb" && !modelUrls?.length;
  const downloadableImage = image || (fixedFinalMuse ? "/design/muse/stage-4.png" : "");
  const completedMuseModel = Boolean(modelUrl?.startsWith("/api/ar-model/") || modelUrl === "/models/muse-stage-4.glb");
  const selectedEffectIds = useMemo(() => effects.filter((id): id is ObjectId =>
    VISUAL_OBJECTS.some((item) => item.id === id) && !BODY_MATERIAL_IDS.has(id as ObjectId)), [effects]);
  const [rearObjectCount, setRearObjectCount] = useState(0);
  useEffect(() => {
    if (activeCameraFacing !== "environment") { setRearObjectCount(0); return; }
    if (!handDetected || rearObjectCount >= selectedEffectIds.length) return;
    // Decode prepared GLBs one at a time after camera and palm tracking work.
    const timer = window.setTimeout(() => setRearObjectCount((count) => count + 1), rearObjectCount ? 900 : 0);
    return () => window.clearTimeout(timer);
  }, [activeCameraFacing, handDetected, rearObjectCount, selectedEffectIds.length]);
  const effectObjectIds = useMemo(() => activeCameraFacing === "environment"
    ? selectedEffectIds.slice(0, rearObjectCount)
    : [], [activeCameraFacing, rearObjectCount, selectedEffectIds]);
  // The phone uses compact, prebuilt versions of the same approved Tripo objects.
  // Loading the installation-size meshes here can exhaust Safari's WebGL memory.
  const objectModels = useMemo(() => Object.fromEntries(
    effectObjectIds.map((id) => [id, `/models/mobile/${id}.glb`]),
  ) as ObjectModelUrls, [effectObjectIds]);
  const boxedMode = desktop || (!backgroundImage && activeCameraFacing === "user");
  const activeModelUrl = modelUrls?.length
    ? modelUrls[Math.min(effectLevel, modelUrls.length - 1)]
    : modelUrl;
  const [displayedModelUrl, setDisplayedModelUrl] = useState<string | null>(() => activeModelUrl ?? null);
  const [warmedModelUrls, setWarmedModelUrls] = useState<Set<string>>(() => new Set());
  const renderedModelUrl = modelUrls?.length ? displayedModelUrl : activeModelUrl ?? null;
  const displayedStage = fixedFinalMuse ? 3 : modelUrls?.length && renderedModelUrl
    ? Math.max(0, modelUrls.indexOf(renderedModelUrl))
    : effectLevel;
  const transitionPending = Boolean(modelUrls?.length && activeModelUrl && renderedModelUrl !== activeModelUrl);
  const modelReady = Boolean(renderedModelUrl && readyModelUrl === renderedModelUrl);
  const activeModelReady = modelReady && !transitionPending;
  const nextWarmupUrl = modelUrls?.length && modelReady && displayedStage < modelUrls.length - 1
    ? modelUrls[displayedStage + 1]
    : null;
  useEffect(() => {
    if (activeModelUrl && warmedModelUrls.has(activeModelUrl)) setDisplayedModelUrl(activeModelUrl);
  }, [activeModelUrl, warmedModelUrls]);
  const markModelWarmed = useCallback((url: string) => {
    setWarmedModelUrls((current) => {
      if (current.has(url)) return current;
      const next = new Set(current);
      next.add(url);
      return next;
    });
  }, []);
  const completeIntro = useRef(onClose);
  const interactionPausedRef = useRef(interactionPaused);
  interactionPausedRef.current = interactionPaused;
  const introHandShownAt = useRef<number | null>(null);
  const introAdvanced = useRef(false);
  useEffect(() => { completeIntro.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!backgroundImage || interactionPaused || effectLevel < 3 || !activeModelReady || modelFailed) return;
    const timeout = window.setTimeout(() => completeIntro.current(), 2400);
    return () => window.clearTimeout(timeout);
  }, [backgroundImage, interactionPaused, effectLevel, activeModelReady, modelFailed]);
  const interactionReady = useRef(false);
  useEffect(() => { interactionReady.current = activeModelReady && !modelFailed && !galleryOpen; }, [activeModelReady, modelFailed, galleryOpen]);

  const startHandTracking = useCallback(async (video: HTMLVideoElement, run: number, boxInteraction: boolean) => {
    const source = "/mediapipe/hands/hands.js";
    if (!(window as any).Hands) {
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector(`script[src="${source}"]`) as HTMLScriptElement | null;
        if (existing) {
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error("hand tracking load failed")), { once: true });
          return;
        }
        const script = document.createElement("script");
        script.src = source;
        script.crossOrigin = "anonymous";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("hand tracking load failed"));
        document.head.appendChild(script);
      });
    }
    if (cameraRun.current !== run) return;
    const hands = new (window as any).Hands({
      locateFile: (file: string) => `/mediapipe/hands/${file}`,
    });
    hands.setOptions({
      selfieMode: false,
      maxNumHands: boxInteraction ? 2 : 1,
      modelComplexity: desktop && !backgroundImage ? 1 : 0,
      minDetectionConfidence: boxInteraction ? .7 : .42,
      minTrackingConfidence: boxInteraction ? .65 : .42,
    });
    const pinch = newArPinchState();
    const palmStage = newPalmStage();
    let lastLeftSeen = -Infinity;
    let previousFrame = performance.now();
    const twistGesture = { active: false, angle: 0, y: 0, separation: 0 };
    let leftOpen = false;
    hands.onResults((results: any) => {
      if (cameraRun.current !== run) return;
      if (interactionPausedRef.current) return;
      const now = performance.now();
      const elapsed = Math.min(100, now - previousFrame);
      previousFrame = now;
      const candidates = (results.multiHandLandmarks ?? []).map((landmarks: any[], index: number) => {
        const identity = results.multiHandedness?.[index];
        return { landmarks, hand: physicalHand(identity?.label), confidence: identity?.score ?? 0 };
      });
      const left = boxInteraction ? candidates.find((hand: any) => hand.hand === "Left" && hand.confidence >= .7)
        : candidates.sort((a: any, b: any) => Math.abs(b.landmarks[5].x - b.landmarks[17].x) - Math.abs(a.landmarks[5].x - a.landmarks[17].x))[0];
      const right = candidates.find((hand: any) => hand.hand === "Right" && hand.confidence >= .7);
      if (left) {
        const palm = left.landmarks[9];
        const pinchDistance = Math.hypot(left.landmarks[4].x - left.landmarks[8].x, left.landmarks[4].y - left.landmarks[8].y);
        const previous = lastActivityPalm.current;
        if (!previous || Math.hypot(palm.x - previous.x, palm.y - previous.y) > .045 || Math.abs(pinchDistance - previous.pinch) > .04) {
          onActivity?.();
          lastActivityPalm.current = { x: palm.x, y: palm.y, pinch: pinchDistance };
        }
      } else lastActivityPalm.current = null;
      if (waterIntro) {
        if (!left) introHandShownAt.current = null;
        else {
          introHandShownAt.current ??= now;
          if (!introAdvanced.current && now - introHandShownAt.current >= 400) {
            introAdvanced.current = true;
            completeIntro.current();
          }
        }
        return;
      }
      if (!left) {
        updatePalmStage(palmStage, null, now);
        advanceOpenPalm(pinch, null, false, now);
        twistGesture.active = false;
        if (boxInteraction) setGestureWarp((current) => ({ twist: current.twist * .58, squeeze: current.squeeze * .58 }));
        // Rear-camera landmarks briefly disappear when the generated object
        // overlaps the palm. Hold the last reliable pose through that gap.
        if (now - lastLeftSeen > (boxInteraction ? 260 : 1400)) { leftOpen = false; bloomOpenness.current = 0; setHandDetected(false); }
        return;
      }
      const landmarks = left.landmarks;
      const palmPoints = [0, 5, 9, 13, 17].map((index) => landmarks[index]);
      const nx = palmPoints.reduce((sum, point) => sum + point.x, 0) / palmPoints.length;
      const ny = palmPoints.reduce((sum, point) => sum + point.y, 0) / palmPoints.length;
      const palmWidth = Math.hypot(landmarks[5].x - landmarks[17].x, landmarks[5].y - landmarks[17].y);
      const palmLength = Math.max(.001, Math.hypot(landmarks[0].x - landmarks[9].x, landmarks[0].y - landmarks[9].y));
      const openness = [8, 12, 16, 20].reduce((sum, index) => sum + Math.hypot(
        landmarks[index].x - landmarks[0].x,
        landmarks[index].y - landmarks[0].y,
      ) / palmLength, 0) / 4;
      leftOpen = !boxInteraction || openness > (leftOpen ? 1.25 : 1.5);
      if (!leftOpen) {
        twistGesture.active = false;
        setHandDetected(false);
        advanceOpenPalm(pinch, null, false, now);
        if (boxInteraction) setGestureWarp((current) => ({ twist: current.twist * .58, squeeze: current.squeeze * .58 }));
        return;
      }
      if (boxInteraction && right && interactionReady.current) {
        const rightPalmPoints = [0, 5, 9, 13, 17].map((index) => right.landmarks[index]);
        const rightX = rightPalmPoints.reduce((sum, point) => sum + point.x, 0) / rightPalmPoints.length;
        const rightY = rightPalmPoints.reduce((sum, point) => sum + point.y, 0) / rightPalmPoints.length;
        const separation = Math.hypot(rightX - nx, rightY - ny);
        const rightPalmWidth = Math.max(.001, Math.hypot(
          right.landmarks[5].x - right.landmarks[17].x,
          right.landmarks[5].y - right.landmarks[17].y,
        ));
        const pinchRatio = Math.hypot(
          right.landmarks[4].x - right.landmarks[8].x,
          right.landmarks[4].y - right.landmarks[8].y,
        ) / rightPalmWidth;
        const pinching = twistGesture.active ? pinchRatio < .72 : pinchRatio < .48;
        const palmAngle = Math.atan2(
          right.landmarks[5].y - right.landmarks[17].y,
          right.landmarks[5].x - right.landmarks[17].x,
        );
        if (pinching) {
          if (!twistGesture.active) {
            twistGesture.active = true;
            twistGesture.angle = palmAngle;
            twistGesture.y = rightY;
            twistGesture.separation = separation;
            setGestureWarp({ twist: 0, squeeze: 0 });
          } else {
            const angleDelta = Math.atan2(
              Math.sin(palmAngle - twistGesture.angle),
              Math.cos(palmAngle - twistGesture.angle),
            );
            const twistDelta = angleDelta * 1.65 + (rightY - twistGesture.y) * 4.8;
            const twistTarget = THREE.MathUtils.clamp(Math.sign(twistDelta) * Math.pow(Math.abs(twistDelta), .72), -1, 1);
            const squeezeTarget = THREE.MathUtils.clamp((twistGesture.separation - separation) * 8.5, -1, 1);
            setGestureWarp((current) => ({
              twist: THREE.MathUtils.lerp(current.twist, twistTarget, .5),
              squeeze: THREE.MathUtils.lerp(current.squeeze, squeezeTarget, .42),
            }));
          }
        } else {
          twistGesture.active = false;
          setGestureWarp((current) => ({ twist: current.twist * .58, squeeze: current.squeeze * .58 }));
        }
      } else if (boxInteraction) {
        twistGesture.active = false;
        setGestureWarp((current) => ({ twist: current.twist * .58, squeeze: current.squeeze * .58 }));
      }
      const reappearing = now - lastLeftSeen > 220;
      lastLeftSeen = now;
      if (boxInteraction && backgroundImage && advanceOpenPalm(pinch, right ? palmOpenness(right.landmarks) : null, interactionReady.current, now)) {
        setEffectLevel(current => Math.min(3, current + 1));
      }
      if (!boxInteraction) {
        bloomOpenness.current = THREE.MathUtils.clamp((openness - 1.1) / 1.05, 0, 1);
        const stage = updatePalmStage(palmStage, interactionReady.current ? openness : null, now);
        if (interactionReady.current && !fixedFinalMuse) setEffectLevel(stage);
      }
      const gestureScale = boxInteraction ? .8 : 1;
      // Palm landmark spacing tracks depth more reliably than the model's
      // previous fixed rear-camera scale. Include length for angled hands.
      const palmExtent = Math.max(palmWidth, palmLength * .82);
      const distanceScale = boxInteraction
        ? THREE.MathUtils.clamp(palmWidth / .14, .72, 1.35)
        : THREE.MathUtils.clamp(palmExtent / .14, .55, 1.85);
      const viewWidth = window.innerWidth;
      const viewHeight = window.innerHeight;
      const videoWidth = video.videoWidth || viewWidth;
      const videoHeight = video.videoHeight || viewHeight;
      const cover = Math.max(viewWidth / videoWidth, viewHeight / videoHeight);
      const renderedWidth = videoWidth * cover;
      const renderedHeight = videoHeight * cover;
      const rawScreenX = (mirrorRef.current ? 1 - nx : nx) * renderedWidth - (renderedWidth - viewWidth) / 2;
      const rawScreenY = ny * renderedHeight - (renderedHeight - viewHeight) / 2;
      const screenX = THREE.MathUtils.clamp(rawScreenX, viewWidth * .08, viewWidth * .92);
      const screenY = THREE.MathUtils.clamp(rawScreenY, viewHeight * .12, viewHeight * .9);
      const targetX = screenX - viewWidth / 2;
      const targetY = screenY - viewHeight / 2 - Math.min(viewWidth, viewHeight) * (boxInteraction ? .13 : .06);
      setHandPose((current) => {
        const distance = Math.hypot(targetX - current.x, targetY - current.y);
        const alpha = reappearing ? 1 : distance < 3 ? 0 : 1 - Math.exp(-elapsed / (distance > 60 ? 55 : 140));
        return {
          x: THREE.MathUtils.lerp(current.x, targetX, alpha),
          y: THREE.MathUtils.lerp(current.y, targetY, alpha),
          scale: THREE.MathUtils.lerp(current.scale, gestureScale * distanceScale, 1 - Math.exp(-elapsed / 220)),
          rx: 0, ry: 0, rz: 0,
        };
      });
      setHandDetected(true);
    });
    handDetectorRef.current = hands;
    handTrackingRef.current = true;
    // A rear phone camera may deliver multi-megapixel frames even when a
    // smaller ideal size was requested. Feed Hands a bounded frame so its
    // inference can keep up while the 3D scene is rendering on the same GPU.
    const trackingCanvas = !boxInteraction ? document.createElement("canvas") : null;
    const trackingContext = trackingCanvas?.getContext("2d", { alpha: false });
    let busy = false;
    let lastInferenceAt = -Infinity;
    const inferenceInterval = boxInteraction ? 66 : 125;
    let consecutiveFrameFailures = 0;
    const track = async (frameNow = performance.now()) => {
      if (!handTrackingRef.current || cameraRun.current !== run) return;
      if (!busy && video.readyState >= 2 && frameNow - lastInferenceAt >= inferenceInterval) {
        busy = true;
        lastInferenceAt = frameNow;
        try {
          let image: HTMLVideoElement | HTMLCanvasElement = video;
          if (trackingCanvas && trackingContext && video.videoWidth && video.videoHeight) {
            const ratio = Math.min(1, 512 / Math.max(video.videoWidth, video.videoHeight));
            const width = Math.max(1, Math.round(video.videoWidth * ratio));
            const height = Math.max(1, Math.round(video.videoHeight * ratio));
            if (trackingCanvas.width !== width || trackingCanvas.height !== height) {
              trackingCanvas.width = width;
              trackingCanvas.height = height;
            }
            trackingContext.drawImage(video, 0, 0, width, height);
            image = trackingCanvas;
          }
          await hands.send({ image });
          consecutiveFrameFailures = 0;
        }
        catch {
          if (cameraRun.current === run && ++consecutiveFrameFailures >= 3) {
            setTrackingError(true);
            setHandDetected(false);
            handTrackingRef.current = false;
          }
        }
        busy = false;
      }
      requestAnimationFrame(track);
    };
    track();
  }, [backgroundImage, fixedFinalMuse, waterIntro]);

  const startCamera = useCallback(async (facingOverride?: "user" | "environment") => {
    const run = ++cameraRun.current;
    cameraStarting.current = true;
    setCameraState("starting");
    setCameraError("");
    const previousStream = streamRef.current;
    session.current?.stop();
    let lease: ReturnType<typeof createCameraSession> | null = null;
    setTrackingError(false);
    setHandDetected(false);
    handTrackingRef.current = false;
    await Promise.resolve(handDetectorRef.current?.close?.()).catch(() => {});
    if (cameraRun.current !== run) return;
    handDetectorRef.current = null;
    previousStream?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (gesturePreviewRef.current) gesturePreviewRef.current.srcObject = null;
    // Mobile Safari can keep the previous capture device busy briefly after
    // track.stop(). Give it time to release before requesting the other lens.
    if (previousStream) await new Promise((resolve) => window.setTimeout(resolve, 500));
    if (cameraRun.current !== run) return;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera unavailable");
      const desktopWidth = backgroundImage ? 960 : 1280;
      const desktopHeight = backgroundImage ? 540 : 720;
      const requestedFacing = desktop ? "user" : facingOverride ?? cameraFacingRef.current;
      const rearVideo = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } };
      const baseAttempts: MediaStreamConstraints[] = desktop
        ? [
            { video: { facingMode: "user", width: { ideal: desktopWidth }, height: { ideal: desktopHeight } }, audio: false },
            { video: true, audio: false },
          ]
        : [
            { video: { facingMode: { ideal: requestedFacing }, ...(requestedFacing === "environment" ? rearVideo : { width: { ideal: 960 }, height: { ideal: 540 } }) }, audio: false },
            { video: { facingMode: { exact: requestedFacing }, ...(requestedFacing === "environment" ? rearVideo : { width: { ideal: 1280 }, height: { ideal: 720 } }) }, audio: false },
          ];
      const preferredPattern = requestedFacing === "environment"
        ? /back|rear|environment|world|후면/i
        : /front|face|selfie|user|전면/i;
      const rejectedPattern = requestedFacing === "environment"
        ? /front|face|selfie|user|전면/i
        : /back|rear|environment|world|후면/i;
      let stream: MediaStream | null = null;
      let resolvedFacing: "user" | "environment" = requestedFacing;
      let lastCameraError: unknown;
      const tryConstraints = async (constraints: MediaStreamConstraints) => {
        lease?.stop();
        lease = createCameraSession();
        session.current = lease;
        try {
          const candidate = await lease.open(constraints);
          if (!candidate) return null;
          const track = candidate.getVideoTracks()[0];
          let settings: MediaTrackSettings | undefined;
          let capabilities: MediaTrackCapabilities | undefined;
          try { settings = track?.getSettings(); } catch { /* Some iOS camera tracks omit settings. */ }
          try { capabilities = track?.getCapabilities?.(); } catch { /* Lens labels still provide a fallback. */ }
          const label = track?.label ?? "";
          const supportedFacings = capabilities?.facingMode ?? [];
          const detectedFacing = settings?.facingMode === "environment" || /back|rear|environment|world|후면/i.test(label)
            || (supportedFacings.includes("environment") && !supportedFacings.includes("user"))
            ? "environment"
            : settings?.facingMode === "user" || /front|face|selfie|user|전면/i.test(label)
              || (supportedFacings.includes("user") && !supportedFacings.includes("environment"))
              ? "user"
              : null;
          if (!desktop && detectedFacing && detectedFacing !== requestedFacing) {
            lease.stop();
            return null;
          }
          resolvedFacing = detectedFacing ?? requestedFacing;
          return candidate;
        } catch (error) {
          lastCameraError = error;
          if (error instanceof Error && ["NotAllowedError", "SecurityError"].includes(error.name)) throw error;
          return null;
        }
      };
      for (const constraints of baseAttempts) {
        stream = await tryConstraints(constraints);
        if (stream) break;
      }
      // Camera labels and stable device IDs often become available only after
      // the first permission request. Re-enumerate now instead of reusing the
      // empty pre-permission list, then choose the requested physical lens.
      if (!stream && !desktop) {
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        const rankedDevices = devices
          .filter((device) => device.kind === "videoinput" && device.deviceId)
          .map((device, index) => ({ device, index }))
          .sort((a, b) => {
            const score = (label: string) => preferredPattern.test(label) ? 2 : rejectedPattern.test(label) ? 0 : 1;
            const difference = score(b.device.label) - score(a.device.label);
            if (difference) return difference;
            return requestedFacing === "environment" ? b.index - a.index : a.index - b.index;
          })
          .map(({ device }) => device);
        for (const device of rankedDevices) {
          stream = await tryConstraints({
            video: { deviceId: { exact: device.deviceId }, ...(requestedFacing === "environment" ? rearVideo : { width: { ideal: 1280 }, height: { ideal: 720 } }) },
            audio: false,
          });
          if (stream) break;
        }
      }
      if (!stream && !desktop && requestedFacing === "user") {
        stream = await tryConstraints({ video: true, audio: false });
      }
      if (!stream) throw lastCameraError ?? new Error("camera unavailable");
      if (cameraRun.current !== run) { lease?.stop(); return; }
      mirrorRef.current = desktop || resolvedFacing === "user";
      setMirrored(mirrorRef.current);
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stream.getTracks().forEach(track => track.stop()); throw new Error("video unavailable"); }
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.srcObject = stream;
      if (video.readyState < 1) {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new DOMException("camera metadata timeout", "AbortError")), 12000);
          video.addEventListener("loadedmetadata", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
          video.addEventListener("error", () => { window.clearTimeout(timeout); reject(new DOMException("camera video failed", "NotReadableError")); }, { once: true });
        });
      }
      await video.play();
      if (gesturePreviewRef.current) {
        gesturePreviewRef.current.srcObject = stream;
        await gesturePreviewRef.current.play().catch(() => undefined);
      }
      if (cameraRun.current !== run) return;
      setCameraState("live");
      try {
        await startHandTracking(video, run, desktop || (!backgroundImage && resolvedFacing === "user"));
      } catch {
        if (cameraRun.current === run) setTrackingError(true);
      }
      if (cameraRun.current === run) setActiveCameraFacing(resolvedFacing);
    } catch (error) {
      if (cameraRun.current === run) { setCameraState("error"); setCameraError(cameraErrorMessage(error, facingOverride ?? cameraFacingRef.current)); }
    } finally {
      if (cameraRun.current === run) cameraStarting.current = false;
    }
  }, [startHandTracking, desktop, waterIntro, backgroundImage]);

  const switchPhoneCamera = useCallback(() => {
    if (desktop || backgroundImage) return;
    const next = cameraFacing === "user" ? "environment" : "user";
    cameraFacingRef.current = next;
    setCameraFacing(next);
    setHandDetected(false);
    setReadyModelUrl(null);
    bloomOpenness.current = 0;
    setEffectLevel(0);
    setGestureWarp({ twist: 0, squeeze: 0 });
    void startCamera(next);
  }, [backgroundImage, cameraFacing, desktop, startCamera]);

  useEffect(() => {
    void startCamera();
    let resumeTimer: number | undefined;
    const suspend = () => {
      window.clearTimeout(resumeTimer);
      cameraRun.current++;
      cameraStarting.current = false;
      session.current?.stop();
      handTrackingRef.current = false;
      void Promise.resolve(handDetectorRef.current?.close?.()).catch(() => {});
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      if (gesturePreviewRef.current) gesturePreviewRef.current.srcObject = null;
    };
    const visibility = () => {
      if (document.hidden) { suspend(); return; }
      if (cameraStarting.current || streamRef.current?.getVideoTracks().some((track) => track.readyState === "live")) return;
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        if (!document.hidden && !cameraStarting.current) void startCamera();
      }, 450);
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", suspend);
    window.addEventListener("pageshow", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("pageshow", visibility);
      suspend();
    };
  }, [startCamera]);

  const pair = () => Array.from(pointers.current.values()).slice(0, 2);
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if ((event.target as HTMLElement).closest(".ar-object-wrap")) setPressed(true);
    const points = pair();
    if (points.length === 1) {
      drag.current = { x: points[0].x, y: points[0].y, objectX: modelUrl ? modelRotation.y : objectTransform.x, objectY: modelUrl ? modelRotation.x : objectTransform.y, moved: false };
    } else if (points.length === 2) {
      const [a, b] = points;
      gesture.current = { distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), angle: Math.atan2(b.y - a.y, b.x - a.x), scale: objectTransform.scale, rotation: objectTransform.rotation };
    }
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = pair();
    if (points.length === 1) {
      const dx = points[0].x - drag.current.x;
      const dy = points[0].y - drag.current.y;
      if (Math.hypot(dx, dy) > 7) drag.current.moved = true;
      if (modelUrl) setModelRotation({ x: drag.current.objectY + dy * .012, y: drag.current.objectX + dx * .012 });
      else setObjectTransform((current) => ({ ...current, x: drag.current.objectX + dx, y: drag.current.objectY + dy }));
    } else if (points.length === 2) {
      const [a, b] = points;
      const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      setObjectTransform((current) => ({ ...current, scale: THREE.MathUtils.clamp(gesture.current.scale * distance / gesture.current.distance, .35, 2.6), rotation: gesture.current.rotation + (angle - gesture.current.angle) * 180 / Math.PI }));
    }
  };
  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) setPressed(false);
    const remaining = pair();
    if (remaining.length === 1) drag.current = { x: remaining[0].x, y: remaining[0].y, objectX: modelUrl ? modelRotation.y : objectTransform.x, objectY: modelUrl ? modelRotation.x : objectTransform.y, moved: false };
  };

  const saveMuseImage = async () => {
    if (!downloadableImage || imageSaveState === "saving") return;
    setImageSaveState("saving");
    try {
      const response = await fetch(downloadableImage);
      if (!response.ok) throw new Error("image download failed");
      const blob = await response.blob();
      const filename = `MUSE-${new Date().toISOString().slice(0, 10)}.png`;
      const file = new File([blob], filename, { type: blob.type || "image/png" });
      const shareNavigator = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean;
        share?: (data: { files: File[]; title: string }) => Promise<void>;
      };
      if (shareNavigator.share && shareNavigator.canShare?.({ files: [file] })) {
        await shareNavigator.share({ files: [file], title: "Make Your MUSE" });
      } else {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }
      setImageSaveState("saved");
      window.setTimeout(() => setImageSaveState("idle"), 2200);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setImageSaveState("idle");
        return;
      }
      setImageSaveState("error");
    }
  };

  const captureCameraPhoto = () => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      setPhotoError(true);
      return;
    }
    setPhotoError(false);
    try {
      const viewport = video.getBoundingClientRect();
      const width = viewport.width;
      const height = viewport.height;
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
      const photo = document.createElement("canvas");
      photo.width = Math.round(width * pixelRatio);
      photo.height = Math.round(height * pixelRatio);
      const context = photo.getContext("2d", { alpha: false });
      if (!context) throw new Error("Photo canvas unavailable");
      context.scale(pixelRatio, pixelRatio);

      // Match the camera's object-fit: cover crop and the selfie mirror.
      const cover = Math.max(width / video.videoWidth, height / video.videoHeight);
      const sourceWidth = width / cover;
      const sourceHeight = height / cover;
      const sourceX = (video.videoWidth - sourceWidth) / 2;
      const sourceY = (video.videoHeight - sourceHeight) / 2;
      context.save();
      if (mirrored) { context.translate(width, 0); context.scale(-1, 1); }
      context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
      context.restore();

      if (handDetected && arObjectWrapRef.current) {
        const wrap = arObjectWrapRef.current;
        const transform = window.getComputedStyle(wrap).transform;
        context.save();
        if (transform && transform !== "none") {
          const matrix = new DOMMatrix(transform);
          context.translate(width / 2, height / 2);
          context.transform(matrix.m11, matrix.m12, matrix.m21, matrix.m22, matrix.m41, matrix.m42);
          context.translate(-width / 2, -height / 2);
        }
        const rendered = arRenderRef.current;
        if (rendered && modelReady && !modelFailed) {
          // Read WebGL in the same task as render; keeping the drawing buffer
          // permanently would consume too much memory on mobile Safari.
          rendered.gl.render(rendered.scene, rendered.camera);
          context.drawImage(rendered.gl.domElement, 0, 0, width, height);
        } else {
          const fallback = wrap.querySelector("img");
          if (fallback?.complete && fallback.naturalWidth) {
            const size = Math.min(width * .42, height * .42);
            context.drawImage(fallback, (width - size) / 2, (height - size) / 2, size, size);
          }
        }
        context.restore();
      }
      photo.toBlob((blob) => {
        if (!blob) { setPhotoError(true); return; }
        if (photoPreview) URL.revokeObjectURL(photoPreview);
        photoBlobRef.current = blob;
        setPhotoPreview(URL.createObjectURL(blob));
      }, "image/png");
    } catch {
      setPhotoError(true);
    }
  };

  const saveCameraPhoto = async () => {
    const blob = photoBlobRef.current;
    if (!blob) return;
    const filename = `Make-Your-MUSE-${new Date().toISOString().slice(0, 10)}.png`;
    const file = new File([blob], filename, { type: "image/png" });
    const shareNavigator = navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean;
      share?: (data: { files: File[]; title: string }) => Promise<void>;
    };
    try {
      if (shareNavigator.share && shareNavigator.canShare?.({ files: [file] })) {
        await shareNavigator.share({ files: [file], title: "Make Your MUSE" });
      } else if (photoPreview) {
        const link = document.createElement("a");
        link.href = photoPreview;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setPhotoError(true);
    }
  };

  const closePhotoPreview = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    photoBlobRef.current = null;
    setPhotoPreview(null);
  };

  const handleIntroClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!backgroundImage) return;
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    onClose();
  }, [backgroundImage, onClose]);

  return (
    <section className={`phone-ar-viewer ${backgroundImage ? "muse-hand-intro" : ""}`} aria-label={desktop ? "노트북 카메라 체험" : "AR 카메라 뷰어"} onClick={handleIntroClick}>
      {backgroundImage && <img className="muse-intro-background" src={backgroundImage} alt="Make Your Muse" />}
      {waterIntro && <AntiWaterSurface video={videoRef} />}
      <video ref={videoRef} autoPlay muted playsInline style={{ transform: mirrored ? "scaleX(-1)" : undefined }} />
      {desktop && <aside className={`gesture-camera-preview ${cameraState === "live" ? "is-live" : ""}`} aria-label="내 손동작 카메라 화면">
        <video ref={gesturePreviewRef} autoPlay muted playsInline style={{ transform: mirrored ? "scaleX(-1)" : undefined }} />
        <span><i /> HAND CAMERA</span>
      </aside>}
      <div className="ar-touch-stage" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
        <div ref={arObjectWrapRef} className={`ar-object-wrap ${boxedMode ? "desktop-reveal" : ""} ${backgroundImage ? "intro-reveal" : ""} ${handDetected ? "has-hand" : "no-hand"} ${pressed ? "is-pressed" : ""}`} style={{ transform: `translate3d(${backgroundImage ? 0 : handPose.x}px, ${backgroundImage ? 0 : handPose.y}px, 0) rotate(${objectTransform.rotation}deg) scale(${modelUrl ? 1 : objectTransform.scale})` }}>
          {image && <img className={modelReady && !modelFailed ? "is-model-ready" : ""} src={image} alt={`${collection} 완성 오브젝트`} draggable={false} />}
          {renderedModelUrl && !modelFailed && !galleryOpen && (
            <ArModelErrorBoundary key={modelRetry} onError={() => setModelFailed(true)}>
              <Canvas className="ar-model-canvas" dpr={typeof window === "undefined" ? 1 : Math.min(1.5, window.devicePixelRatio || 1)} gl={{ alpha: true, antialias: desktop, powerPreference: "default", toneMapping: THREE.ACESFilmicToneMapping }} camera={{ position: [0, 0, 4], fov: 40 }} onCreated={({ gl, scene, camera }) => {
                arRenderRef.current = { gl, scene, camera };
                gl.toneMappingExposure = backgroundImage ? 1 : .84;
                gl.domElement.addEventListener("webglcontextlost", (event) => {
                  event.preventDefault();
                  arRenderRef.current = null;
                  setReadyModelUrl(null);
                  setModelFailed(true);
                }, { once: true });
              }}>
                <ambientLight intensity={backgroundImage ? 2.1 : 1.1} />
                <directionalLight position={[3, 5, 4]} intensity={backgroundImage ? 3.2 : 1.7} />
                <directionalLight position={[-3, 1, -2]} intensity={backgroundImage ? 1.4 : .65} />
                {backgroundImage
                  ? <Suspense fallback={null}><Environment files="/environments/muse-studio.hdr" environmentIntensity={2.2} /></Suspense>
                  : <MobileArEnvironment />}
                <Suspense fallback={null}>
                  <ArGlbModel
                    visible={Boolean(backgroundImage) || handDetected}
                    desktop={boxedMode}
                    twist={boxedMode && !backgroundImage ? gestureWarp.twist : 0}
                    squeeze={boxedMode && !backgroundImage ? gestureWarp.squeeze : 0}
                    url={renderedModelUrl}
                    preserveSourceMaterial={completedMuseModel}
                    scale={objectTransform.scale * (backgroundImage ? 1 : handPose.scale)}
                    rotation={[modelRotation.x, modelRotation.y, 0]}
                    pressed={pressed}
                    onReady={() => setReadyModelUrl(renderedModelUrl)}
                    effects={modelUrls?.length || boxedMode ? EMPTY_MUSE_EFFECTS : effects}
                    objectModels={objectModels}
                    bloomOpenness={bloomOpenness}
                    effectLevel={displayedStage}
                    strength={modelUrls?.length || boxedMode ? 0 : strength}
                  />
                </Suspense>
                {nextWarmupUrl && (
                  <Suspense key={`warm-${nextWarmupUrl}`} fallback={null}>
                    <GlbWarmup url={nextWarmupUrl} onReady={markModelWarmed} />
                  </Suspense>
                )}
              </Canvas>
            </ArModelErrorBoundary>
          )}
        </div>
      </div>
      {!backgroundImage && desktop && <button className="ar-gallery-open" onClick={() => setGalleryOpen(true)}>다른 사람들의 MUSE</button>}
      {!backgroundImage && !desktop && <button className="ar-gallery-open mobile-archive-open" type="button" onClick={() => setGalleryOpen(true)}>MUSE ARCHIVE</button>}
      {!backgroundImage && !desktop && (
        <button className="ar-camera-switch" type="button" onClick={switchPhoneCamera} aria-label={cameraFacing === "user" ? "후면 카메라로 전환" : "전면 카메라로 전환"}>
          <svg viewBox="0 0 32 32" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M26.5 13a10.5 10.5 0 0 0-18.1-5.9L5 10.5" />
            <path d="M5 5.5v5h5" />
            <path d="M5.5 19a10.5 10.5 0 0 0 18.1 5.9l3.4-3.4" />
            <path d="M27 26.5v-5h-5" />
          </svg>
        </button>
      )}
      {!backgroundImage && !desktop && (
        <button className={`ar-image-save is-${imageSaveState}`} type="button" onClick={() => { if (downloadableImage) void saveMuseImage(); else captureCameraPhoto(); }} disabled={imageSaveState === "saving" || (!downloadableImage && (cameraState !== "live" || Boolean(photoPreview)))} aria-label={downloadableImage ? imageSaveState === "saving" ? "이미지 저장 중" : imageSaveState === "saved" ? "이미지 저장 완료" : imageSaveState === "error" ? "이미지 저장 다시 시도" : "이미지 다운로드" : "카메라 사진 찍어 저장"} title={downloadableImage ? "이미지 다운로드" : "카메라 사진 찍어 저장"}>
          <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3" /></svg>
        </button>
      )}
      {!backgroundImage && !desktop && (
        <button className="ar-photo-shutter" type="button" onClick={captureCameraPhoto} disabled={cameraState !== "live" || Boolean(photoPreview)} aria-label="화면 사진 찍기" title="화면 사진 찍기"><span aria-hidden="true" /></button>
      )}
      {photoError && !photoPreview && <p className="ar-photo-error" role="status">사진을 찍지 못했어요. 다시 시도해 주세요.</p>}
      {photoPreview && <div className="ar-photo-preview" role="dialog" aria-modal="true" aria-label="촬영한 사진">
        <img src={photoPreview} alt="카메라와 MUSE를 함께 촬영한 사진" />
        <div className="ar-photo-preview-actions">
          <button type="button" onClick={closePhotoPreview}>다시 촬영</button>
          <button type="button" onClick={() => void saveCameraPhoto()}>사진 저장</button>
        </div>
        {photoError && <p role="status">저장하지 못했어요. 다시 눌러 주세요.</p>}
      </div>}
      {galleryOpen && <AuraGallery savedView={!desktop} onClose={() => setGalleryOpen(false)} />}
      {!backgroundImage && <button className="ar-minimal-close" onClick={onClose} aria-label="AR 닫기">×</button>}
      {cameraState === "starting" && <p className="ar-camera-status">카메라 연결 중…</p>}
      {cameraState === "live" && !trackingError && !handDetected && <p className="ar-camera-status">{waterIntro ? "왼손을 보여주면 다음으로 넘어갑니다" : boxedMode ? "양손을 보여주면 박스 안의 MUSE를 움직일 수 있어요" : "손바닥을 카메라에 보여주세요"}</p>}
      {cameraState === "live" && !trackingError && handDetected && activeModelReady && <p className="ar-effect-level" aria-live="polite">{boxedMode
        ? backgroundImage
          ? (effectLevel === 3 ? "MUSE 변화 완료 · 4 / 4" : `오른손을 접었다 펼치면 변화 · ${effectLevel + 1} / 4`)
          : "오른손 엄지와 검지를 집고 손목을 돌려 오브젝트를 꼬아보세요"
        : fixedFinalMuse ? "Make Your MUSE" : `손을 펼수록 MUSE가 피어납니다 · ${effectLevel + 1} / 4`}</p>}
      {trackingError && <button className="ar-camera-retry" onClick={() => void startCamera()}>손 감지 다시 연결</button>}
      {modelFailed && <button className="ar-model-status" type="button" onClick={() => {
        if (renderedModelUrl) useLoader.clear(GLTFLoader, renderedModelUrl);
        setReadyModelUrl(null);
        setModelFailed(false);
        setModelRetry((current) => current + 1);
      }}>3D 모델 다시 불러오기</button>}
      {!modelReady && !modelFailed && renderedModelUrl && <p className="ar-model-status">3D 오브젝트 불러오는 중…</p>}
      {cameraState === "error" && <p className="ar-model-status" role="alert">{cameraError}</p>}
      {cameraState === "error" && <button className="ar-camera-retry" onClick={() => void startCamera()}>카메라 허용하고 시작</button>}
    </section>
  );
}

type AuraRecord = { id: string; name: string; arUrl: string; objects: string; createdAt: number };

function NameEntry({ value, error, listening, input, onChange, onVoice, onSubmit }: {
  value: string;
  error: string;
  listening: boolean;
  input: React.RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onVoice: () => void;
  onSubmit: () => void;
}) {
  return (
    <section className="name-entry-shell" aria-label="이름 입력">
      <img className="name-entry-ui" src="/design/ui/name-entry.png?v=20261022" alt="" aria-hidden="true" />
      <form className="name-entry-card" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <input
          ref={input}
          id="participant-name"
          aria-label="이름"
          value={value}
          maxLength={20}
          autoComplete="name"
          autoFocus
          placeholder="이름"
          onChange={(event) => onChange(event.target.value)}
        />
        <button className="name-voice-button" type="button" onClick={onVoice} aria-label="음성으로 이름 입력">
          {listening ? "●" : "MIC"}
        </button>
        {error && <p className="name-input-error" role="alert">{error}</p>}
        <button className="name-start-button" type="submit" disabled={!value.trim()}>Start</button>
      </form>
    </section>
  );
}

function AuraGallery({ onClose, desktop = false, savedView = false, operatorKey }: { onClose: () => void; desktop?: boolean; savedView?: boolean; operatorKey?: string }) {
  const returnJob = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("jobReturn") : null;
  const returnQuery = returnJob && /^[a-f0-9]{32}$/.test(returnJob) ? `&jobReturn=${returnJob}` : "";
  const [auras, setAuras] = useState<AuraRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [renamingId, setRenamingId] = useState("");
  const [actionError, setActionError] = useState("");
  useEffect(() => {
    fetch("/api/auras", { cache: "no-store" }).then((response) => { if (!response.ok) throw new Error(); return response.json(); }).then((data: { auras?: AuraRecord[] }) => setAuras(data.auras ?? [])).catch(() => setFailed(true)).finally(() => setLoading(false));
  }, []);
  const formatArchiveDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return [String(date.getFullYear()).slice(-2), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join(".");
  };
  const deleteAura = async (aura: AuraRecord) => {
    const label = aura.name || "GUEST";
    if (!window.confirm(`${label}의 저장된 MUSE를 삭제할까요?\n삭제한 MUSE는 복구할 수 없습니다.`)) return;
    setDeletingId(aura.id);
    setActionError("");
    try {
      const response = await fetch(`/api/auras/${aura.id}`, {
        method: "DELETE",
        headers: { "X-Muse-Operator-Key": operatorKey ?? "" },
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || "저장된 MUSE를 삭제하지 못했습니다.");
      setAuras((current) => current.filter((entry) => entry.id !== aura.id));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "저장된 MUSE를 삭제하지 못했습니다.");
    } finally {
      setDeletingId("");
    }
  };
  const renameAura = async (aura: AuraRecord) => {
    const name = nameDraft.trim();
    if (!name || [...name].length > 20) { setActionError("이름은 1~20자로 입력해주세요."); return; }
    setRenamingId(aura.id);
    setActionError("");
    try {
      const response = await fetch(`/api/auras/${aura.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Muse-Operator-Key": operatorKey ?? "" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json().catch(() => ({})) as { name?: string; error?: string };
      if (!response.ok || !data.name) throw new Error(data.error || "저장된 MUSE 이름을 바꾸지 못했습니다.");
      const updatedName = data.name;
      setAuras((current) => current.map((entry) => entry.id === aura.id ? { ...entry, name: updatedName } : entry));
      setEditingId("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "저장된 MUSE 이름을 바꾸지 못했습니다.");
    } finally {
      setRenamingId("");
    }
  };
  return (
    <section className={`aura-gallery ${desktop ? "temporary-model-archive" : ""}`} aria-label={desktop ? "저장된 3D 보기" : savedView ? "저장된 MUSE 보기" : "다른 사람들의 MUSE"}>
      {desktop ? (
        <header className="archive-header">
          <button className="archive-back" onClick={onClose} aria-label="저장된 3D 보기 닫기"><span>‹</span> Back</button>
          <strong className="archive-brand">Make Your MUSE</strong>
          <h2>MUSE Archive</h2>
        </header>
      ) : (
        <header><div><small>COLLECTIVE MUSE ARCHIVE</small><h2>{savedView ? "저장된 MUSE" : "다른 사람들의 MUSE"}</h2></div><button onClick={onClose}>닫기 ×</button></header>
      )}
      {actionError && <p className="aura-gallery-delete-error" role="alert">{actionError}</p>}
      <div className="aura-gallery-grid">
        {!failed && !loading && auras.map((aura) => (
          <article key={aura.id}>
            {desktop && (
              <div className="aura-operator-actions">
                <button type="button" onClick={() => { setEditingId(aura.id); setNameDraft(aura.name || "GUEST"); setActionError(""); }} disabled={deletingId === aura.id || renamingId === aura.id} aria-label={`${aura.name || "GUEST"}의 이름 변경`}>이름 변경</button>
                <button type="button" onClick={() => void deleteAura(aura)} disabled={deletingId === aura.id || renamingId === aura.id} aria-label={`${aura.name || "GUEST"}의 저장된 MUSE 삭제`}>
                  {deletingId === aura.id ? "삭제 중" : "삭제"}
                </button>
              </div>
            )}
            <figure className="aura-image-frame">
              <img src={`/api/auras/${aura.id}/image`} alt={`${aura.name || "GUEST"}님의 MUSE`} />
            </figure>
            {desktop && editingId === aura.id ? (
              <form className="aura-rename-form" onSubmit={(event) => { event.preventDefault(); void renameAura(aura); }}>
                <input autoFocus aria-label="새 MUSE 이름" maxLength={20} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} />
                <div>
                  <button type="submit" disabled={renamingId === aura.id || !nameDraft.trim()}>{renamingId === aura.id ? "저장 중" : "저장"}</button>
                  <button type="button" disabled={renamingId === aura.id} onClick={() => setEditingId("")}>취소</button>
                </div>
              </form>
            ) : <div><strong>{aura.name || "GUEST"}</strong><span>{desktop ? formatArchiveDate(aura.createdAt) : new Date(aura.createdAt).toLocaleDateString("ko-KR")}</span></div>}
            <a href={desktop ? `${aura.arUrl}&view=desktop` : aura.arUrl} target={desktop ? "_blank" : undefined} rel={desktop ? "noopener noreferrer" : undefined}>{desktop ? "노트북 카메라로 보기" : "내 카메라에서 보기"}</a>
          </article>
        ))}
        {!loading && <article className="intro-muse-card">
          <figure className="aura-image-frame intro-muse-thumb">
            <img src="/design/muse/stage-4.png" alt="Make Your MUSE 완성 작품" />
          </figure>
          <div><strong>Make Your MUSE</strong></div>
          <a href={desktop ? "/?introMuse=1&view=desktop" : `/?introMuse=1${returnQuery}`} target={desktop ? "_blank" : undefined} rel={desktop ? "noopener noreferrer" : undefined}>{desktop ? "노트북 카메라로 보기" : "내 카메라에서 보기"}</a>
        </article>}
      </div>
      {failed ? <p className="aura-gallery-state">목록을 불러오지 못했습니다. 닫았다 다시 열어주세요.</p> : loading ? <p className="aura-gallery-state">MUSE를 불러오고 있습니다…</p> : null}
    </section>
  );
}

export default function OpenGalleryExperience() {
  const [savedModelsOpen, setSavedModelsOpen] = useState(false);
  const [archiveAccessOpen, setArchiveAccessOpen] = useState(false);
  const [archiveAccessInput, setArchiveAccessInput] = useState("");
  const [archiveAccessError, setArchiveAccessError] = useState("");
  const [archiveAccessChecking, setArchiveAccessChecking] = useState(false);
  const archiveOperatorKey = useRef("");
  useEffect(() => {
    const openArchiveAccess = (event: KeyboardEvent) => {
      if (window.innerWidth <= 700 || window.matchMedia("(pointer: coarse)").matches || /[?&](?:job|model|ar)=/.test(window.location.search) || savedModelsOpen || archiveAccessOpen) return;
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.code === "KeyS") {
        event.preventDefault();
        setArchiveAccessError("");
        setArchiveAccessOpen(true);
      }
    };
    window.addEventListener("keydown", openArchiveAccess);
    return () => window.removeEventListener("keydown", openArchiveAccess);
  }, [savedModelsOpen, archiveAccessOpen]);
  const closeArchive = () => {
    archiveOperatorKey.current = "";
    setSavedModelsOpen(false);
  };
  const verifyArchiveAccess = async () => {
    if (!archiveAccessInput.trim() || archiveAccessChecking) return;
    setArchiveAccessChecking(true);
    setArchiveAccessError("");
    try {
      const response = await fetch("/api/operator/archive-access", {
        cache: "no-store",
        headers: { "X-Muse-Operator-Key": archiveAccessInput.trim() },
      });
      if (!response.ok) throw new Error(response.status === 401 ? "접근 키가 맞지 않습니다." : response.status === 429 ? "입력 횟수를 초과했습니다. 15분 뒤 다시 시도해주세요." : "운영자 인증에 연결할 수 없습니다.");
      archiveOperatorKey.current = archiveAccessInput.trim();
      setArchiveAccessInput("");
      setArchiveAccessOpen(false);
      setSavedModelsOpen(true);
    } catch (error) {
      setArchiveAccessError(error instanceof Error ? error.message : "운영자 인증에 연결할 수 없습니다.");
    } finally {
      setArchiveAccessChecking(false);
    }
  };
  const xrRenderer = useRef<THREE.WebGLRenderer | null>(null);
  const handsInput = useRef<HandsInput>([makeHand("Left"), makeHand("Right")]);
  const nameInput = useRef<HTMLInputElement>(null);
  const nameRecognition = useRef<{ stop?: () => void } | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [participantName, setParticipantName] = useState("");
  const [nameListening, setNameListening] = useState(false);
  const [nameError, setNameError] = useState("");
  const [mixed, setMixed] = useState<ObjectId[]>([]);
  // Shared camera links render a completed GLB and must not preload the
  // entire installation's object library on a phone.
  const phoneRoute = typeof window !== "undefined" && /[?&](?:job|model|ar|archive|introMuse)=/.test(window.location.search);
  const lastActivityAt = useRef(Date.now());
  const idleVideoOpenRef = useRef(false);
  const resetIdleSessionRef = useRef<() => void>(() => {});
  const [idleVideoOpen, setIdleVideoOpen] = useState(false);
  const markActivity = useCallback(() => {
    if (idleVideoOpenRef.current) return;
    lastActivityAt.current = Date.now();
  }, []);
  const dismissIdleVideo = useCallback(() => {
    const idleFor = Date.now() - lastActivityAt.current;
    lastActivityAt.current = Date.now();
    if (idleVideoOpenRef.current) {
      idleVideoOpenRef.current = false;
      setIdleVideoOpen(false);
      // The existing two-minute kiosk reset still applies after a long break.
      if (idleFor >= 120_000) resetIdleSessionRef.current();
    }
  }, []);
  const objectModelUrls = useObjectModelUrls(phoneRoute ? [] : VISUAL_OBJECTS.map((item) => item.id));
  const [impacts, setImpacts] = useState<PaintImpact[]>([]);
  const [, setClayChanged] = useState(false);
  const [stretchGuideDone, setStretchGuideDone] = useState(false);
  const [experiencePhase, setExperiencePhase] = useState<"sculpt" | "mix">("sculpt");
  const [vrPresenting, setVrPresenting] = useState(false);
  const [xrEntryError, setXrEntryError] = useState("");
  const [spaceReady, setSpaceReady] = useState(false);
  const [resultVisible, setResultVisible] = useState(false);
  const [vrResultPage, setVrResultPage] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [clayKey, setClayKey] = useState(0);
  const [generatedWorld, setGeneratedWorld] = useState<string | null>(null);
  const [generatedViews, setGeneratedViews] = useState<Record<"front" | "left" | "back" | "right", string> | null>(null);
  const [generationState, setGenerationState] = useState<"idle" | "generating" | "error">("idle");
  const [generationError, setGenerationError] = useState("");
  const [saveDirectory, setSaveDirectory] = useState<SaveDirectoryHandle | null>(null);
  const [saveStatus, setSaveStatus] = useState("저장 폴더 미연결");
  const [resultFileBase, setResultFileBase] = useState("");
  const [sharedAr, setSharedAr] = useState<{ image?: string; modelUrl?: string; collection: string; effects: string[]; strength: number } | null>(null);
  const [publicArchiveOpen, setPublicArchiveOpen] = useState(false);
  const [desktopViewer, setDesktopViewer] = useState(false);
  const [sharedArLoading, setSharedArLoading] = useState(false);
  const [arShareState, setArShareState] = useState<"idle" | "uploading" | "error">("idle");
  const [tripoProgress, setTripoProgress] = useState(0);
  const [arShareError, setArShareError] = useState("");
  const [arShareUrl, setArShareUrl] = useState("");
  const [arQrImage, setArQrImage] = useState("");
  const [introCleared, setIntroCleared] = useState(false);
  const [waterIntroCleared, setWaterIntroCleared] = useState(false);
  const [handStatus, setHandStatus] = useState<"loading" | "live" | "detected" | "error">("loading");
  const [cameraSessionKey, setCameraSessionKey] = useState(0);
  const [routeReady, setRouteReady] = useState(false);
  const [museJobId, setMuseJobId] = useState("");
  const [handoffState, setHandoffState] = useState<"idle" | "creating" | "qr" | "error">("idle");
  const [handoff, setHandoff] = useState<{ id?: string; url?: string; qr?: string } | null>(null);

  const [auraSaveState, setAuraSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const silhouetteRef = useRef<(() => string) | null>(null);
  const turningGlassRef = useRef<THREE.Group>(null);
  const resultCaptureRef = useRef<HTMLElement | null>(null);
  const autoSavedResultRef = useRef("");
  const autoSaveInFlightRef = useRef("");
  const impactSequence = useRef(0);
  const phaseChangedAtRef = useRef(0);
  const generationRequestedRef = useRef(false);
  const imageTaskIdRef = useRef("");
  useEffect(() => { imageTaskIdRef.current = ""; }, [mixed]);
  useEffect(() => {
    if (!participantName) { setSpaceReady(false); return; }
    const timer = window.setTimeout(() => setSpaceReady(true), 850);
    return () => window.clearTimeout(timer);
  }, [participantName]);
  const enterObjectPhase = useCallback(() => {
    phaseChangedAtRef.current = performance.now();
    setExperiencePhase("mix");
  }, []);
  const submitParticipantName = useCallback(() => {
    const cleanName = nameDraft.trim().replace(/\s+/g, " ").slice(0, 20);
    if (!cleanName) {
      setNameError("이름을 입력하거나 음성으로 말해주세요.");
      nameInput.current?.focus();
      return;
    }
    setNameDraft(cleanName);
    setParticipantName(cleanName);
    setNameError("");
  }, [nameDraft]);
  const startNameVoice = useCallback(() => {
    const SpeechRecognition = (window as Window & {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    }).SpeechRecognition ?? (window as Window & { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setNameError("이 브라우저는 음성 입력을 지원하지 않습니다. 이름을 직접 입력해주세요.");
      nameInput.current?.focus();
      return;
    }
    nameRecognition.current?.stop?.();
    const recognition = new SpeechRecognition();
    recognition.lang = "ko-KR";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => { setNameListening(true); setNameError(""); };
    recognition.onresult = (event: any) => {
      const spoken = String(event.results?.[0]?.[0]?.transcript ?? "").trim().slice(0, 20);
      if (spoken) setNameDraft(spoken);
    };
    recognition.onerror = () => setNameError("이름을 듣지 못했습니다. 다시 말하거나 직접 입력해주세요.");
    recognition.onend = () => setNameListening(false);
    nameRecognition.current = recognition;
    recognition.start();
  }, []);
  useEffect(() => () => nameRecognition.current?.stop?.(), []);
  useEffect(() => {
    // A held gesture must never leak from sculpting into object/table mode.
    // Require a fresh open-hand -> pinch cycle after every phase change.
    handsInput.current.forEach((hand) => {
      hand.interaction = null;
      hand.grabbed = null;
      hand.pinch = false;
      hand.armed = false;
      hand.pinchFrames = 0;
      hand.releaseFrames = 0;
    });
  }, [experiencePhase]);
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    setDesktopViewer(parameters.get("view") === "desktop");
    if (parameters.get("archive") === "1") {
      setPublicArchiveOpen(true);
      setRouteReady(true);
      return;
    }
    if (parameters.get("introMuse") === "1") {
      setSharedAr({ modelUrl: "/models/muse-stage-4.glb", collection: "Make Your MUSE", effects: [], strength: 0 });
      setRouteReady(true);
      return;
    }
    const jobId = parameters.get("job");
    if (jobId && /^[a-f0-9]{32}$/.test(jobId)) {
      setMuseJobId(jobId);
      setRouteReady(true);
      return;
    }
    const modelId = parameters.get("model");
    if (modelId && /^[a-f0-9]{32}$/.test(modelId)) {
      setSharedArLoading(true);
      setRouteReady(true);
      fetch(`/api/ar-meta/${modelId}`)
        .then((response) => response.json())
        .then((meta: { collection?: string; effects?: string[]; strength?: number }) => setSharedAr({
          image: `/api/ar-object/${modelId}`,
          modelUrl: `/api/ar-model/${modelId}`,
          collection: meta.collection ?? "Make your Muse",
          effects: meta.effects ?? [],
          strength: meta.strength ?? 0,
        }))
        .catch(() => setSharedAr({ image: `/api/ar-object/${modelId}`, modelUrl: `/api/ar-model/${modelId}`, collection: "Make your Muse", effects: [], strength: 0 }))
        .finally(() => setSharedArLoading(false));
      return;
    }
    const id = parameters.get("ar");
    if (!id || !/^[a-f0-9]{32}$/.test(id)) {
      setRouteReady(true);
      return;
    }
    setSharedArLoading(true);
    setRouteReady(true);
    fetch(`/api/ar-object/${id}`)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const blob = await response.blob();
        const image = URL.createObjectURL(blob);
        setSharedAr({ image, collection: response.headers.get("X-Tamburins-Collection") ?? "Make your Muse", effects: [], strength: 0 });
      })
      .catch(() => setArShareError("AR 오브젝트를 불러오지 못했습니다."))
      .finally(() => setSharedArLoading(false));
  }, []);
  const grab = (id: ObjectId) => {
    if (!BODY_MATERIAL_IDS.has(id)) void ensureObjectModel(id);
  };
  const absorb = (id: ObjectId, hitNormal: [number, number, number]) => {
    const tableTurn = turningGlassRef.current?.rotation.y ?? 0;
    setMixed((s) => (s.includes(id) ? s : [...s, id]));
    setImpacts((s) => {
      const bodyMaterial = BODY_MATERIAL_IDS.has(id);
      const clusterCount = bodyMaterial
        ? 11
        : id === "flower" || id === "lily" || id === "rose"
          ? 8
          : id === "leaf" || id === "mushroom" || id === "fruit" || id === "crystal"
            ? 7
            : 5;
      const spread = 2.55;
      const additions: PaintImpact[] = [];
      // The orbit reports a normal in the table's coordinates. Clay turns in
      // the opposite world direction, so place new growth in clay coordinates.
      const anchor = new THREE.Vector3(...hitNormal)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), 2 * tableTurn)
        .normalize();
      const reference = Math.abs(anchor.y) < 0.86
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      const tangent = new THREE.Vector3().crossVectors(reference, anchor).normalize();
      const bitangent = new THREE.Vector3().crossVectors(anchor, tangent).normalize();
      const objectSeed = [...id].reduce((value, character) => value * 31 + character.charCodeAt(0), 17);
      const randomFor = (sequence: number, salt: number) => {
        const raw = Math.sin((sequence + 1) * 12.9898 + (objectSeed + salt) * 78.233) * 43758.5453;
        return raw - Math.floor(raw);
      };
      for (let cluster = 0; cluster < clusterCount; cluster += 1) {
        const sequence = impactSequence.current++;
        let distributed: THREE.Vector3;
        if (bodyMaterial) {
          const angle = randomFor(sequence, 1) * Math.PI * 2;
          const distance = cluster === 0
            ? 0
            : spread * (0.18 + Math.sqrt(randomFor(sequence, 2)) * 0.82);
          distributed = anchor.clone().multiplyScalar(Math.cos(distance))
            .addScaledVector(tangent, Math.cos(angle) * Math.sin(distance))
            .addScaledVector(bitangent, Math.sin(angle) * Math.sin(distance))
            .normalize();
        } else if (cluster === 0) {
          distributed = anchor.clone();
        } else {
          const sampleCount = Math.max(1, clusterCount - 1);
          const sample = cluster - 1;
          const y = 1 - 2 * ((sample + 0.5) / sampleCount);
          const radial = Math.sqrt(Math.max(0, 1 - y * y));
          const angle = sample * Math.PI * (3 - Math.sqrt(5)) + randomFor(sequence, 1) * 0.7;
          const local = new THREE.Vector3(Math.cos(angle) * radial, y, Math.sin(angle) * radial);
          const alignToThrow = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), anchor);
          distributed = local.applyQuaternion(alignToThrow).normalize();
        }
        additions.push({
          key: `${id}-${sequence}`,
          id,
          normal: distributed.toArray() as [number, number, number],
          scale: 0.76 + randomFor(sequence, 3) * 0.52,
          rotation: (randomFor(sequence, 4) - 0.5) * 1.4,
        });
      }
      return [...s, ...additions];
    });
  };
  const selectedPlacements = () => mixed.flatMap((id) => {
    const impact = impacts.find((item) => item.id === id);
    return impact ? [{ id, normal: impact.normal }] : [];
  });
  const combined = mixed.length >= 2;
  const readyToDiscover = experiencePhase === "mix" && mixed.length > 0;
  const generating = generationState === "generating" || arShareState === "uploading";
  useEffect(() => {
    // The installation is a shared kiosk. A visitor's phone link keeps its
    // own session, while an idle laptop returns to the first intro.
    if (phoneRoute) return;
    let pointerX = Number.NaN;
    let pointerY = Number.NaN;
    const pointerMotion = (event: PointerEvent) => {
      if (!Number.isFinite(pointerX) || Math.hypot(event.clientX - pointerX, event.clientY - pointerY) > 12) {
        markActivity();
        pointerX = event.clientX;
        pointerY = event.clientY;
      }
    };
    window.addEventListener("pointerdown", markActivity);
    window.addEventListener("pointermove", pointerMotion, { passive: true });
    window.addEventListener("keydown", markActivity);
    window.addEventListener("wheel", markActivity, { passive: true });
    window.addEventListener("input", markActivity, true);
    const interval = window.setInterval(() => {
      // Keep the current visitor's work intact while the attract video plays.
      // Generation and QR preparation are not idle time.
      if (generating || handoffState === "creating") { markActivity(); return; }
      if (document.hidden || idleVideoOpenRef.current) return;
      if (Date.now() - lastActivityAt.current >= 60_000) {
        idleVideoOpenRef.current = true;
        setIdleVideoOpen(true);
      }
    }, 1000);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", markActivity);
      window.removeEventListener("pointermove", pointerMotion);
      window.removeEventListener("keydown", markActivity);
      window.removeEventListener("wheel", markActivity);
      window.removeEventListener("input", markActivity, true);
    };
  }, [generating, handoffState, markActivity, phoneRoute]);
  const idleVideo = idleVideoOpen && <IdleVideoOverlay onDismiss={dismissIdleVideo} />;
  const { winner, scores, appliedBonuses } = scoreCollections(mixed);
  const result = COLLECTIONS[winner];
  const sunshinePercent = Math.min(98, 72 + scores.SUNSHINE * 2);
  const resetForNextVisitor = useCallback(() => {
    nameRecognition.current?.stop?.();
    handsInput.current.forEach((handState) => {
      handState.grabbed = null;
      handState.interaction = null;
      handState.armed = false;
      handState.pinch = false;
      handState.vx = 0;
      handState.vy = 0;
    });
    setParticipantName("");
    setNameDraft("");
    setNameError("");
    setNameListening(false);
    setWaterIntroCleared(false);
    setIntroCleared(false);
    setHandStatus("loading");
    setCameraSessionKey((key) => key + 1);
    archiveOperatorKey.current = "";
    setArchiveAccessOpen(false);
    setArchiveAccessInput("");
    setSavedModelsOpen(false);
    setExperiencePhase("sculpt");
    setMixed([]);
    setImpacts([]);
    setStretchGuideDone(false);
    setClayChanged(false);
    setClayKey((key) => key + 1);
    setSessionKey((key) => key + 1);
    setResultVisible(false);
    setGeneratedWorld(null);
    setGeneratedViews(null);
    setVrResultPage(null);
    setResultFileBase("");
    setGenerationState("idle");
    setGenerationError("");
    setArShareState("idle");
    setArShareUrl("");
    setArQrImage("");
    setArShareError("");
    setAuraSaveState("idle");
    setHandoff(null);
    setHandoffState("idle");
    imageTaskIdRef.current = "";
    generationRequestedRef.current = false;
    impactSequence.current = 0;
    phaseChangedAtRef.current = performance.now();
  }, []);
  resetIdleSessionRef.current = resetForNextVisitor;

  const createPhoneHandoff = async () => {
    if (!readyToDiscover || handoffState === "creating") return;
    // Show an immediate acknowledged state before waiting for job creation,
    // network response, or QR encoding.
    setHandoff({});
    setHandoffState("creating");
    setGenerationError("");
    const silhouette = silhouetteRef.current?.();
    if (!silhouette) {
      setHandoffState("error");
      setGenerationError("조형 정보를 준비하지 못했습니다. 잠시 후 다시 눌러주세요.");
      return;
    }
    try {
      const response = await fetch("/api/muse-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          silhouette,
          name: participantName,
          collection: result.displayName,
          objects: mixed,
          placements: selectedPlacements(),
          effects: mixed,
          strength: Math.min(1, scores[winner] / 18),
        }),
      });
      const data = await response.json().catch(() => ({})) as { id?: string; url?: string; error?: string };
      if (!response.ok || !data.id || !data.url) throw new Error(data.error ?? "휴대폰 제작 링크를 만들지 못했습니다.");
      setHandoff({ id: data.id, url: data.url });
      setHandoffState("qr");
      const qr = await QRCode.toDataURL(data.url, { width: 420, margin: 2, color: { dark: "#111111", light: "#ffffff" } });
      setHandoff({ id: data.id, url: data.url, qr });
      setHandoffState("idle");
    } catch (caught) {
      setHandoffState("error");
      setGenerationError(caught instanceof Error ? caught.message : "휴대폰 제작 링크를 만들지 못했습니다.");
    }
  };

  useEffect(() => {
    if (!handoff?.id) return;
    let stopped = false;
    const checkClaimed = async () => {
      try {
        const response = await fetch(`/api/muse-jobs/${handoff.id}`, { cache: "no-store" });
        const data = await response.json() as { job?: MusePhoneJob };
        if (!stopped && data.job && data.job.status !== "waiting") resetForNextVisitor();
      } catch { /* Keep the QR visible when the status check is temporarily unavailable. */ }
    };
    const interval = window.setInterval(() => void checkClaimed(), 1200);
    void checkClaimed();
    return () => { stopped = true; window.clearInterval(interval); };
  }, [handoff?.id, resetForNextVisitor]);

  const connectSaveDirectory = async () => {
    const picker = (window as Window & { showDirectoryPicker?: () => Promise<SaveDirectoryHandle> }).showDirectoryPicker;
    if (!picker) {
      setSaveStatus("이 브라우저에서는 폴더 연결을 지원하지 않습니다");
      return;
    }
    try {
      const directory = await picker.call(window);
      const permission = directory.queryPermission
        ? await directory.queryPermission({ mode: "readwrite" })
        : "granted";
      if (permission !== "granted" && directory.requestPermission) {
        const requested = await directory.requestPermission({ mode: "readwrite" });
        if (requested !== "granted") throw new Error("폴더 쓰기 권한이 허용되지 않았습니다.");
      }
      setSaveDirectory(directory);
      autoSavedResultRef.current = "";
      autoSaveInFlightRef.current = "";
      setSaveStatus(`${directory.name} 폴더 쓰기 연결 완료`);
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : "폴더 선택이 취소되었습니다");
    }
  };
  const createResultFileBase = () => {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
    const safeName = participantName.replace(/[\\/:*?"<>|]/g, "_") || "guest";
    return `${stamp}_${safeName}_${winner}`;
  };
  const ensureDirectoryPermission = async (directory: SaveDirectoryHandle) => {
    if (!directory.queryPermission) return;
    let permission = await directory.queryPermission({ mode: "readwrite" });
    if (permission !== "granted" && directory.requestPermission) {
      permission = await directory.requestPermission({ mode: "readwrite" });
    }
    if (permission !== "granted") throw new Error("저장 폴더 쓰기 권한이 없습니다.");
  };
  const writeBlobToDirectory = async (directory: SaveDirectoryHandle, filename: string, blob: Blob) => {
    const file = await directory.getFileHandle(filename, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
  };
  const captureResultPage = async () => {
    const target = resultCaptureRef.current;
    if (!target) throw new Error("결과 화면을 찾지 못했습니다.");
    await document.fonts?.ready;
    await Promise.all(
      Array.from(target.querySelectorAll("img")).map((image) =>
        image.complete ? Promise.resolve() : image.decode().catch(() => undefined),
      ),
    );
    const captureScale = Math.min(
      2,
      window.devicePixelRatio || 1,
      4096 / Math.max(1, target.offsetWidth),
      4096 / Math.max(1, target.offsetHeight),
    );
    const canvas = await html2canvas(target, {
      backgroundColor: "#ece9e3",
      scale: captureScale,
      useCORS: true,
      logging: false,
      width: target.offsetWidth,
      height: target.offsetHeight,
      windowWidth: target.offsetWidth,
      windowHeight: target.offsetHeight,
      scrollX: 0,
      scrollY: 0,
      ignoreElements: (element) => element.hasAttribute("data-capture-ignore"),
    });
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("결과표 이미지 변환에 실패했습니다.")), "image/png"),
    );
  };
  const downloadBlob = (blob: Blob, filename: string) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  const downloadObjectImage = async () => {
    if (!generatedWorld) return;
    downloadBlob(await (await fetch(generatedWorld)).blob(), `${resultFileBase || createResultFileBase()}_OBJECT.png`);
  };
  const downloadResultPage = async () => {
    try {
      setSaveStatus("전체 결과표 이미지를 만들고 있습니다…");
      downloadBlob(await captureResultPage(), `${resultFileBase || createResultFileBase()}_RESULT.png`);
      setSaveStatus("전체 결과표 다운로드 완료");
    } catch {
      setSaveStatus("전체 결과표 다운로드에 실패했습니다");
    }
  };
  const cropTurnaroundSheet = async (sheet: string) => {
    const source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("4면도 이미지를 읽지 못했습니다."));
      image.src = sheet;
    });
    const halfWidth = Math.floor(source.naturalWidth / 2);
    const halfHeight = Math.floor(source.naturalHeight / 2);
    const crop = (column: number, row: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = halfWidth;
      canvas.height = halfHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("4면도 이미지를 분리하지 못했습니다.");
      context.drawImage(source, column * halfWidth, row * halfHeight, halfWidth, halfHeight, 0, 0, halfWidth, halfHeight);
      return canvas.toDataURL("image/png");
    };
    return { front: crop(0, 0), left: crop(1, 0), back: crop(0, 1), right: crop(1, 1) };
  };
  const createArQrForImage = async (_image: string, views = generatedViews) => {
    if (arShareState === "uploading") return;
    setArShareState("uploading");
    setTripoProgress(0);
    setArShareError("");
    try {
      const pendingTaskKey = "tamburins-pending-tripo-task";
      const readApiJson = async <T,>(response: Response): Promise<T> => {
        const text = await response.text();
        try {
          return JSON.parse(text) as T;
        } catch {
          if (response.status === 413) {
            throw new Error("3D 생성 이미지 용량이 너무 큽니다. 다시 생성해주세요.");
          }
          throw new Error(`3D 서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해주세요. (${response.status})`);
        }
      };
      const rememberTask = (taskId: string | null) => {
        try {
          if (taskId) {
            localStorage.setItem(pendingTaskKey, JSON.stringify({ taskId, collection: result.displayName, createdAt: Date.now() }));
          } else {
            localStorage.removeItem(pendingTaskKey);
          }
        } catch { /* Storage can be unavailable in privacy mode. */ }
      };
      const readRememberedTask = () => {
        try {
          const saved = JSON.parse(localStorage.getItem(pendingTaskKey) ?? "null") as { taskId?: string; collection?: string; createdAt?: number } | null;
          if (saved?.taskId && saved.collection === result.displayName && Date.now() - (saved.createdAt ?? 0) < 60 * 60 * 1000) return saved.taskId;
          rememberTask(null);
        } catch { rememberTask(null); }
        return "";
      };
      const startTask = async () => {
        const response = await fetch("/api/tripo-model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            views,
            collection: result.displayName,
            effects: mixed,
            strength: Math.min(1, scores[winner] / 18),
          }),
        });
        const created = await readApiJson<{ taskId?: string; error?: string }>(response);
        if (!response.ok || !created.taskId) throw new Error(created.error ?? "3D 생성을 시작하지 못했습니다.");
        rememberTask(created.taskId);
        return created.taskId;
      };
      const rememberedTask = readRememberedTask();
      let resumedTask = Boolean(rememberedTask);
      let taskId = rememberedTask || await startTask();
      let arUrl = "";
      for (let attempt = 0; attempt < 300; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const taskResponse = await fetch(`/api/tripo-task/${encodeURIComponent(taskId)}`);
        const task = await readApiJson<{ status?: string; progress?: number; arUrl?: string; error?: string }>(taskResponse);
        if (taskResponse.status === 404 && resumedTask) {
          rememberTask(null);
          taskId = await startTask();
          resumedTask = false;
          attempt = -1;
          continue;
        }
        if (!taskResponse.ok || task.error) {
          if (["failed", "cancelled", "banned", "expired", "unknown"].includes(task.status ?? "")) rememberTask(null);
          throw new Error(task.error ?? "3D 생성 상태를 확인하지 못했습니다.");
        }
        setTripoProgress(task.progress ?? 0);
        if (task.status === "failed" || task.status === "cancelled") throw new Error("3D 모델 생성에 실패했습니다.");
        if (task.status === "success" && task.arUrl) {
          arUrl = task.arUrl;
          rememberTask(null);
          break;
        }
      }
      if (!arUrl) throw new Error("3D 모델 생성 시간이 초과되었습니다. 다시 시도해주세요.");
      const qr = await QRCode.toDataURL(arUrl, { width: 320, margin: 2, color: { dark: "#111111", light: "#ffffff" } });
      setArShareUrl(arUrl);
      setArQrImage(qr);
      setArShareState("idle");
    } catch (error) {
      setArShareState("error");
      setArShareError(error instanceof Error ? error.message : "QR 생성에 실패했습니다.");
    }
  };
  const createArQr = async () => {
    if (!generatedWorld) return;
    await createArQrForImage(generatedWorld, generatedViews);
  };
  const saveAura = async () => {
    if (!generatedWorld || !arShareUrl || auraSaveState === "saving") return;
    setAuraSaveState("saving");
    try {
      const response = await fetch("/api/auras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: generatedWorld, name: participantName, arUrl: arShareUrl, objects: mixed }),
      });
      if (!response.ok) throw new Error();
      setAuraSaveState("saved");
    } catch {
      setAuraSaveState("error");
    }
  };
  useEffect(() => {
    if (!generatedWorld || !arShareUrl || auraSaveState !== "idle") return;
    void saveAura();
  }, [generatedWorld, arShareUrl, auraSaveState]);
  const generateAndShowResult = async () => {
    if (
      !readyToDiscover
      || generationState === "generating"
      || generationRequestedRef.current
      || performance.now() - phaseChangedAtRef.current < 800
    ) return;
    const silhouette = silhouetteRef.current?.();
    if (!silhouette) return;
    generationRequestedRef.current = true;
    setGenerationState("generating");
    setGenerationError("");
    try {
      const readImageApiJson = async <T,>(response: Response): Promise<T> => {
        const raw = await response.text();
        try { return JSON.parse(raw) as T; } catch {
          throw new Error("이미지 생성 서버 연결이 잠시 끊겼습니다. 초기화하지 말고 다시 눌러 이어서 확인해주세요.");
        }
      };
      const pollImageTask = async (taskId: string) => {
        for (let attempt = 0; attempt < 240; attempt += 1) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000));
          const response = await fetch(`/api/generate-world?taskId=${encodeURIComponent(taskId)}`);
          const data = await readImageApiJson<{ status?: string; image?: string; error?: string; terminal?: boolean }>(response);
          if (!response.ok || data.error) {
            if (data.terminal || [400, 401, 404, 502].includes(response.status)) imageTaskIdRef.current = "";
            throw new Error(data.error ?? "이미지 생성 상태를 확인하지 못했습니다.");
          }
          if (data.status === "completed" && data.image) return data.image;
        }
        throw new Error("이미지 생성 시간이 길어지고 있습니다. 초기화하지 말고 다시 눌러 이어서 확인해주세요.");
      };

      let generatedSheet = "";
      if (imageTaskIdRef.current) {
        generatedSheet = await pollImageTask(imageTaskIdRef.current);
      } else {
        const response = await fetch("/api/generate-world", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            silhouette,
            objects: mixed,
            placements: selectedPlacements(),
          }),
        });
        const data = await readImageApiJson<{ taskId?: string; status?: string; image?: string; error?: string }>(response);
        if (!response.ok || data.error) throw new Error(data.error ?? "이미지 생성을 시작하지 못했습니다.");
        if (data.image) {
          generatedSheet = data.image;
        } else if (data.taskId) {
          imageTaskIdRef.current = data.taskId;
          generatedSheet = await pollImageTask(data.taskId);
        } else {
          throw new Error("이미지 생성 작업을 시작하지 못했습니다. 다시 시도해주세요.");
        }
      }
      imageTaskIdRef.current = "";
      const views = await cropTurnaroundSheet(generatedSheet);
      const fileBase = createResultFileBase();
      setResultFileBase(fileBase);
      setGeneratedWorld(views.front);
      setGeneratedViews(views);
      setVrResultPage(null);
      setGenerationState("idle");
      setResultVisible(false);
      await createArQrForImage(views.front, views);
    } catch (error) {
      setGenerationState("error");
      setGenerationError(error instanceof Error ? error.message : "이미지 생성에 실패했습니다.");
    } finally {
      generationRequestedRef.current = false;
    }
  };
  const retryOrGenerateResult = () => {
    if (arShareState === "error" && generatedWorld && generatedViews) {
      void createArQrForImage(generatedWorld, generatedViews);
      return;
    }
    void generateAndShowResult();
  };
  useEffect(() => {
    if (!resultVisible || !generatedWorld) return;
    let cancelled = false;
    const renderFullResult = async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 350 + attempt * 350));
        try {
          const blob = await captureResultPage();
          const reader = new FileReader();
          reader.onload = () => { if (!cancelled) setVrResultPage(String(reader.result)); };
          reader.readAsDataURL(blob);
          return;
        } catch {
          // The result layout can need another frame to finish loading in WebXR.
        }
      }
    };
    void renderFullResult();
    return () => { cancelled = true; };
  }, [generatedWorld, resultVisible]);
  useEffect(() => {
    if (!resultVisible || !generatedWorld || !resultFileBase) return;
    if (!saveDirectory) {
      setSaveStatus("결과 생성 완료 · 저장 폴더를 연결하면 두 이미지가 자동 저장됩니다");
      return;
    }
    if (autoSavedResultRef.current === resultFileBase) return;
    if (autoSaveInFlightRef.current === resultFileBase) return;
    autoSaveInFlightRef.current = resultFileBase;
    const saveBothImages = async () => {
      try {
        setSaveStatus("오브젝트와 전체 결과표를 저장하고 있습니다…");
        await ensureDirectoryPermission(saveDirectory);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const objectResponse = await fetch(generatedWorld);
        if (!objectResponse.ok) throw new Error("오브젝트 이미지를 불러오지 못했습니다.");
        const objectBlob = await objectResponse.blob();
        await writeBlobToDirectory(saveDirectory, `${resultFileBase}_OBJECT.png`, objectBlob);
        setSaveStatus("오브젝트 저장 완료 · 전체 결과표를 저장하고 있습니다…");
        await new Promise((resolve) => setTimeout(resolve, 350));
        const resultBlob = await captureResultPage();
        await writeBlobToDirectory(saveDirectory, `${resultFileBase}_RESULT.png`, resultBlob);
        autoSavedResultRef.current = resultFileBase;
        setSaveStatus(`${saveDirectory.name} 폴더에 오브젝트 + 전체 결과표 저장 완료`);
      } catch (error) {
        autoSaveInFlightRef.current = "";
        const reason = error instanceof Error ? error.message : "알 수 없는 오류";
        setSaveStatus(`자동 저장 실패: ${reason}`);
      }
    };
    void saveBothImages();
  }, [generatedWorld, resultFileBase, resultVisible, saveDirectory]);
  const resetExperience = () => {
    handsInput.current.forEach((handState) => {
      handState.grabbed = null;
      handState.interaction = null;
      handState.armed = false;
      handState.pinch = false;
      handState.vx = 0;
      handState.vy = 0;
    });

    if (experiencePhase === "sculpt") {
      setClayChanged(false);
      setStretchGuideDone(false);
      setClayKey((key) => key + 1);
    } else {
      setMixed([]);
      setImpacts([]);
      imageTaskIdRef.current = "";
      impactSequence.current = 0;
      setSessionKey((key) => key + 1);
    }

    setResultVisible(false);
    setArShareUrl("");
    setArQrImage("");
    setArShareState("idle");
    setAuraSaveState("idle");
    setGeneratedWorld(null);
    setGeneratedViews(null);
    setVrResultPage(null);
    setResultFileBase("");
    setGenerationState("idle");
    setGenerationError("");
    phaseChangedAtRef.current = performance.now();
    generationRequestedRef.current = false;
    autoSavedResultRef.current = "";
    autoSaveInFlightRef.current = "";
  };
  const archiveUi = <>
    {savedModelsOpen && <AuraGallery desktop operatorKey={archiveOperatorKey.current} onClose={closeArchive} />}
    {archiveAccessOpen && <section className="archive-access-overlay" role="dialog" aria-modal="true" aria-label="운영자 보관함 접근" onKeyDown={(event) => {
      if (event.key === "Escape") { setArchiveAccessOpen(false); setArchiveAccessInput(""); }
    }}>
      <form className="archive-access-card" onSubmit={(event) => { event.preventDefault(); void verifyArchiveAccess(); }}>
        <small>TAMBURINS · OPERATOR</small>
        <h2>MUSE Archive</h2>
        <label htmlFor="archive-access-key">운영자 접근 키</label>
        <input id="archive-access-key" type="password" autoComplete="off" spellCheck={false} value={archiveAccessInput} onChange={(event) => setArchiveAccessInput(event.target.value)} autoFocus />
        {archiveAccessError && <p role="alert">{archiveAccessError}</p>}
        <div>
          <button type="button" onClick={() => { setArchiveAccessOpen(false); setArchiveAccessInput(""); }}>취소</button>
          <button type="submit" disabled={!archiveAccessInput.trim() || archiveAccessChecking}>{archiveAccessChecking ? "확인 중…" : "보관함 열기"}</button>
        </div>
      </form>
    </section>}
  </>;
  if (!routeReady) return <main className="ar-transfer-loading">MUSE를 준비하고 있습니다…</main>;
  if (museJobId) return <MobileMuseJob jobId={museJobId} />;
  if (publicArchiveOpen) return <AuraGallery savedView onClose={() => {
    const returnJob = new URLSearchParams(window.location.search).get("jobReturn");
    window.location.assign(returnJob && /^[a-f0-9]{32}$/.test(returnJob) ? `/?job=${returnJob}` : "/");
  }} />;
  if (sharedArLoading) return <main className="ar-transfer-loading">AR 오브젝트를 불러오고 있습니다…</main>;
  if (!sharedAr && !waterIntroCleared) return <><PhoneArViewer key="water-intro" waterIntro desktop interactionPaused={idleVideoOpen} backgroundImage="/design/ui/start-1.png" collection="MUSE" effects={[]} strength={0} onActivity={markActivity} onClose={() => setWaterIntroCleared(true)} />{archiveUi}{idleVideo}</>;
  if (!sharedAr && !introCleared) return <><PhoneArViewer key="muse-intro" desktop interactionPaused={idleVideoOpen} backgroundImage="/design/ui/start-2.png" modelUrl="/models/muse-stage-1.glb" modelUrls={["/models/muse-stage-1.glb", "/models/muse-stage-2.glb", "/models/muse-stage-3.glb", "/models/muse-stage-4.glb"]} collection="MUSE" effects={[]} strength={0} onActivity={markActivity} onClose={() => setIntroCleared(true)} />{archiveUi}{idleVideo}</>;
  if (sharedAr) return (
    <PhoneArViewer
      desktop={desktopViewer}
      image={sharedAr.image}
      modelUrl={sharedAr.modelUrl}
      collection={sharedAr.collection}
      effects={sharedAr.effects}
      strength={sharedAr.strength}
      onClose={() => {
        if (new URLSearchParams(window.location.search).get("introMuse") === "1") {
          const returnJob = new URLSearchParams(window.location.search).get("jobReturn");
          window.location.assign(`/?archive=1${returnJob && /^[a-f0-9]{32}$/.test(returnJob) ? `&jobReturn=${returnJob}` : ""}`);
          return;
        }
        if (sharedAr.image?.startsWith("blob:")) URL.revokeObjectURL(sharedAr.image);
        window.history.replaceState({}, "", window.location.pathname);
        setSharedAr(null);
      }}
    />
  );
  if (!participantName) return (
    <HandTrackingShell handsInput={handsInput} cameraSessionKey={cameraSessionKey} onStatus={setHandStatus} onActivity={markActivity}>
      <>
      <NameEntry
        value={nameDraft}
        error={nameError}
        listening={nameListening}
        input={nameInput}
        onChange={(value) => { setNameDraft(value); setNameError(""); }}
        onVoice={startNameVoice}
        onSubmit={submitParticipantName}
      />
      {archiveUi}
      {idleVideo}
      </>
    </HandTrackingShell>
  );
  return (
    <HandTrackingShell handsInput={handsInput} cameraSessionKey={cameraSessionKey} onStatus={setHandStatus} onActivity={markActivity}>
    <main className={`spatial-shell ${experiencePhase === "mix" ? "is-mix" : ""} ${!introCleared ? "intro-active" : ""}`}>
      {participantName && <img className="muse-stage-ui" src={experiencePhase === "sculpt" ? "/design/ui/stage-1.png?v=20261102" : "/design/ui/stage-2.png?v=20261102"} alt="" aria-hidden="true" />}
      <Canvas shadows frameloop={idleVideoOpen ? "never" : "always"} dpr={[1, 1.35]} gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping }} camera={{ position: [0, 1.6, 3.35], fov: 55 }} onCreated={({ gl }) => { gl.xr.enabled = true; gl.toneMappingExposure = 0.8; xrRenderer.current = gl; }}>
        <VRSessionButton onPresenting={setVrPresenting} />
        <XR store={xrStore}>
        <XROrigin position={[0, 0, vrPresenting && participantName ? 4.6 : 0]} />
        <KeepClayCentered phase={experiencePhase} />
        <Room />
        <hemisphereLight color="#fff7e6" groundColor="#6d692b" intensity={0.85} />
        <ambientLight color="#fff3dc" intensity={0.22} />
        <directionalLight
          position={[4.6, 8.5, 4.2]}
          color="#fff0d1"
          intensity={2.35}
          castShadow
          shadow-mapSize={[1536, 1536]}
          shadow-camera-left={-5}
          shadow-camera-right={5}
          shadow-camera-top={5}
          shadow-camera-bottom={-5}
          shadow-bias={-0.0004}
          shadow-normalBias={0.035}
          shadow-radius={6}
        />
        <pointLight position={[-4.5, 5.5, 2.4]} color="#dce76d" intensity={5.5} distance={16} />
        <directionalLight position={[-4, 4, -3]} color="#d8e3e5" intensity={0.8} />
        <group position={[0, 0.34, 0]}>
          <TurningGlass handsInput={handsInput} enabled={introCleared && !resultVisible && !generating} target={turningGlassRef} />
          <group ref={turningGlassRef} key={`glass-${sessionKey}`}>
          {experiencePhase === "mix" && VISUAL_OBJECTS.map((item, i) => <GlassContact key={`glass-contact-${item.id}`} item={item} index={i} />)}
          {VISUAL_OBJECTS.map((item, i) => (
            <ThrowableObject
              key={`${sessionKey}-${item.id}`}
              item={item}
              index={i}
              onGrab={grab}
              onMixed={absorb}
              handsInput={handsInput}
              enabled={experiencePhase === "mix" && !generating}
              visible={experiencePhase === "mix" && !generating}
            />
          ))}
          <ClayTurnSync table={turningGlassRef}>
            <Clay
              key={`clay-${clayKey}`}
              changed={() => setClayChanged(true)}
              stretched={() => setStretchGuideDone(true)}
              handsInput={handsInput}
              mixed={mixed}
              impacts={impacts}
              enabled={experiencePhase === "sculpt" && !generating}
              generatedImage={generatedWorld}
              silhouetteRef={silhouetteRef}
              objectModels={objectModelUrls}
            />
          </ClayTurnSync>
          <ResultPortal color={result.accent} visible={resultVisible} />
          </group>
        </group>
        {vrPresenting && resultVisible && vrResultPage && (
          <Suspense fallback={null}><VRResultPanel imageUrl={vrResultPage} /></Suspense>
        )}
        {vrPresenting && participantName && !resultVisible && experiencePhase === "sculpt" && (
          <VRActionButton
            label="조형 완료 · 오브젝트 선택"
            position={[0, 0.48, 2.75]}
            enabled
            onClick={enterObjectPhase}
          />
        )}
        {vrPresenting && participantName && !resultVisible && experiencePhase === "mix" && (
          <VRActionButton
            label={handoffState === "creating" || handoffState === "qr"
              ? "휴대폰 화면 준비 중..."
              : readyToDiscover
                ? "완료 · AR 만들기"
                : "오브젝트를 먼저 선택하세요"}
            position={[0, 0.48, 2.75]}
            enabled={readyToDiscover && handoffState !== "creating" && handoffState !== "qr"}
            onClick={() => void createPhoneHandoff()}
          />
        )}
        </XR>
      </Canvas>
      {!spaceReady && (
        <div className="space-loading" role="status" aria-live="polite">
          <strong>Make your Muse</strong>
          <span>공간을 불러오는 중입니다</span>
        </div>
      )}
      {spaceReady && participantName && !resultVisible && !generating && experiencePhase === "sculpt" && !stretchGuideDone && (
        <div className="main-hand-guide" aria-label="양손으로 구체를 잡고 늘려보세요.">
          {/* User-drawn open and pinched silhouettes form the complete gesture cycle on both sides. */}
          <span className="guide-hand guide-hand-left" aria-hidden="true">
            <img className="guide-hand-frame guide-hand-open" src="/design/ui/hand-silhouette-open.png?v=20261019-0138" alt="" />
            <img className="guide-hand-frame guide-hand-pinched" src="/design/ui/hand-silhouette.png?v=20261019-0138" alt="" />
          </span>
          <span className="guide-hand guide-hand-right" aria-hidden="true">
            <img className="guide-hand-frame guide-hand-open" src="/design/ui/hand-silhouette-open.png?v=20261019-0138" alt="" />
            <img className="guide-hand-frame guide-hand-pinched" src="/design/ui/hand-silhouette.png?v=20261019-0138" alt="" />
          </span>
        </div>
      )}
      {participantName && <header className="world-hud">
        <span>Make your Muse</span>
      </header>}
      {participantName && <aside className="world-instruction">
        <span>{experiencePhase === "sculpt" ? "01 Shape" : "02 Object"}</span>
        <p>
          {resultVisible
            ? "당신이 만든 형태와 가장 가까운 탬버린즈 컬렉션이 나타났습니다."
            : experiencePhase === "sculpt"
            ? "먼저 중앙 구체에 엄지와 검지를 맞대어 잡고 원하는 방향으로 늘려 형태를 만드세요. 양손으로 서로 다른 지점을 동시에 당길 수 있습니다."
            : !combined
            ? "원하는 오브젝트를 잡거나 클릭해 선택하세요. 개수 제한 없이 선택할 수 있고 던지지 않아도 됩니다."
            : "오브젝트를 더 조합하거나 완료 버튼을 눌러 결과를 확인하세요."}
        </p>
      </aside>}

      {archiveUi}
      {idleVideo}
      {participantName && <div className="experience-actions">
        <button className="reset-experience muse-reset" onClick={resetExperience}>초기화</button>

        {experiencePhase === "sculpt" ? (
          <button
            type="button"
            className="discover-result muse-select"
            onClick={enterObjectPhase}
          >
            조형 완료 · 오브젝트 선택
          </button>
        ) : (
          <button
            type="button"
            className="discover-result muse-complete"
            disabled={!readyToDiscover || handoffState === "creating" || handoffState === "qr"}
            onClick={() => void createPhoneHandoff()}
          >
            {handoffState === "creating" || handoffState === "qr"
              ? "휴대폰 화면을 준비하고 있습니다…"
              : readyToDiscover
                ? "완료 · AR 만들기"
                : "오브젝트를 먼저 선택하세요"}
          </button>
        )}
      </div>}
      {handoff && (
        <section className="muse-handoff-overlay" aria-label="휴대폰 제작 QR 코드">
          <div className="muse-handoff-card">
            <small>CONTINUE ON YOUR PHONE</small>
            <h2>{handoffState === "error" ? "휴대폰 화면을 열지 못했습니다" : handoff.qr ? "휴대폰으로 QR을 스캔하세요" : "완성했어요"}</h2>
            <p>{handoffState === "error"
              ? generationError || "연결을 만들지 못했습니다. 다시 시도해주세요."
              : handoff.qr
                ? <>이미지와 3D 제작은 휴대폰에서 이어집니다.<br />스캔이 확인되면 이 화면은 다음 사람을 위해 자동으로 초기화됩니다.</>
                : "휴대폰 연결을 준비하고 있습니다. 잠시만 기다려주세요."}</p>
            {handoff.qr && handoff.url
              ? <a href={handoff.url} target="_blank" rel="noreferrer" aria-label="휴대폰 제작 페이지 열기">
                  <img src={handoff.qr} alt="휴대폰 MUSE 제작 링크 QR 코드" />
                </a>
              : <div className="muse-handoff-loading" role="status" aria-live="polite">
                  <span className="generation-wait-spinner" aria-hidden="true" />
                  <span>{handoffState === "error" ? "연결 오류" : "준비 중"}</span>
                </div>}
            {handoffState === "error" && <button type="button" onClick={() => void createPhoneHandoff()}>다시 시도</button>}
            <button type="button" onClick={resetForNextVisitor}>처음으로</button>
          </div>
        </section>
      )}
      {generating && <section className="muse-mobile-overlay" role="status" aria-live="polite" aria-label="뮤즈 생성 중">
        <div className="muse-mobile-card muse-generating-card">
          <img className="muse-mobile-artwork" src="/design/ui/ar-loading.png" alt="당신의 뮤즈를 만들고 있어요" />
          <div className="muse-generation-live"><div className="generation-wait-spinner" aria-hidden="true" />
            <span>{arShareState === "uploading" ? `${tripoProgress}%` : "잠시만 기다려주세요"}</span>
          </div>
        </div>
      </section>}      {generationState === "error" && <p className="generation-error">{generationError}</p>}
      {resultVisible && winner === "SUNSHINE" && (
        <section className="sunshine-result-board" aria-label="SUNSHINE collection result">
          <button className="sunshine-result-close" data-capture-ignore onClick={() => setResultVisible(false)}>BACK <span>×</span></button>
          <div className="sunshine-save-controls" data-capture-ignore>
            <span>{saveStatus}</span>
            <button onClick={downloadObjectImage}>오브젝트만 다운로드</button>
            <button onClick={downloadResultPage}>결과표 전체 다운로드</button>
            <button onClick={createArQr} disabled={!generatedWorld || arShareState === "uploading"}>{arShareState === "uploading" ? "QR 만드는 중…" : "휴대폰 AR QR"}</button>
          </div>
          <div className="sunshine-result-canvas" ref={resultCaptureRef as React.RefObject<HTMLDivElement | null>}>
            <img className="sunshine-result-background" src="/results/sunshine-layout.jpg" alt="" />
            <h2 className="sunshine-personal-title">
              당신의 취향에 맞는 탬버린즈 컬렉션은 SUNSHINE이에요.
            </h2>
            <p className="sunshine-personal-subtitle">
              당신이 만든 MUSE는 SUNSHINE의 빛나는 갑옷과 밝은 에너지, 플로럴과 금속성이 공존하는 세계와 가장 높은 유사도를 보여요.
            </p>
            {generatedWorld && (
              <img className="sunshine-aura-image" src={generatedWorld} alt="생성된 MUSE" />
            )}
            <div className="sunshine-aura-copy">
              <strong>당신은 빛과 구조가 공존하는 타입입니다.</strong>
              <p>선택에서는 선명함, 단단함, 빛, 금속성이 강하게 나타났어요.<br />부드럽고 흐르는 것보다 형태가 분명한 존재감 있는 오브젝트에 끌리는 편이며,<br />자연적인 요소 안에서도 정제되고 미래적인 분위기를 선호합니다.</p>
            </div>
            <div className="sunshine-keywords" aria-label="MUSE keywords">
              {['Bright', 'Metallic', 'Sharp', 'Strong'].map((keyword) => <span key={keyword}>{keyword}</span>)}
            </div>
            <strong className="sunshine-match-value">SUNSHINE {sunshinePercent}%</strong>
            <div className="sunshine-trait-bars">
              {[
                ['METALLIC', '금속성', 82, 'ORGANIC', '자연성'],
                ['BRIGHT', '밝음', 88, 'MUTED', '차분함'],
                ['STRUCTURED', '구조적', 76, 'FLOWING', '유동적'],
                ['SHARP', '선명함', 79, 'SOFT', '부드러움'],
              ].map(([left, leftKo, value, right, rightKo]) => (
                <div className="sunshine-trait" key={String(left)}>
                  <span className="sunshine-trait-left">{left}<em>{leftKo}</em></span>
                  <div className="sunshine-trait-track"><i style={{ width: `${value}%` }} /></div>
                  <small>{value}%</small>
                  <span className="sunshine-trait-right">{right}<em>{rightKo}</em></span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
      {resultVisible && winner !== "SUNSHINE" && (
        <section
          className="world-result"
          ref={resultCaptureRef}
          style={{ "--result-accent": result.accent } as React.CSSProperties}
        >
          <button className="result-close" data-capture-ignore onClick={() => setResultVisible(false)}>
            BACK TO SCULPTURE <span>×</span>
          </button>
          <div className="result-save-controls" data-capture-ignore>
            <span>{saveStatus}</span>
            <button onClick={downloadObjectImage}>오브젝트만 다운로드</button>
            <button onClick={downloadResultPage}>결과표 전체 다운로드</button>
            <button onClick={createArQr} disabled={!generatedWorld || arShareState === "uploading"}>{arShareState === "uploading" ? "QR 만드는 중…" : "휴대폰 AR QR"}</button>
          </div>
          <div className="result-overview">
            <small>Make your Muse / 01</small>
            {generatedWorld && (
              <div className="result-created-artifact">
                <img src={generatedWorld} alt="클레이와 오브젝트로 생성된 결과" />
                <span>YOUR GENERATED ARTIFACT</span>
              </div>
            )}
            <div className="result-hero">
              <img src={result.heroImage} alt={`${result.displayName} official collection visual`} />
              <span>OFFICIAL COLLECTION VISUAL</span>
            </div>
            <p className="personal-result-copy">당신의 취향에 맞는 컬렉션이에요.</p>
            <strong>{result.displayName}</strong>
            <p>{result.description}</p>
            <div className="result-key-notes" aria-label="Collection key notes">
              {result.keyNotes.map((note) => <span key={note}>{note}</span>)}
            </div>
            <div className="result-match-data">
              <span>MATCH SCORE {scores[winner]}</span>
              <span>{mixed.map((id) => VISUAL_OBJECTS.find((item) => item.id === id)?.name).join(" + ")}</span>
              {appliedBonuses.length > 0 && (
                <span>COMBINATION BONUS +{appliedBonuses.reduce((sum, bonus) => sum + bonus.points, 0)}</span>
              )}
            </div>
          </div>
          <div className="result-profile">
            <small>COLLECTION CHARACTER / 02</small>
            <h3>THIS WORLD FEELS LIKE</h3>
            <ul>
              {result.characteristics.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <small className="scent-heading">SENSORY NOTES</small>
            <div className="scent-notes">
              {result.scentNotes.map((note, index) => (
                <span key={note}><b>0{index + 1}</b>{note}</span>
              ))}
            </div>
          </div>
          <div className="result-catalogue">
            <div className="catalogue-heading">
              <small>{result.productLabel} / 03</small>
              <span>{result.products.length} FORMATS</span>
            </div>
            <div className="product-grid">
              {result.products.map((product, index) => (
                <article key={`${product.type}-${product.name}`}>
                  {result.productImages[index] ? (
                    <div className="product-image">
                      <img src={result.productImages[index]} alt={product.name} />
                    </div>
                  ) : (
                    <div className={`product-silhouette product-shape-${index % 4}`}><i /></div>
                  )}
                  <small>{product.type} / 0{index + 1}</small>
                  <b>{product.name}</b>
                  <span>{product.detail}</span>
                </article>
              ))}
            </div>
            {result.collectionUrl ? (
              <a href={result.collectionUrl} target="_blank" rel="noreferrer">
                EXPLORE OFFICIAL COLLECTION <span>↗</span>
              </a>
            ) : (
              <p className="concept-note">PROJECT CONCEPT WORLD — 제품 형식은 체험 결과를 위한 제안입니다.</p>
            )}
          </div>
        </section>
      )}
      {!generating && generatedViews && arQrImage && arShareUrl && (
        <section className="muse-mobile-overlay" aria-label="휴대폰 AR QR 코드">
          <div className="muse-mobile-card muse-ready-card">
            <img className="muse-mobile-artwork" src="/design/ui/ar-ready.png" alt="손 위로 당신의 뮤즈를 옮겨보세요" />
            <a className="muse-qr-live" href={arShareUrl} target="_blank" rel="noreferrer" aria-label="휴대폰 AR 열기">
              <img src={arQrImage} alt="뮤즈 AR 링크 QR 코드" />
            </a>
            <button
              className="muse-save-hotspot"
              type="button"
              data-state={auraSaveState}
              onClick={() => void saveAura()}
              disabled={auraSaveState === "saving" || auraSaveState === "saved"}
              aria-label={auraSaveState === "saved" ? "3D와 이미지 저장 완료" : "3D와 이미지 함께 저장"}
              aria-live="polite"
            >
              <span>{auraSaveState === "saving" ? "SAVING…" : auraSaveState === "saved" ? "MUSE SAVED ✓" : auraSaveState === "error" ? "RETRY SAVE" : "MUSE SAVE"}</span>
            </button>
            {auraSaveState === "error" && <p role="alert">저장하지 못했습니다. 다시 눌러주세요.</p>}
          </div>
        </section>
      )}      {arShareError && <p className="ar-share-error">{arShareError}</p>}
    </main>
    </HandTrackingShell>
  );
}
