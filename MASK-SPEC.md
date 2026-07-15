# MEETAMASK — Mask spec

A mask is a small **self-contained web page**. MEETAMASK runs it offscreen, draws your
webcam + effect, and streams the result into your calls as the **“MEETAMASK Camera.”**

Imported masks are **other people’s code**, so every one runs in a **locked sandbox** — no
disk, no network, no windows. Those limits are what keep a “cute cat mask” from stealing your
files, and they shape what a mask can be.

## What we accept
- A **`.zip`** or a **folder** containing **`index.html`** (at the root, or one level down).
- **Fully self-contained** — every script, style, image, font and model is inside the package.
- **≤ 200 MB.**
- Draws to fill **1280×720** (16:9).

## What won’t work (the sandbox blocks it)
- **No network of any kind.** No `fetch`/XHR to the internet, no `<script src="https://…">`, no
  CDN, no Google Fonts, no analytics, no APIs. *Loading MediaPipe / Three.js from a CDN will NOT
  work — bundle them locally.*
- **No `fetch()` / XHR even for your own files**, and **no ES modules** (`import`,
  `<script type="module">`) — both are blocked on local pages. Load with plain HTML tags instead.
- **No reading anything outside your folder** — zero access to the user’s files.
- **No new windows / navigation** — `window.open`, `target="_blank"`, `location = "https://…"`
  are all cancelled.
- **No downloads. No audio** (video-only; sound is muted).

## What you CAN use
- **`<canvas>` 2D and WebGL**, `requestAnimationFrame`, all the usual in-page JS.
- **The webcam:** `navigator.mediaDevices.getUserMedia({ video: true })` — we hand you the real
  camera automatically. Draw its frames to your canvas and paint on top.
- **Local files via tags:** `<script src="./app.js">`, `<img src="./sticker.png">`,
  `<link rel="stylesheet" href="./style.css">`. Use **UMD / classic** library builds (a global
  like `THREE`), not the ESM build.
- **Inline / embedded data:** `data:` and `blob:` URIs (e.g. base64 a model or image into your JS).
- A **start button** `<button id="startBtn">` — we auto-click it to begin. (Or just start on load.)

## How it renders
- Offscreen at **1280×720, 30 fps**. Whatever fills the page becomes the camera frame.
- Output is **not mirrored** (the meeting app mirrors your self-view for you).

## Minimal skeleton
```html
<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#000;overflow:hidden}#c{width:100%;height:100%}</style>
</head><body>
  <video id="v" autoplay playsinline muted style="display:none"></video>
  <canvas id="c" width="1280" height="720"></canvas>
  <button id="startBtn">Enter</button>
  <script>
    const v = document.getElementById('v');
    const x = document.getElementById('c').getContext('2d');
    async function start() {
      document.getElementById('startBtn').style.display = 'none';
      v.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      (function loop(){ x.drawImage(v, 0, 0, 1280, 720); /* …your effect here… */ requestAnimationFrame(loop); })();
    }
    document.getElementById('startBtn').addEventListener('click', start);
  </script>
</body></html>
```

## Checklist before importing
- [ ] `index.html` present (root, or one folder down)
- [ ] Zero `https://` / CDN references — everything local
- [ ] No `fetch` / `import` — tags + inline only
- [ ] Fills 1280×720
- [ ] Has `#startBtn` or auto-starts
- [ ] Under 200 MB

---
*This file is the source of truth. It is mirrored on the site (`/create`) and in the app
(Add mask → “How to make a mask”). Update all three together.*
