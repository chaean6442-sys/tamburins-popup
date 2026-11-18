/**
 * WaterSimulation.js
 * 절제되고 우아한 액체 글래스 수면 시뮬레이션
 * - 사람이 가만히 있으면 수면이 즉시 완전한 고요(Stillness) 상태로 복귀
 * - 움직임에만 유려하게 반응하는 점성 파동 및 굴절 셰이더
 */

import * as THREE from 'three';

export class WaterSimulation {
  constructor(container, backgroundImageSrc = '/시작화면_1.png') {
    this.container = container;
    this.simRes = 512;

    this.initScene();
    this.initDisturbanceCanvas();
    this.initFBOs();
    this.initShaders();
    this.loadBackground(backgroundImageSrc);

    window.addEventListener('resize', this.onResize);
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.quadGeo = new THREE.PlaneGeometry(2, 2);
  }

  initDisturbanceCanvas() {
    this.distCanvas = document.createElement('canvas');
    this.distCanvas.width = 256;
    this.distCanvas.height = 256;
    this.distCtx = this.distCanvas.getContext('2d');
    this.distCtx.fillStyle = '#000000';
    this.distCtx.fillRect(0, 0, 256, 256);

    this.distTexture = new THREE.CanvasTexture(this.distCanvas);
    this.distTexture.minFilter = THREE.LinearFilter;
    this.distTexture.magFilter = THREE.LinearFilter;
    this.hasDisturbance = false;
  }

  initFBOs() {
    const type = /(iPad|iPhone|iPod)/g.test(navigator.userAgent)
      ? THREE.HalfFloatType
      : THREE.FloatType;

    const opt = {
      format: THREE.RGBAFormat,
      type: type,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false
    };

    this.fboA = new THREE.WebGLRenderTarget(this.simRes, this.simRes, opt);
    this.fboB = new THREE.WebGLRenderTarget(this.simRes, this.simRes, opt);

    this.currentFBO = this.fboA;
    this.previousFBO = this.fboB;
  }

  initShaders() {
    // 1. 파동 전파 시뮬레이션
    this.simMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCurrent: { value: null },
        uDisturbance: { value: this.distTexture },
        uDelta: { value: new THREE.Vector2(1.0 / this.simRes, 1.0 / this.simRes) },
        // 사람이 멈추면 1.2초 내에 고요해지도록 적정 감쇠(0.955) 설정
        uDamping: { value: 0.955 },
        uDistStrength: { value: 0.72 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uCurrent;
        uniform sampler2D uDisturbance;
        uniform vec2 uDelta;
        uniform float uDamping;
        uniform float uDistStrength;
        varying vec2 vUv;

        void main() {
          vec2 dx = vec2(uDelta.x, 0.0);
          vec2 dy = vec2(0.0, uDelta.y);

          float left  = texture2D(uCurrent, vUv - dx).r;
          float right = texture2D(uCurrent, vUv + dx).r;
          float up    = texture2D(uCurrent, vUv + dy).r;
          float down  = texture2D(uCurrent, vUv - dy).r;

          vec4 cur = texture2D(uCurrent, vUv);
          float curH = cur.r;
          float prevH = cur.g;

          // 2D 파동 방정식
          float nextH = (left + right + up + down) * 0.5 - prevH;
          nextH *= uDamping;

          // 사람 움직임 입력 반영
          float dist = texture2D(uDisturbance, vUv).r;
          nextH += dist * uDistStrength;

          // 미세한 부동소수점 노이즈 컷오프 (완전한 고요 보장)
          if (abs(nextH) < 0.0008) nextH = 0.0;

          gl_FragColor = vec4(nextH, curH, 0.0, 1.0);
        }
      `
    });

    this.simMesh = new THREE.Mesh(this.quadGeo, this.simMaterial);
    this.simScene = new THREE.Scene();
    this.simScene.add(this.simMesh);

    // 2. 최종 렌더 셰이더 (액체 굴절 & 하이라이트)
    this.renderMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uWave: { value: null },
        uBackground: { value: null },
        uDelta: { value: new THREE.Vector2(1.0 / this.simRes, 1.0 / this.simRes) },
        uRefraction: { value: 0.04 },   // 참고 영상처럼 움직임의 굴절 형태를 더 선명하게
        uBump: { value: 5.8 },          // 사람과 손이 지나간 자리에 또렷한 수면 기울기
        uTime: { value: 0 },
        uAspectScreen: { value: window.innerWidth / window.innerHeight },
        uAspectBg: { value: 5649.0 / 3178.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uWave;
        uniform sampler2D uBackground;
        uniform vec2 uDelta;
        uniform float uRefraction;
        uniform float uBump;
        uniform float uTime;
        uniform float uAspectScreen;
        uniform float uAspectBg;
        varying vec2 vUv;

        vec2 getCoverUv(vec2 uv) {
          vec2 scale = vec2(1.0);
          if (uAspectScreen > uAspectBg) {
            scale = vec2(1.0, uAspectScreen / uAspectBg);
          } else {
            scale = vec2(uAspectBg / uAspectScreen, 1.0);
          }
          return (uv - 0.5) * scale + 0.5;
        }

        void main() {
          vec2 dx = vec2(uDelta.x, 0.0);
          vec2 dy = vec2(0.0, uDelta.y);

          float hL = texture2D(uWave, vUv - dx).r;
          float hR = texture2D(uWave, vUv + dx).r;
          float hD = texture2D(uWave, vUv - dy).r;
          float hU = texture2D(uWave, vUv + dy).r;

          vec2 ambientWave = vec2(
            sin(vUv.y * 13.0 + uTime * 0.62) + sin((vUv.x + vUv.y) * 8.0 - uTime * 0.41),
            cos(vUv.x * 15.0 - uTime * 0.55) + cos((vUv.x - vUv.y) * 9.0 + uTime * 0.36)
          ) * 0.012;
          vec3 normal = normalize(vec3((hL - hR) * uBump + ambientWave.x, (hD - hU) * uBump + ambientWave.y, 1.0));

          // 1. 프리즘 색수차 굴절
          vec2 baseUv = vUv;
          vec2 offsetR = normal.xy * (uRefraction * 1.20);
          vec2 offsetG = normal.xy * (uRefraction * 1.00);
          vec2 offsetB = normal.xy * (uRefraction * 0.80);

          vec2 uvR = clamp(getCoverUv(baseUv + offsetR), 0.001, 0.999);
          vec2 uvG = clamp(getCoverUv(baseUv + offsetG), 0.001, 0.999);
          vec2 uvB = clamp(getCoverUv(baseUv + offsetB), 0.001, 0.999);

          float r = texture2D(uBackground, uvR).r;
          float g = texture2D(uBackground, uvG).g;
          float b = texture2D(uBackground, uvB).b;
          vec3 col = vec3(r, g, b);

          // 2. 스펙큘러 하이라이트 (물 표면 반사광)
          vec3 lightDir = normalize(vec3(0.35, 0.65, 0.75));
          vec3 viewDir = vec3(0.0, 0.0, 1.0);
          vec3 halfVec = normalize(lightDir + viewDir);
          float NdotH = max(dot(normal, halfVec), 0.0);
          float spec = pow(NdotH, 36.0) * 1.4;

          // 3. 메니스커스 림 (은은한 수면 외곽선)
          float rim = pow(1.0 - normal.z, 2.4);
          col *= (1.0 - rim * 0.35);
          float shimmer = (sin((vUv.x * 1.3 + vUv.y) * 22.0 + uTime * 0.7) * 0.5 + 0.5) * (1.0 - normal.z) * 0.08;
          col += vec3(spec * 0.78 + shimmer);

          gl_FragColor = vec4(col, 1.0);
        }
      `
    });

    this.renderMesh = new THREE.Mesh(this.quadGeo, this.renderMaterial);
    this.scene.add(this.renderMesh);
  }

  loadBackground(imageSrc) {
    const loader = new THREE.TextureLoader();
    loader.load(imageSrc, (tex) => {
      if (this.disposed) { tex.dispose(); return; }
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      this.renderMaterial.uniforms.uBackground.value = tex;
    });
  }

  /**
   * 움직임에 따른 부드러운 파동 충격 주입
   */
  addDisturbance(x, y, radius = 14, intensity = 0.5) {
    const ctx = this.distCtx;
    const px = x * 256;
    const py = y * 256;

    const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
    grad.addColorStop(0, `rgba(255, 255, 255, ${intensity})`);
    grad.addColorStop(0.5, `rgba(255, 255, 255, ${intensity * 0.4})`);
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();

    this.hasDisturbance = true;
  }

  update() {
    // 1. 이번 프레임의 새로운 모션 입력 텍스처 전송
    this.distTexture.needsUpdate = true;

    // 2. 파동 전파 연산
    this.simMaterial.uniforms.uCurrent.value = this.previousFBO.texture;
    this.renderer.setRenderTarget(this.currentFBO);
    this.renderer.render(this.simScene, this.camera);

    // 3. 디스커버리 캔버스 완전 초기화 (새로운 움직임이 없을 때 잔류 파동 주입 원천 차단)
    this.distCtx.fillStyle = '#000000';
    this.distCtx.fillRect(0, 0, 256, 256);
    this.hasDisturbance = false;

    // 4. 화면 출력 렌더
    this.renderMaterial.uniforms.uWave.value = this.currentFBO.texture;
    this.renderMaterial.uniforms.uTime.value = performance.now() * 0.001;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);

    // 5. FBO 스왑
    const temp = this.currentFBO;
    this.currentFBO = this.previousFBO;
    this.previousFBO = temp;
  }

  onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.renderMaterial.uniforms.uAspectScreen.value = w / h;
  };

  dispose() {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.renderMaterial.uniforms.uBackground.value?.dispose();
    this.renderMaterial.dispose();
    this.simMaterial.dispose();
    this.quadGeo.dispose();
    this.distTexture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.fboA.dispose();
    this.fboB.dispose();
  }
}
