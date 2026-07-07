#include "engine_app.h"

#include "engine_handler.h"
#include "include/cef_browser.h"
#include "include/cef_command_line.h"
#include "include/wrapper/cef_helpers.h"

EngineApp::EngineApp(const std::string& url, const std::string& shmPath, bool untrusted)
    : url_(url), shm_path_(shmPath), untrusted_(untrusted) {}

void EngineApp::OnBeforeCommandLineProcessing(
    const CefString& process_type,
    CefRefPtr<CefCommandLine> command_line) {
  // ROOT-CAUSE FIX: stop Chromium from touching the macOS Keychain ("Safe
  // Storage"). Without this it blocks on a keychain password prompt at startup
  // (→ engine hangs) and re-prompts on every launch. Confirmed CEF fix.
  command_line->AppendSwitch("use-mock-keychain");
  command_line->AppendSwitchWithValue("password-store", "basic");

  // A virtual camera is video-only — never let a mask play audio through the speakers.
  command_line->AppendSwitch("mute-audio");

  // Trusted built-in masks (and the bundled effect runtime) are multi-file ES modules
  // loaded from file://; Chromium blocks relative module imports on file:// by default, so
  // allow them. UNTRUSTED (imported) masks do NOT get this flag — it is exactly what lets a
  // mask fetch()/XHR arbitrary local files (…/.ssh/id_rsa) and exfiltrate them. Withholding
  // it makes each file:// page an opaque origin that cannot read other files (proven by PoC).
  if (!untrusted_) {
    command_line->AppendSwitch("allow-file-access-from-files");
  }

  // Browser process only (empty process_type).
  if (process_type.empty()) {
    // Auto-grant camera/microphone to the mask page (getUserMedia) without UI.
    command_line->AppendSwitch("enable-media-stream");
    // Auto-approve the in-page camera/mic permission prompt (real device, not fake).
    command_line->AppendSwitch("use-fake-ui-for-media-stream");
    // Don't throttle rendering / timers when the page is "hidden" — we are
    // headless and always want live frames.
    command_line->AppendSwitch("disable-renderer-backgrounding");
    command_line->AppendSwitch("disable-backgrounding-occluded-windows");
    command_line->AppendSwitch("disable-background-timer-throttling");
  }
}

void EngineApp::OnContextInitialized() {
  CEF_REQUIRE_UI_THREAD();

  CefRefPtr<EngineHandler> handler(new EngineHandler(shm_path_, untrusted_));

  CefBrowserSettings browser_settings;
  browser_settings.windowless_frame_rate = 30;

  CefWindowInfo window_info;
  // Headless offscreen rendering: no parent view.
  window_info.SetAsWindowless(0);

  CefBrowserHost::CreateBrowser(window_info, handler, url_, browser_settings,
                                nullptr, nullptr);
}
