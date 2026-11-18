"use client";

import { useEffect, useRef, type RefObject } from "react";
import { WaterSimulation } from "./anti/WaterSimulation.js";

type ConfidenceMask = {
  width: number;
  height: number;
  getAsFloat32Array: () => Float32Array;
};

type SegmenterResult = { confidenceMasks?: ConfidenceMask[] };

type Segmenter = {
  segmentForVideo: (video: HTMLVideoElement, timestamp: number, callback: (result: SegmenterResult) => void) => void;
  close: () => void;
};

const clamp = (value: number, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));

export function AntiWaterSurface({
  video,
  onPersonDetected,
}: {
  video: RefObject<HTMLVideoElement | null>;
  onPersonDetected?: (detected: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onPersonDetected);

  useEffect(() => { callbackRef.current = onPersonDetected; }, [onPersonDetected]);

  useEffect(() => {
    const host = container.current;
    const camera = video.current;
    if (!host || !camera) return;

    const water = new WaterSimulation(host, "/design/ui/start-1.png");
    let segmenter: Segmenter | null = null;
    let disposed = false;
    let frame = 0;
    let segmentationBusy = false;
    let previousMask: Float32Array | null = null;
    let previousWidth = 0;
    let previousHeight = 0;
    let lastSegmentation = 0;
    let lastDetected = false;
    let nextAmbientRipple = 0;
    let ambientStep = 0;

    const processPersonMask = (result: SegmenterResult) => {
      const mask = result.confidenceMasks?.[1] ?? result.confidenceMasks?.[0];
      if (!mask) return;
      const values = mask.getAsFloat32Array();
      const width = mask.width;
      const height = mask.height;
      const compatiblePrevious = previousMask && previousWidth === width && previousHeight === height ? previousMask : null;
      const cellsAcross = 12;
      const cellsDown = 8;
      const cells = Array.from({ length: cellsAcross * cellsDown }, () => ({ occupancy: 0, change: 0, samples: 0 }));
      let personPixels = 0;

      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
          const index = y * width + x;
          const confidence = clamp((values[index] - 0.2) / 0.58);
          const before = compatiblePrevious ? clamp((compatiblePrevious[index] - 0.2) / 0.58) : confidence;
          const column = Math.min(cellsAcross - 1, Math.floor(x / width * cellsAcross));
          const row = Math.min(cellsDown - 1, Math.floor(y / height * cellsDown));
          const cell = cells[row * cellsAcross + column];
          cell.occupancy += confidence;
          cell.change += Math.abs(confidence - before);
          cell.samples += 1;
          if (confidence > 0.46) personPixels += 1;
        }
      }

      const detected = personPixels > (width * height / 4) * 0.018;
      if (detected !== lastDetected) {
        lastDetected = detected;
        callbackRef.current?.(detected);
      }

      if (detected && compatiblePrevious) {
        cells
          .map((cell, index) => ({
            index,
            occupancy: cell.occupancy / Math.max(1, cell.samples),
            change: cell.change / Math.max(1, cell.samples),
          }))
          .filter((cell) => cell.occupancy > 0.09 && cell.change > 0.018)
          .sort((a, b) => (b.change * (0.45 + b.occupancy)) - (a.change * (0.45 + a.occupancy)))
          .slice(0, 9)
          .forEach((cell) => {
            const column = cell.index % cellsAcross;
            const row = Math.floor(cell.index / cellsAcross);
            const x = 1 - (column + 0.5) / cellsAcross;
            const y = (row + 0.5) / cellsDown;
            const force = clamp(cell.change * 4.5 + cell.occupancy * 0.15, 0.1, 0.62);
            water.addDisturbance(x, y, 14 + force * 14, force);
          });
      }

      previousMask = new Float32Array(values);
      previousWidth = width;
      previousHeight = height;
    };

    void (async () => {
      try {
        const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
        const vision = await FilesetResolver.forVisionTasks("/mediapipe/vision/wasm");
        const options = {
          baseOptions: {
            modelAssetPath: "/mediapipe/vision/selfie_segmenter_landscape.tflite",
            delegate: "GPU" as const,
          },
          runningMode: "VIDEO" as const,
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        };
        try {
          segmenter = await ImageSegmenter.createFromOptions(vision, options) as unknown as Segmenter;
        } catch {
          segmenter = await ImageSegmenter.createFromOptions(vision, {
            ...options,
            baseOptions: { modelAssetPath: options.baseOptions.modelAssetPath, delegate: "CPU" as const },
          }) as unknown as Segmenter;
        }
        if (disposed) segmenter.close();
      } catch (error) {
        console.error("Person silhouette tracking failed", error);
      }
    })();

    const render = (now: number) => {
      if (!document.hidden) {
        if (segmenter && !segmentationBusy && now - lastSegmentation >= 74 && camera.readyState >= 2 && !camera.paused) {
          segmentationBusy = true;
          lastSegmentation = now;
          try {
            segmenter.segmentForVideo(camera, now, (result) => {
              try { processPersonMask(result); }
              finally { segmentationBusy = false; }
            });
          } catch {
            segmentationBusy = false;
          }
        }
        if (now >= nextAmbientRipple) {
          const x = 0.5 + Math.sin(ambientStep * 2.17) * 0.28;
          const y = 0.5 + Math.cos(ambientStep * 1.63) * 0.24;
          water.addDisturbance(x, y, 9 + ambientStep % 3, 0.045);
          ambientStep += 1;
          nextAmbientRipple = now + 1350 + (ambientStep % 4) * 190;
        }
        water.update();
      }
      frame = requestAnimationFrame(render);
    };

    let previousPointer = { x: 0, y: 0 };
    const move = (event: PointerEvent) => {
      const bounds = host.getBoundingClientRect();
      const x = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width));
      const y = clamp((event.clientY - bounds.top) / Math.max(1, bounds.height));
      const speed = Math.hypot(x - previousPointer.x, y - previousPointer.y);
      previousPointer = { x, y };
      water.addDisturbance(x, y, 14 + Math.min(14, speed * 110), Math.min(0.62, 0.14 + speed * 2.4));
    };

    window.addEventListener("pointermove", move);
    frame = requestAnimationFrame(render);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      segmenter?.close();
      if (lastDetected) callbackRef.current?.(false);
      water.dispose();
    };
  }, [video]);

  return <div ref={container} className="anti-water-surface" aria-hidden="true" />;
}
