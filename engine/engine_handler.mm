#include "engine_handler.h"

#include "frame_geometry.h"

#import <Foundation/Foundation.h>

#include "include/cef_app.h"
#include "include/cef_frame.h"
#include "include/wrapper/cef_helpers.h"

EngineHandler::EngineHandler(const std::string& shmPath, bool untrusted)
    : shm_path_(shmPath), untrusted_(untrusted) {}

// Injected once the mask page has loaded: (1) make getUserMedia always pick the
// REAL webcam, never our own "MEETAMASK Camera" (would feed back on itself), and
// (2) auto-click the mask's start button so no manual interaction is needed.
static const char* kAutoStartJS = R"JS(
(function () {
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      var orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      async function pickRealCam() {
        var devs = await navigator.mediaDevices.enumerateDevices();
        var cams = devs.filter(function (d) { return d.kind === 'videoinput'; });
        var real = cams.find(function (d) { return d.label && !/meetamask/i.test(d.label); });
        if (!real) {
          try { var t = await orig({ video: true }); t.getTracks().forEach(function (x) { x.stop(); }); } catch (e) {}
          devs = await navigator.mediaDevices.enumerateDevices();
          cams = devs.filter(function (d) { return d.kind === 'videoinput'; });
          real = cams.find(function (d) { return d.label && !/meetamask/i.test(d.label); });
        }
        return real;
      }
      navigator.mediaDevices.getUserMedia = async function (c) {
        c = c || {};
        if (c.video) {
          try {
            var real = await pickRealCam();
            if (real) {
              c.video = (typeof c.video === 'object') ? c.video : {};
              c.video.deviceId = { exact: real.deviceId };
            }
          } catch (e) {}
        }
        return orig(c);
      };
    }
  } catch (e) {}
  function start() {
    var b = document.getElementById('startBtn');
    if (b && b.offsetParent !== null) { b.click(); }
  }
  start();
  setTimeout(start, 600);
})();
)JS";

void EngineHandler::OnLoadEnd(CefRefPtr<CefBrowser> browser,
                              CefRefPtr<CefFrame> frame,
                              int httpStatusCode) {
  if (!frame->IsMain()) return;
  frame->ExecuteJavaScript(kAutoStartJS, frame->GetURL(), 0);
  fprintf(stderr, "[MEETAMASK Engine] auto-start injected\n");
  fflush(stderr);
}

bool EngineHandler::OnConsoleMessage(CefRefPtr<CefBrowser> browser,
                                     cef_log_severity_t level,
                                     const CefString& message,
                                     const CefString& source,
                                     int line) {
  fprintf(stderr, "[mask console] %s\n", message.ToString().c_str());
  fflush(stderr);
  return false;
}

void EngineHandler::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  browser_ = browser;
  fprintf(stderr, "[MEETAMASK Engine] browser created; windowless=%d\n",
          browser->GetHost()->IsWindowRenderingDisabled());
  fflush(stderr);
  // Kick off offscreen rendering: mark the view visible and trigger a paint.
  browser->GetHost()->WasHidden(false);
  browser->GetHost()->WasResized();
  browser->GetHost()->Invalidate(PET_VIEW);
  // Map the shared-memory frame buffer the host app reads from.
  if (!shm_path_.empty()) {
    shm_.Open(shm_path_.c_str());
  }
}

void EngineHandler::OnBeforeClose(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  browser_ = nullptr;
  CefQuitMessageLoop();
}

void EngineHandler::GetViewRect(CefRefPtr<CefBrowser> browser, CefRect& rect) {
  static bool logged = false;
  if (!logged) {
    logged = true;
    NSLog(@"[MEETAMASK Engine] GetViewRect called (render handler engaged)");
  }
  rect = CefRect(0, 0, mm::kFrameWidth, mm::kFrameHeight);
}

void EngineHandler::OnPaint(CefRefPtr<CefBrowser> browser,
                            PaintElementType type,
                            const RectList& dirtyRects,
                            const void* buffer,
                            int width,
                            int height) {
  if (type != PET_VIEW) {
    return;  // ignore popups for now
  }
  frame_count_++;
  if (frame_count_ == 1 || frame_count_ % 30 == 0) {
    fprintf(stderr, "[MEETAMASK Engine] OnPaint frame %llu  %dx%d\n",
            frame_count_, width, height);
    fflush(stderr);
  }
  // Hand the rendered frame to the host app via shared memory.
  shm_.Write(buffer, width, height);
  // Phase 3: copy the BGRA `buffer` (width*height*4) into a CVPixelBuffer and
  // push it to the MEETAMASK virtual camera sink.
}
