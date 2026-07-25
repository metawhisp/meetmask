import SwiftUI
import WebKit

/// Runs a mask in a WKWebView embedded in the visible tab and broadcasts its frames to the
/// virtual camera (takeSnapshot -> CameraFeeder). Works while the app window is visible.
/// (The no-freeze-when-hidden version is the separate CEF engine — a later upgrade.)
final class MaskStudio: NSObject, ObservableObject, WKUIDelegate, WKNavigationDelegate {

    let webView: WKWebView

    @Published private(set) var isBroadcasting = false
    @Published private(set) var status = "Готов"

    private let feeder = CameraFeeder.shared
    private var captureTimer: DispatchSourceTimer?
    private var snapping = false
    private var currentMaskID: String?

    /// Injected before any page script: force the mask to use the REAL webcam, never our own
    /// virtual camera (otherwise getUserMedia grabs "MEETAMASK Camera" → feedback loop).
    private static let forceRealCameraJS = """
    (function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      async function pickRealCam() {
        let devs = await navigator.mediaDevices.enumerateDevices();
        let cams = devs.filter(d => d.kind === 'videoinput');
        let real = cams.find(d => d.label && !/meetamask/i.test(d.label));
        if (!real) {
          try { const tmp = await orig({ video: true }); tmp.getTracks().forEach(t => t.stop()); } catch (e) {}
          devs = await navigator.mediaDevices.enumerateDevices();
          cams = devs.filter(d => d.kind === 'videoinput');
          real = cams.find(d => d.label && !/meetamask/i.test(d.label));
        }
        return real;
      }
      navigator.mediaDevices.getUserMedia = async function (c) {
        c = c || {};
        if (c.video) {
          try {
            const real = await pickRealCam();
            if (real) {
              c.video = (typeof c.video === 'object') ? c.video : {};
              c.video.deviceId = { exact: real.deviceId };
            }
          } catch (e) {}
        }
        return orig(c);
      };
    })();
    """

    override init() {
        let cfg = WKWebViewConfiguration()
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.allowsAirPlayForMediaPlayback = false
        let cameraGuard = WKUserScript(source: Self.forceRealCameraJS,
                                       injectionTime: .atDocumentStart, forMainFrameOnly: true)
        cfg.userContentController.addUserScript(cameraGuard)
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1920, height: 1080), configuration: cfg)
        super.init()
        webView.uiDelegate = self
        webView.navigationDelegate = self
    }

    func show(_ mask: Mask) {
        guard mask.id != currentMaskID else { return }
        currentMaskID = mask.id
        webView.loadFileURL(mask.indexURL, allowingReadAccessTo: mask.indexURL.deletingLastPathComponent())
        if !isBroadcasting { startBroadcast() }
    }

    func toggleBroadcast() { isBroadcasting ? stopBroadcast() : startBroadcast() }

    func startBroadcast() {
        if feeder.isFeeding { feeder.stop() }
        guard feeder.connect() else {
            status = "Камера не найдена. Если только что обновил приложение — перезагрузи Mac: расширение камеры доустанавливается при перезапуске."
            return
        }
        let timer = DispatchSource.makeTimerSource(queue: .main)   // takeSnapshot must run on main
        timer.schedule(deadline: .now() + 0.3, repeating: 1.0 / Double(kFrameRate), leeway: .milliseconds(5))
        timer.setEventHandler { [weak self] in self?.captureTick() }
        timer.resume()
        captureTimer = timer
        isBroadcasting = true
        status = "Маска идёт в MEETAMASK Camera…"
    }

    func stopBroadcast() {
        captureTimer?.cancel(); captureTimer = nil
        feeder.disconnect()
        isBroadcasting = false
        status = "Остановлено"
    }

    private func captureTick() {
        guard !snapping else { return }
        snapping = true
        let cfg = WKSnapshotConfiguration()
        cfg.rect = webView.bounds
        cfg.afterScreenUpdates = false
        webView.takeSnapshot(with: cfg) { [weak self] image, _ in
            guard let self = self else { return }
            self.snapping = false
            guard let image = image, let sbuf = self.feeder.makeSampleBuffer(from: image) else { return }
            self.feeder.enqueue(sbuf)
        }
    }

    // Auto-start the mask (click its "Enter Experience" button) so no manual click is needed.
    func webView(_ wv: WKWebView, didFinish navigation: WKNavigation!) {
        wv.evaluateJavaScript("(function(){var b=document.getElementById('startBtn');if(b){b.click();}})();",
                              completionHandler: nil)
    }

    // Auto-grant camera/mic to the mask page.
    func webView(_ wv: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }
}

/// Embeds the studio's webView (visible & interactive) inside SwiftUI.
struct MaskHostView: NSViewRepresentable {
    let studio: MaskStudio
    func makeNSView(context: Context) -> NSView {
        let container = NSView()
        let wv = studio.webView
        wv.frame = container.bounds
        wv.autoresizingMask = [.width, .height]
        container.addSubview(wv)
        return container
    }
    func updateNSView(_ nsView: NSView, context: Context) {
        let wv = studio.webView
        if wv.superview !== nsView {
            wv.removeFromSuperview()
            wv.autoresizingMask = [.width, .height]
            nsView.addSubview(wv)
        }
        wv.frame = nsView.bounds
    }
}
