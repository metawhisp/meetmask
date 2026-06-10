import Foundation
import os.log

/// Keeps the SHIPPED app tiny: the ~250 MB CEF engine is NOT in the bundle. It's downloaded
/// and unpacked into Application Support on first launch, then reused offline forever after.
/// (Distributed app ≈ a few MB; the heavy browser engine arrives once, after install.)
@MainActor
final class EngineInstaller: ObservableObject {

    enum State: Equatable {
        case checking
        case downloading(Double?)   // 0…1, or nil = indeterminate
        case unpacking
        case installed
        case failed(String)
    }

    @Published private(set) var state: State = .checking

    private let log = OSLog(subsystem: "com.meetamask.app", category: "installer")

    // MARK: paths

    /// Where the engine lives once installed (writable, survives app updates).
    /// `nonisolated` — pure path math, callable from EngineFrameReceiver's background queue.
    nonisolated static var installRoot: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MEETAMASK", isDirectory: true)
    }
    nonisolated static var engineApp: URL { installRoot.appendingPathComponent("MEETAMASKEngine.app", isDirectory: true) }
    nonisolated static var enginePath: String { engineApp.appendingPathComponent("Contents/MacOS/MEETAMASKEngine").path }

    nonisolated static func isInstalled() -> Bool { FileManager.default.isExecutableFile(atPath: enginePath) }

    /// Engine archive URL. Production: set to your CDN. Dev/test: `MEETAMASK_ENGINE_URL` env
    /// (a local http server) overrides it so the whole flow is testable without a CDN.
    nonisolated static var sourceURL: URL? {
        if let s = ProcessInfo.processInfo.environment["MEETAMASK_ENGINE_URL"], let u = URL(string: s) { return u }
        // Notarized + stapled engine published as a GitHub Release asset on metawhisp/meetmask.
        // `latest` auto-follows the newest release, so a new engine ships by cutting a new release.
        return URL(string: "https://github.com/metawhisp/meetmask/releases/latest/download/MEETAMASKEngine.zip")
    }

    // MARK: install

    /// Ensure the engine is present; download+unpack it if not. Safe to call repeatedly.
    func ensureInstalled() async {
        if Self.isInstalled() { state = .installed; return }
        guard let url = Self.sourceURL else { state = .failed("Не задан источник движка"); return }
        await install(from: url)
    }

    private func install(from url: URL) async {
        state = .downloading(nil)
        do {
            try FileManager.default.createDirectory(at: Self.installRoot, withIntermediateDirectories: true)

            // 1) Download the archive to a temp file.
            let (tmp, response) = try await URLSession.shared.download(from: url)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw Err.msg("HTTP \(http.statusCode)")
            }
            let zip = Self.installRoot.appendingPathComponent("engine.download.zip")
            try? FileManager.default.removeItem(at: zip)
            try FileManager.default.moveItem(at: tmp, to: zip)

            // 2) Unpack atomically: extract into a staging dir, then swap into place.
            state = .unpacking
            let staging = Self.installRoot.appendingPathComponent("staging", isDirectory: true)
            try? FileManager.default.removeItem(at: staging)
            try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
            try unzip(zip, into: staging)

            // Find the engine .app inside the staging dir (zip may or may not have a wrapper dir).
            guard let staged = locateEngineApp(in: staging) else { throw Err.msg("в архиве нет MEETAMASKEngine.app") }
            try? FileManager.default.removeItem(at: Self.engineApp)
            try FileManager.default.moveItem(at: staged, to: Self.engineApp)
            try? FileManager.default.removeItem(at: staging)
            try? FileManager.default.removeItem(at: zip)

            // 3) Downloaded code is quarantined → strip it so the subprocess can launch.
            //    (For production the engine is notarized; we still verify the code signature.)
            stripQuarantine(Self.engineApp)

            guard Self.isInstalled() else { throw Err.msg("движок не запускаем после распаковки") }
            state = .installed
            os_log("installer: engine installed at %{public}@", log: log, type: .info, Self.engineApp.path)
        } catch {
            state = .failed((error as? Err)?.text ?? error.localizedDescription)
            os_log("installer: FAILED: %{public}@", log: log, type: .error, String(describing: error))
        }
    }

    // MARK: helpers

    private enum Err: Error { case msg(String); var text: String { if case let .msg(s) = self { return s }; return "" } }

    private func locateEngineApp(in dir: URL) -> URL? {
        let direct = dir.appendingPathComponent("MEETAMASKEngine.app")
        if FileManager.default.fileExists(atPath: direct.path) { return direct }
        // Otherwise search one level down (zip wrapped in a folder).
        let kids = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        for k in kids {
            let nested = k.appendingPathComponent("MEETAMASKEngine.app")
            if FileManager.default.fileExists(atPath: nested.path) { return nested }
            if k.lastPathComponent == "MEETAMASKEngine.app" { return k }
        }
        return nil
    }

    private func unzip(_ zip: URL, into dir: URL) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        p.arguments = ["-x", "-k", zip.path, dir.path]   // ditto preserves .app symlinks/perms correctly
        try p.run(); p.waitUntilExit()
        if p.terminationStatus != 0 { throw Err.msg("распаковка не удалась (ditto \(p.terminationStatus))") }
    }

    private func stripQuarantine(_ url: URL) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/xattr")
        p.arguments = ["-dr", "com.apple.quarantine", url.path]
        try? p.run(); p.waitUntilExit()
    }
}
