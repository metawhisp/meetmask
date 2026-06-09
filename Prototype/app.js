import * as THREE from 'three';
import { EFFECTS, CATEGORIES } from './effects/index.js';
import { paintPreview } from './effects/core/previews.js';
import { createEngineCamera } from './effects/core/engineCamera.js';

// Headless-engine (offscreen CEF) mode — masks load the page with ?engine=1.
// A raw <video> never decodes offscreen, so the camera is pumped into a canvas.
const ENGINE = new URLSearchParams(location.search).get('engine') === '1';

const $ = (id) => document.getElementById(id);

const dom = {
  body: document.body,
  cam: $('cam'),
  canvas: $('c'),
  start: $('start'),
  back: $('back'),
  switchCamera: $('switchCamera'),
  capture: $('capture'),
  captureNotice: $('captureNotice'),
  hud: $('hud'),
  launcher: $('launcher'),
  contactDock: $('contactDock'),
  contactBtn: $('contactBtn'),
  emailBtn: $('emailBtn'),
  closeContactBtn: $('closeContactBtn'),
};

const state = {
  facing: 'user',          // 'user' | 'environment'
  stream: null,
  activeEffect: null,
  view: 'start',           // 'start' | 'launcher' | 'content'
  renderer: null,
  scene: null,
  camera: null,
  videoTexture: null,
  camCanvas: null,        // engine mode: pumped webcam frames (acts as the <video>)
  rafId: 0,
  lastTime: 0,
  recorder: null,
  recordChunks: [],
  recording: false,
};

// ============================ Bootstrap ============================

function init() {
  if (ENGINE) {
    // Headless mask: only the effect canvas (+ camera background) should reach the
    // virtual camera — hide all launcher / HUD / button chrome, and keep the raw
    // <video> behind everything (it's only the MediaPipe pump source).
    const s = document.createElement('style');
    s.textContent =
      '#back,#switchCamera,#capture,#captureNotice,#hud,#contactDock,#contactBtn,#launcher,#start{display:none!important}'
      + '#cam{z-index:-1!important}';
    document.head.appendChild(s);
  }
  setupRenderer();
  buildLauncher();
  bindUI();
  setView('start');
  window.addEventListener('resize', onResize);

  // ?autostart=<EffectId> jumps straight into an effect once the camera comes up.
  const auto = new URLSearchParams(location.search).get('autostart');
  if (auto) {
    setTimeout(async () => {
      dom.start.classList.add('hidden');
      setView('launcher');
      await startCamera(state.facing);
      const eff = EFFECTS.find((e) => e.id === auto);
      if (eff) activateEffect(eff);
    }, 50);
  }
}

function setupRenderer() {
  const renderer = new THREE.WebGLRenderer({
    canvas: dom.canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  state.renderer = renderer;

  state.scene = new THREE.Scene();
  state.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  onResize();
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  state.renderer.setSize(w, h, false);
  if (state.activeEffect && state.activeEffect.resize) {
    state.activeEffect.resize(w, h);
  }
}

// ============================ Camera ============================

async function startCamera(facing) {
  stopCamera();
  // Headless engine: pump the webcam into a canvas that masquerades as the <video>.
  if (ENGINE) {
    // Diagnostic: ?fake=1 uses a known asymmetric pattern (TOP/BOTTOM/L/R/F) as the
    // camera instead of the webcam, so orientation (Y-flip / X-mirror) can be verified
    // from the rendered frame without a live camera.
    if (new URLSearchParams(location.search).get('fake') === '1') {
      if (!state.camCanvas) state.camCanvas = makeTestCamCanvas();
      return;
    }
    if (!state.camCanvas) {
      try {
        state.camCanvas = await createEngineCamera(dom.cam, { width: 1280, height: 720 });
      } catch (e) {
        console.warn('engine camera bridge failed:', e);
      }
    }
    return;
  }
  // Test mode: ?fake=1 replaces the camera with a synthetic test pattern
  // so we can verify orientation/mirror without granting permission.
  if (new URLSearchParams(location.search).get('fake') === '1') {
    state.stream = buildFakeStream();
    dom.cam.srcObject = state.stream;
    await dom.cam.play().catch(() => {});
    return;
  }
  const constraints = {
    audio: false,
    video: {
      facingMode: facing,
      width:  { ideal: 1280 },
      height: { ideal: 720 },
    },
  };
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.stream = stream;
    dom.cam.srcObject = stream;
    await dom.cam.play().catch(() => {});
  } catch (err) {
    console.warn('camera error', err);
    flashNotice('Camera unavailable — running without it', true);
  }
}

function buildFakeStream() {
  const cnv = document.createElement('canvas');
  cnv.width = 640; cnv.height = 480;
  const ctx = cnv.getContext('2d');
  let t = 0;
  function paint() {
    t++;
    ctx.fillStyle = '#222'; ctx.fillRect(0, 0, 640, 480);
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0f0'; ctx.fillText('TOP', 320, 50);
    ctx.fillStyle = '#f33'; ctx.fillText('BOT', 320, 430);
    ctx.fillStyle = '#0ff'; ctx.fillText('L', 50, 240);
    ctx.fillStyle = '#ff0'; ctx.fillText('R', 590, 240);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 140px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('F', 240, 180);
    // small animated dot — gives captureStream a reason to produce frames
    ctx.fillStyle = (t % 30 < 15) ? '#fff' : '#888';
    ctx.beginPath(); ctx.arc(120, 400, 12, 0, Math.PI * 2); ctx.fill();
    requestAnimationFrame(paint);
  }
  paint();
  return cnv.captureStream(30);
}

// Diagnostic camera: a static asymmetric pattern that masquerades as the <video>,
// so a rendered frame reveals orientation (TOP must stay top; "F" must read normally
// = not mirrored). Engine ?fake=1 only.
function makeTestCamCanvas() {
  const c = document.createElement('canvas');
  c.width = 1280; c.height = 720;
  const x = c.getContext('2d');
  x.fillStyle = '#222'; x.fillRect(0, 0, 1280, 720);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'bold 80px sans-serif';
  x.fillStyle = '#3f3'; x.fillText('TOP', 640, 60);
  x.fillStyle = '#f44'; x.fillText('BOTTOM', 640, 660);
  x.fillStyle = '#4ff'; x.fillText('L', 60, 360);
  x.fillStyle = '#ff4'; x.fillText('R', 1220, 360);
  x.fillStyle = '#fff'; x.font = 'bold 300px serif'; x.fillText('F', 640, 360);
  let frameId = 0;
  Object.defineProperties(c, {
    videoWidth: { get: () => 1280 },
    videoHeight: { get: () => 720 },
    readyState: { get: () => 2 },
    currentTime: { get: () => (frameId++) / 30 },
  });
  return c;
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  dom.cam.srcObject = null;
}

async function toggleCamera() {
  state.facing = (state.facing === 'user') ? 'environment' : 'user';
  dom.switchCamera.textContent = `Camera: ${state.facing === 'user' ? 'Front' : 'Back'}`;
  await startCamera(state.facing);
}

// ============================ Launcher ============================

function buildLauncher() {
  dom.launcher.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'launcherHeader';
  header.innerHTML = `
    <p class="launcherSubtitle">UNKNOWN REALITY ARCHIVE — DEMO · ${EFFECTS.length} EFFECTS</p>
    <h1 class="launcherTitle">archive</h1>
  `;
  dom.launcher.appendChild(header);

  // Group effects by category
  const byCategory = new Map();
  for (const eff of EFFECTS) {
    const c = eff.category || 'PUBLIC';
    if (!byCategory.has(c)) byCategory.set(c, []);
    byCategory.get(c).push(eff);
  }

  for (const category of CATEGORIES) {
    const list = byCategory.get(category) || [];
    if (!list.length) continue;

    const section = document.createElement('section');
    section.className = 'launcherSection';
    section.innerHTML = `
      <div class="launcherSectionHeader">
        <span class="launcherSectionTitle">${category} · ${list.length}</span>
        <span class="launcherSectionDivider"></span>
      </div>
      <div class="launcherSectionGrid"></div>
    `;
    const grid = section.querySelector('.launcherSectionGrid');

    for (const eff of list) {
      const btn = document.createElement('button');
      btn.className = 'contentStartBtn contentStartBtn--video';
      btn.dataset.effectId = eff.id;
      btn.innerHTML = `
        <canvas class="tilePreview"></canvas>
        <span class="contentStartBtnTextOverlay">
          <span class="contentStartBtnTextTitle">${eff.title}</span>
          <span class="contentStartBtnTextSubtitle">${eff.subtitle}</span>
        </span>
      `;
      btn.addEventListener('click', () => activateEffect(eff));
      grid.appendChild(btn);
      const cnv = btn.querySelector('canvas');
      if (typeof eff.preview === 'function') {
        cnv.width = 320; cnv.height = 320;
        eff.preview(cnv.getContext('2d'));
      } else {
        paintPreview(cnv, eff.preview || eff.id, eff.previewOpts);
      }
    }
    dom.launcher.appendChild(section);
  }
}

// ============================ Router ============================

function setView(view) {
  state.view = view;
  dom.body.dataset.appView = view;
  dom.start.classList.toggle('hidden', view !== 'start');
  dom.launcher.classList.toggle('hidden', view !== 'launcher');
  dom.contactDock.classList.toggle('hidden', view !== 'launcher');
  dom.back.classList.toggle('hidden', view !== 'content');
  dom.switchCamera.classList.toggle('hidden', view !== 'content');
  dom.capture.classList.toggle('hidden', view !== 'content');
  dom.hud.classList.toggle('hidden', view !== 'content');
  if (view === 'launcher' || view === 'start') {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
}

async function activateEffect(eff) {
  dom.body.dataset.activeContentId = eff.id;
  setView('content');

  // Ensure camera is on (failure is non-fatal; effects render black with no input)
  if (!state.stream) await startCamera(state.facing);

  // Wait for video to have a frame, but don't hang if camera was denied
  if (state.stream && dom.cam.readyState < 2) {
    await Promise.race([
      new Promise((res) => dom.cam.addEventListener('loadeddata', res, { once: true })),
      new Promise((res) => setTimeout(res, 1500)),
    ]);
  }

  // Camera source: real <video> in a browser; the pumped canvas in the engine.
  const camSource = (ENGINE && state.camCanvas) ? state.camCanvas : dom.cam;
  state.videoTexture = (ENGINE && state.camCanvas)
    ? new THREE.CanvasTexture(state.camCanvas)
    : new THREE.VideoTexture(dom.cam);
  state.videoTexture.colorSpace = THREE.SRGBColorSpace;
  state.videoTexture.minFilter = THREE.LinearFilter;
  state.videoTexture.magFilter = THREE.LinearFilter;
  state.videoTexture.generateMipmaps = false;

  // Tear down previous
  if (state.activeEffect) {
    state.activeEffect.dispose();
    state.activeEffect = null;
  }
  while (state.scene.children.length) state.scene.remove(state.scene.children[0]);

  const ctx = {
    THREE,
    scene: state.scene,
    camera: state.camera,
    renderer: state.renderer,
    video: camSource,
    videoTexture: state.videoTexture,
    width: window.innerWidth,
    height: window.innerHeight,
    // MIRROR RULE (hard, every preset): the virtual-camera frame is ALWAYS the raw
    // camera orientation — never mirrored. In engine mode force facing='environment'
    // so NO effect self-mirrors (BaseShaderEffect uMirror=0, Tracker.mirror=false).
    // The selfie mirror is applied EXACTLY ONCE downstream, in the app's self-view
    // preview (MaskGalleryView scaleEffect), and never affects what others see.
    facing: ENGINE ? 'environment' : state.facing,
    setHud: (text) => { dom.hud.textContent = text; },
  };

  state.activeEffect = eff.factory();
  try {
    await state.activeEffect.init(ctx);
  } catch (err) {
    console.error('effect init failed', err);
    flashNotice('Effect failed to load: ' + err.message, true);
    backToLauncher();
    return;
  }

  // Display mode:
  //   wantsRawVideo: show the <video> element under the (transparent) canvas
  //     and CSS-mirror it for selfie. Canvas only carries the landmark overlay.
  //   otherwise: canvas is opaque (PURE/EXPERIMENTAL shader fills the screen),
  //     so hide the video element to avoid double-paint.
  const wantsVideo = !!state.activeEffect.wantsRawVideo;
  if (ENGINE) {
    // Tracker effects show the live camera behind a transparent overlay canvas.
    // Offscreen there's no playable <video>, so composite the pumped camCanvas.
    showEngineCamBackground(wantsVideo ? state.camCanvas : null);
    dom.canvas.style.zIndex = '1';
  } else {
    dom.cam.classList.toggle('cam-hidden', !wantsVideo);
    dom.cam.classList.toggle('cam-mirrored', wantsVideo && state.facing !== 'environment');
  }

  startLoop();
}

// Composite the pumped webcam canvas as a full-screen background (engine mode only).
// RAW orientation — NO mirror (MIRROR RULE). The Tracker is also un-mirrored in engine
// mode (facing='environment'), so overlays line up and the captured frame stays raw.
function showEngineCamBackground(cnv) {
  const existing = document.getElementById('engineCamBg');
  if (!cnv) { if (existing) existing.style.display = 'none'; return; }
  cnv.id = 'engineCamBg';
  cnv.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;display:block;';
  if (cnv.parentElement !== document.body) document.body.insertBefore(cnv, document.body.firstChild);
}

function startLoop() {
  cancelAnimationFrame(state.rafId);
  state.lastTime = performance.now();
  const tick = (t) => {
    const dt = Math.min(0.1, (t - state.lastTime) / 1000);
    state.lastTime = t;
    // Force VideoTexture re-upload each frame. Three.js relies on
    // requestVideoFrameCallback, which doesn't fire reliably for canvas-
    // captureStream sources and is missing in some older browsers.
    if (state.videoTexture) {
      // CanvasTexture (engine) must refresh every frame; VideoTexture only once decoded.
      if (ENGINE) state.videoTexture.needsUpdate = true;
      else if (dom.cam.readyState >= 2) state.videoTexture.needsUpdate = true;
    }
    if (state.activeEffect && state.activeEffect.update) {
      try {
        state.activeEffect.update(dt);
      } catch (e) {
        // Don't let a single bad frame from an effect kill the loop.
        console.error('[tick] effect.update threw — continuing:', e);
      }
    }
    const effect = state.activeEffect;
    const cam = (effect && effect.camera) || state.camera;
    try {
      state.renderer.render(state.scene, cam);
    } catch (e) {
      console.error('[tick] renderer.render threw — continuing:', e);
    }
    state.rafId = requestAnimationFrame(tick);
  };
  state.rafId = requestAnimationFrame(tick);
}

function backToLauncher() {
  if (state.activeEffect) {
    state.activeEffect.dispose();
    state.activeEffect = null;
  }
  while (state.scene.children.length) state.scene.remove(state.scene.children[0]);
  if (state.videoTexture) {
    state.videoTexture.dispose();
    state.videoTexture = null;
  }
  // Reset camera display so next effect starts from a clean state.
  dom.cam.classList.remove('cam-hidden', 'cam-mirrored');
  delete dom.body.dataset.activeContentId;
  setView('launcher');
}

// ============================ Recorder ============================

function startRecording() {
  if (state.recording) return;
  const stream = dom.canvas.captureStream(30);
  const mime = pickMime();
  if (!mime) {
    flashNotice('Recording not supported in this browser', true);
    return;
  }
  state.recordChunks = [];
  try {
    state.recorder = new MediaRecorder(stream, { mimeType: mime });
  } catch (e) {
    flashNotice('Recorder error: ' + e.message, true);
    return;
  }
  state.recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) state.recordChunks.push(e.data);
  };
  state.recorder.onstop = () => {
    const blob = new Blob(state.recordChunks, { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ura-${Date.now()}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  state.recorder.start();
  state.recording = true;
  dom.capture.classList.add('contentCaptureBtn--recording');
  flashNotice('Recording — tap again to stop');
}

function stopRecording() {
  if (!state.recording || !state.recorder) return;
  state.recorder.stop();
  state.recording = false;
  dom.capture.classList.remove('contentCaptureBtn--recording');
  hideNotice();
}

function pickMime() {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

function flashNotice(text, isError = false) {
  dom.captureNotice.textContent = text;
  dom.captureNotice.classList.toggle('contentCaptureNotice--error', isError);
  dom.captureNotice.classList.remove('hidden');
  clearTimeout(flashNotice._t);
  flashNotice._t = setTimeout(hideNotice, 2400);
}
function hideNotice() {
  dom.captureNotice.classList.add('hidden');
}

// ============================ UI bindings ============================

function bindUI() {
  dom.start.addEventListener('click', async () => {
    dom.start.classList.add('hidden');
    setView('launcher');
    // Pre-warm camera permission
    await startCamera(state.facing);
  });

  dom.back.addEventListener('click', backToLauncher);

  dom.switchCamera.addEventListener('click', async () => {
    dom.switchCamera.disabled = true;
    await toggleCamera();
    dom.switchCamera.disabled = false;
  });

  dom.capture.addEventListener('click', () => {
    if (state.recording) stopRecording();
    else startRecording();
  });

  dom.contactBtn.addEventListener('click', () => {
    dom.contactDock.classList.add('open');
  });
  dom.closeContactBtn.addEventListener('click', () => {
    dom.contactDock.classList.remove('open');
    dom.emailBtn.classList.remove('revealed', 'checkPop');
  });

  dom.emailBtn.addEventListener('click', () => {
    const email = dom.emailBtn.querySelector('.contactEmailLabel').textContent.trim();
    navigator.clipboard?.writeText(email).catch(() => {});
    dom.emailBtn.classList.add('revealed', 'checkPop');
    setTimeout(() => dom.emailBtn.classList.remove('checkPop'), 600);
  });
}

init();
