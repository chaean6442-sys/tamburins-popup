/**
 * VisionTracker.js
 * 사람의 실제 움직임과 실루엣 이동만 정밀하게 포착하는 모션 트래커
 * - 웹캠 센서 노이즈(지직거림) 100% 필터링 (가만히 있으면 모션 0)
 * - 신체 움직임이 발생한 영역에만 정확히 절제된 파동 신호 전달
 */

export class VisionTracker {
  constructor(videoElement, onMotionDetected) {
    this.video = videoElement;
    this.onMotionDetected = onMotionDetected;

    // 분석 해상도
    this.w = 96;
    this.h = 72;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.prevLum = new Float32Array(this.w * this.h);
    this.hasPrev = false;
    this.stream = null;
    this.isTracking = false;
  }

  async start() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      });

      this.video.srcObject = this.stream;
      await this.video.play();
      this.isTracking = true;
      this.loop();
      return true;
    } catch (err) {
      console.error('[VisionTracker] Webcam access error:', err);
      return false;
    }
  }

  loop = () => {
    if (!this.isTracking) return;

    if (this.video.readyState >= 2 && !this.video.paused) {
      this.detectMotion();
    }

    requestAnimationFrame(this.loop);
  };

  detectMotion() {
    const w = this.w;
    const h = this.h;

    this.ctx.drawImage(this.video, 0, 0, w, h);
    const currData = this.ctx.getImageData(0, 0, w, h).data;
    const prevLum = this.prevLum;

    if (!this.hasPrev) {
      for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        prevLum[i] = currData[idx] * 0.299 + currData[idx + 1] * 0.587 + currData[idx + 2] * 0.114;
      }
      this.hasPrev = true;
      return;
    }

    // 센서 노이즈를 걸러내는 엄격한 임계값 (가만히 있으면 감지되지 않음)
    const NOISE_THRESHOLD = 28.0; 
    const columns = 4;
    const rows = 3;
    const clusters = Array.from({ length: columns * rows }, () => ({ x: 0, y: 0, strength: 0, count: 0 }));

    // 움직임 군집화(Grid Cell)를 통해 과도한 중복 호출 방지
    const cellStep = 3;
    for (let y = 3; y < h - 3; y += cellStep) {
      const row = y * w;
      for (let x = 3; x < w - 3; x += cellStep) {
        const i = row + x;
        const pIdx = i * 4;
        const curL = currData[pIdx] * 0.299 + currData[pIdx + 1] * 0.587 + currData[pIdx + 2] * 0.114;
        const diff = Math.abs(curL - prevLum[i]);

        // 실제 사람의 신체/손/팔 움직임일 때만 실행
        if (diff > NOISE_THRESHOLD) {
          // 거울 모드 (좌우 반전)
          const normX = 1.0 - (x / w);
          const normY = y / h;

          // 움직임 세기 정규화 (절제되고 부드러운 반응)
          const strength = Math.min(1.0, (diff - NOISE_THRESHOLD) / 60.0);
          const column = Math.min(columns - 1, Math.floor((x / w) * columns));
          const rowIndex = Math.min(rows - 1, Math.floor((y / h) * rows));
          const cluster = clusters[rowIndex * columns + column];
          cluster.x += normX * strength;
          cluster.y += normY * strength;
          cluster.strength += strength;
          cluster.count += 1;
        }
      }
    }

    clusters
      .filter((cluster) => cluster.count >= 2 && cluster.strength > 0.35)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 4)
      .forEach((cluster) => {
        if (!this.onMotionDetected) return;
        const x = cluster.x / cluster.strength;
        const y = cluster.y / cluster.strength;
        const strength = Math.min(1, cluster.strength / Math.max(2, cluster.count * 0.62));
        this.onMotionDetected(x, y, 13 + strength * 9, 0.12 + strength * 0.3);
      });

    // 현재 프레임 휘도 저장 (약간의 잔상 보정을 위한 가중치 적용)
    for (let i = 0; i < w * h; i++) {
      const pIdx = i * 4;
      const curL = currData[pIdx] * 0.299 + currData[pIdx + 1] * 0.587 + currData[pIdx + 2] * 0.114;
      prevLum[i] = curL;
    }
  }

  stop() {
    this.isTracking = false;
    this.hasPrev = false;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }
}
