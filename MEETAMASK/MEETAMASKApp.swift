import SwiftUI
import AVFoundation

@main
struct MEETAMASKApp: App {
    @State private var tab = 1   // open on the Masks tab by default

    init() {
        // 🔒 CAMERA PERMISSION — request UP FRONT, attributed to THIS foreground host app.
        // The headless engine subprocess has no UI and cannot reliably present the macOS TCC
        // prompt; macOS attributes a child process's camera use to the responsible (host)
        // process, so granting the host here is what lets the engine receive real frames.
        // Without this, the only trigger was the background engine's getUserMedia → on a fresh
        // machine that can silently fail → black masks. See verify/camera/README.md.
        if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined {
            AVCaptureDevice.requestAccess(for: .video) { _ in }
        }
    }

    var body: some Scene {
        WindowGroup {
            TabView(selection: $tab) {
                ContentView()
                    .tabItem { Label("Камера", systemImage: "video") }
                    .tag(0)
                MaskGalleryView()
                    .tabItem { Label("Маски", systemImage: "theatermasks") }
                    .tag(1)
            }
            .frame(width: 820, height: 640)
        }
        .windowResizability(.contentSize)
    }
}
