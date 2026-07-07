// MEETAMASK render engine — CefApp for the browser process.
#ifndef MEETAMASK_ENGINE_APP_H_
#define MEETAMASK_ENGINE_APP_H_

#include <string>
#include "include/cef_app.h"

// Application-level callbacks for the browser process. Creates the offscreen
// browser that renders the mask page once CEF is initialized.
class EngineApp : public CefApp, public CefBrowserProcessHandler {
 public:
  EngineApp(const std::string& url, const std::string& shmPath, bool untrusted);

  // CefApp
  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override {
    return this;
  }
  void OnBeforeCommandLineProcessing(
      const CefString& process_type,
      CefRefPtr<CefCommandLine> command_line) override;

  // CefBrowserProcessHandler
  void OnContextInitialized() override;

 private:
  const std::string url_;
  const std::string shm_path_;
  const bool untrusted_;
  IMPLEMENT_REFCOUNTING(EngineApp);
};

#endif  // MEETAMASK_ENGINE_APP_H_
