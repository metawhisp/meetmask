// Singleton loaders for MediaPipe Tasks Vision models. Effects share these
// instances so we don't re-download the wasm + model every time the user
// switches between face-based effects.

const MP_VERSION = '0.10.18';
const MP_ESM  = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/+esm`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;

const FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAND_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const SEGMENTER_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const GESTURE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const POSE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

let _mp = null;
let _fileset = null;
let _faceLandmarkerP = null;
let _handLandmarkerP = null;
let _selfieSegmenterP = null;
let _gestureRecognizerP = null;
let _poseLandmarkerP = null;

async function loadVision() {
  if (_mp) return _mp;
  _mp = await import(/* @vite-ignore */ MP_ESM);
  _fileset = await _mp.FilesetResolver.forVisionTasks(MP_WASM);
  return _mp;
}

export async function loadFaceLandmarker({ numFaces = 1 } = {}) {
  if (_faceLandmarkerP) return _faceLandmarkerP;
  _faceLandmarkerP = (async () => {
    const mp = await loadVision();
    return mp.FaceLandmarker.createFromOptions(_fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
  })();
  return _faceLandmarkerP;
}

export async function loadHandLandmarker({ numHands = 2 } = {}) {
  if (_handLandmarkerP) return _handLandmarkerP;
  _handLandmarkerP = (async () => {
    const mp = await loadVision();
    return mp.HandLandmarker.createFromOptions(_fileset, {
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands,
    });
  })();
  return _handLandmarkerP;
}

// SelfieSegmenter — returns a per-pixel mask of the foreground person.
// Use `segmenter.segmentForVideo(video, ts)` then read `result.categoryMask`
// which is an MPMask whose .getAsUint8Array() returns a width*height buffer
// where 255 == foreground (you), 0 == background.
export async function loadSelfieSegmenter() {
  if (_selfieSegmenterP) return _selfieSegmenterP;
  _selfieSegmenterP = (async () => {
    const mp = await loadVision();
    return mp.ImageSegmenter.createFromOptions(_fileset, {
      baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
  })();
  return _selfieSegmenterP;
}

// GestureRecognizer — combines hand landmarks with a gesture classifier.
// Call `recognizer.recognizeForVideo(video, ts)`; result has:
//   .landmarks: array per hand of 21 landmarks
//   .gestures: array per hand of [{ categoryName, score }, …]
// Categories: None, Closed_Fist, Open_Palm, Pointing_Up, Thumb_Down,
//             Thumb_Up, Victory, ILoveYou
export async function loadGestureRecognizer({ numHands = 2 } = {}) {
  if (_gestureRecognizerP) return _gestureRecognizerP;
  _gestureRecognizerP = (async () => {
    const mp = await loadVision();
    return mp.GestureRecognizer.createFromOptions(_fileset, {
      baseOptions: { modelAssetPath: GESTURE_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands,
    });
  })();
  return _gestureRecognizerP;
}

// PoseLandmarker — 33 full-body skeleton landmarks.
// Useful indices:
//   11/12 = left/right shoulder, 13/14 = elbows, 15/16 = wrists,
//   23/24 = left/right hip, 25/26 = knees, 27/28 = ankles.
// Each landmark has a `visibility` score in [0,1]; gate display on it.
export async function loadPoseLandmarker({ numPoses = 1 } = {}) {
  if (_poseLandmarkerP) return _poseLandmarkerP;
  _poseLandmarkerP = (async () => {
    const mp = await loadVision();
    return mp.PoseLandmarker.createFromOptions(_fileset, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  })();
  return _poseLandmarkerP;
}

// Connection lists for drawing face features.
// These follow the canonical MediaPipe FaceMesh topology.
export const FACE_CONNECTIONS = {
  lipsOuter: [
    [61,146],[146,91],[91,181],[181,84],[84,17],[17,314],[314,405],[405,321],
    [321,375],[375,291],[61,185],[185,40],[40,39],[39,37],[37,0],[0,267],
    [267,269],[269,270],[270,409],[409,291],
  ],
  lipsInner: [
    [78,95],[95,88],[88,178],[178,87],[87,14],[14,317],[317,402],[402,318],
    [318,324],[324,308],[78,191],[191,80],[80,81],[81,82],[82,13],[13,312],
    [312,311],[311,310],[310,415],[415,308],
  ],
  rightEye: [
    [33,7],[7,163],[163,144],[144,145],[145,153],[153,154],[154,155],[155,133],
    [33,246],[246,161],[161,160],[160,159],[159,158],[158,157],[157,173],[173,133],
  ],
  leftEye: [
    [263,249],[249,390],[390,373],[373,374],[374,380],[380,381],[381,382],[382,362],
    [263,466],[466,388],[388,387],[387,386],[386,385],[385,384],[384,398],[398,362],
  ],
  rightBrow: [
    [70,63],[63,105],[105,66],[66,107],
    [46,53],[53,52],[52,65],[65,55],
  ],
  leftBrow: [
    [300,293],[293,334],[334,296],[296,336],
    [276,283],[283,282],[282,295],[295,285],
  ],
  faceOval: [
    [10,338],[338,297],[297,332],[332,284],[284,251],[251,389],[389,356],[356,454],
    [454,323],[323,361],[361,288],[288,397],[397,365],[365,379],[379,378],[378,400],
    [400,377],[377,152],[152,148],[148,176],[176,149],[149,150],[150,136],[136,172],
    [172,58],[58,132],[132,93],[93,234],[234,127],[127,162],[162,21],[21,54],
    [54,103],[103,67],[67,109],[109,10],
  ],
  nose: [
    [168,6],[6,197],[197,195],[195,5],[5,4],[4,1],
  ],
};

export const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];
