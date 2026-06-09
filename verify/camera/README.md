# 🔒 Camera path — never let "black screen" come back

This folder guards the **#1 product-killer regression**: opening a mask shows a **black
screen** (you don't see yourself).

## The root cause (so it's never re-debugged from scratch)

Masks render in a **headless CEF engine** (a separate `MEETAMASKEngine` subprocess, no
window — that's what survives the app being hidden). The engine gets the webcam via
`getUserMedia` **inside** that subprocess.

macOS gates camera access with **TCC**, and it attributes a child process's camera use to
the **"responsible process"** — normally the app that launched it. So:

| How the app is launched | Responsible process | Camera result |
|---|---|---|
| Finder / Dock / `open -a` (the real way) | **MEETAMASK.app** (camera granted) | ✅ frames flow |
| From a terminal (`./MEETAMASK`, `… &`) | the **terminal** (no camera grant) | ❌ silent black |

`--use-fake-ui-for-media-stream` makes Chromium hand back a **"live" track** even when macOS
is refusing frames, so the failure is **silent**: live track, `readyState=0`, zero pixels,
no error. That's what makes it nasty to diagnose.

**Proof the pipeline itself is fine:** running the engine with
`--use-fake-device-for-media-stream` renders a synthetic camera perfectly. Only the *real*
OS camera capture depends on TCC/responsible-process.

## What's hardened in the app (so it self-heals)

1. **Host requests camera up front** — `MEETAMASKApp.init()` calls
   `AVCaptureDevice.requestAccess(for: .video)`. The grant is attributed to the foreground
   host; the engine subprocess inherits it. No longer relies on the background engine's
   `getUserMedia` to (unreliably) trigger the prompt.
2. **Fail loud, never silently black** — `EngineFrameReceiver.start()` checks
   `AVCaptureDevice.authorizationStatus`; if denied/restricted it shows
   *"Нет доступа к камере → System Settings ▸ Privacy & Security ▸ Camera"* instead of a
   black frame.

## The rule (for humans AND for testing)

> **Always launch the app the real way — Finder, Dock, or `open -a`. Never from a terminal.**
> Terminal launches break the camera via TCC attribution; this is a *test-harness* trap, not
> an app bug.

## Verify it works (regression guard)

```bash
bash verify/camera/selftest.sh
```

It quits stale instances, launches the app **correctly** (`open -a`), finds the engine's
shared-memory frame buffer, and asserts the frames are **real camera pixels** (not black).
Run it after any change to the engine, the camera path, signing, or entitlements.

## If it FAILS

- **BLACK frames** → camera permission off, or you launched from a terminal.
  Enable *System Settings ▸ Privacy & Security ▸ Camera ▸ MEETAMASK*, relaunch via Dock.
- **No engine / no shm** → app didn't start, or `findEngine()` can't locate the engine.
- **Reset the grant** (to re-test first-run): `tccutil reset Camera com.meetamask.app`
  then relaunch via Dock and approve the prompt.
