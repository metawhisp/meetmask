// Offscreen camera bridge for the headless CEF engine (MEETAMASK masks).
//
// In a normal browser the prototype shows a live <video> and tracks it with
// `detectForVideo(video)`. In the engine's HEADLESS offscreen renderer a raw
// <video> stays at readyState=0 (it never decodes), so both the picture and the
// MediaPipe tracker get nothing.
//
// Proven fix (same one the bundled masks use): pump the webcam with legacy
// MediaPipe, draw `results.image` to a canvas, and hand back that canvas
// MASQUERADING as a <video> — it exposes videoWidth/videoHeight/readyState/
// currentTime, so the existing camera + Tracker code consumes it UNCHANGED.
// The canvas is also a valid pixel source for THREE.CanvasTexture and for
// FaceLandmarker/HandLandmarker detectForVideo().

const MP_CAMERA = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';
const MP_HANDS = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('failed to load ' + src));
    document.head.appendChild(s);
  });
}

// videoEl: a real <video> element MediaPipe's Camera attaches the stream to.
// Returns a canvas that (a) receives every decoded camera frame and (b) acts like
// a <video> so the rest of the runtime treats it as the camera source.
// 1920x1080 matches the virtual-camera format (Shared.swift / engine/frame_geometry.h) and
// what the physical Mac camera delivers — capturing smaller here softened every call.
export async function createEngineCamera(videoEl, { width = 1920, height = 1080 } = {}) {
  await loadScript(MP_CAMERA);
  await loadScript(MP_HANDS);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const cctx = canvas.getContext('2d');
  cctx.fillStyle = '#000';
  cctx.fillRect(0, 0, width, height);

  let frameId = 0;
  Object.defineProperties(canvas, {
    videoWidth: { get: () => width },
    videoHeight: { get: () => height },
    readyState: { get: () => 2 },                 // HAVE_CURRENT_DATA — always "ready"
    currentTime: { get: () => frameId / 30 },     // advances each frame ⇒ "new frame"
  });

  const Hands = window.Hands;
  const Camera = window.Camera;
  const hands = new Hands({ locateFile: (f) => 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/' + f });
  hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  hands.onResults((r) => {
    if (r && r.image && r.image.width) {
      cctx.drawImage(r.image, 0, 0, width, height);
      frameId++;
    }
  });

  const cam = new Camera(videoEl, {
    onFrame: async () => { await hands.send({ image: videoEl }); },
    width, height, facingMode: 'user',
  });
  cam.start();

  return canvas;
}
