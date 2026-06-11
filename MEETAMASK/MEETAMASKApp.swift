import SwiftUI
import AVFoundation

@main
struct MEETAMASKApp: App {

    init() {
        // 🔒 CAMERA PERMISSION — request UP FRONT, attributed to THIS foreground host app.
        // The headless engine subprocess has no UI and cannot reliably present the macOS TCC
        // prompt; macOS attributes a child process's camera use to the responsible (host)
        // process, so granting the host here is what lets the engine receive real frames.
        if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined {
            AVCaptureDevice.requestAccess(for: .video) { _ in }
        }
    }

    var body: some Scene {
        WindowGroup {
            StageView()
        }
        .windowStyle(.hiddenTitleBar)   // the dark stage runs to the top; traffic lights float over it
        .windowResizability(.contentSize)
    }
}
