// MEETAMASK render engine — CefClient with offscreen render handler.
#ifndef MEETAMASK_ENGINE_HANDLER_H_
#define MEETAMASK_ENGINE_HANDLER_H_

#include <cstdint>
#include <string>
#include "frame_shm.h"
#include "include/cef_client.h"

// Receives offscreen-rendered frames (OnPaint) for the mask page and (later)
// forwards them to the MEETAMASK virtual camera.
class EngineHandler : public CefClient,
                      public CefLifeSpanHandler,
                      public CefLoadHandler,
                      public CefDisplayHandler,
                      public CefDownloadHandler,
                      public CefRenderHandler {
 public:
  explicit EngineHandler(const std::string& shmPath);

  // CefClient
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefDownloadHandler> GetDownloadHandler() override { return this; }
  CefRefPtr<CefRenderHandler> GetRenderHandler() override { return this; }

  // CefDownloadHandler — a mask render surface NEVER downloads files. Returning
  // false cancels every download, so an unrenderable URL can't be saved to disk
  // (this is what was dumping the shm buffer into ~/Downloads).
  bool CanDownload(CefRefPtr<CefBrowser> browser,
                   const CefString& url,
                   const CefString& request_method) override {
    return false;
  }

  // CefDisplayHandler — surface page console.log() to the engine's stderr.
  bool OnConsoleMessage(CefRefPtr<CefBrowser> browser,
                        cef_log_severity_t level,
                        const CefString& message,
                        const CefString& source,
                        int line) override;

  // CefLifeSpanHandler
  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override;

  // NEVER open a popup / new browser window. A mask is a self-contained offscreen
  // render surface — window.open / target=_blank / a stray command-line URL must
  // not spawn a visible browser. Returning true cancels the popup.
  bool OnBeforePopup(CefRefPtr<CefBrowser> browser,
                     CefRefPtr<CefFrame> frame,
                     int popup_id,
                     const CefString& target_url,
                     const CefString& target_frame_name,
                     WindowOpenDisposition target_disposition,
                     bool user_gesture,
                     const CefPopupFeatures& popupFeatures,
                     CefWindowInfo& windowInfo,
                     CefRefPtr<CefClient>& client,
                     CefBrowserSettings& settings,
                     CefRefPtr<CefDictionaryValue>& extra_info,
                     bool* no_javascript_access) override {
    return true;
  }

  // CefLoadHandler — auto-start the mask once it has loaded.
  void OnLoadEnd(CefRefPtr<CefBrowser> browser,
                 CefRefPtr<CefFrame> frame,
                 int httpStatusCode) override;

  // CefRenderHandler
  void GetViewRect(CefRefPtr<CefBrowser> browser, CefRect& rect) override;
  void OnPaint(CefRefPtr<CefBrowser> browser,
               PaintElementType type,
               const RectList& dirtyRects,
               const void* buffer,
               int width,
               int height) override;

 private:
  CefRefPtr<CefBrowser> browser_;
  uint64_t frame_count_ = 0;
  std::string shm_path_;
  FrameSHM shm_;
  IMPLEMENT_REFCOUNTING(EngineHandler);
};

#endif  // MEETAMASK_ENGINE_HANDLER_H_
