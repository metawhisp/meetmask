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

    // MARK: engine contract
    //
    // The engine is a SEPARATE download, so a host update does NOT update it. The frame
    // geometry is compiled into both sides independently (engine/frame_geometry.h and
    // Shared.swift), and the receiver drops any frame whose dimensions differ — so an
    // outdated engine means a silently black camera. Version the contract explicitly:
    // record what the installed engine produces, and re-download when it no longer matches.

    /// Bumped whenever the host↔engine wire contract changes (geometry, shm layout, args).
    nonisolated static let engineContract = "1920x1080-bgra-seqlock-v1"

    nonisolated static var contractFile: URL { installRoot.appendingPathComponent("engine.contract") }

    nonisolated static func installedContract() -> String? {
        (try? String(contentsOf: contractFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// True when an engine is present AND it speaks the contract this host expects.
    nonisolated static func isUsable() -> Bool { isInstalled() && installedContract() == engineContract }

    /// Engine archive URL. Production: set to your CDN. Dev/test: `MEETAMASK_ENGINE_URL` env
    /// (a local http server) overrides it so the whole flow is testable without a CDN.
    nonisolated static var sourceURL: URL? {
        if let s = ProcessInfo.processInfo.environment["MEETAMASK_ENGINE_URL"], let u = URL(string: s) { return u }
        // Branded download endpoint we control (Cloudflare Worker on meetamask.com) — today it
        // 302-redirects to the notarized engine zip on the GitHub Release (`latest` asset), and
        // lets us move storage later without touching shipped apps. URLSession follows redirects.
        return URL(string: "https://dl.meetamask.com/engine")
    }

    // MARK: install

    /// Ensure the engine is present; download+unpack it if not. Safe to call repeatedly.
    func ensureInstalled() async {
        // Existence is NOT enough: an engine left over from an older app version speaks a
        // different wire contract (e.g. 1280x720 frames) and the receiver would silently
        // drop every frame → black camera. Re-download whenever the contract doesn't match.
        if Self.isUsable() { state = .installed; return }
        if Self.isInstalled() {
            os_log("installer: engine present but contract %{public}@ != %{public}@ — re-downloading",
                   log: log, type: .info, Self.installedContract() ?? "(none)", Self.engineContract)
        }
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
            // Record the contract this engine speaks — written LAST, so a half-finished
            // install is never mistaken for a usable one.
            try? Self.engineContract.write(to: Self.contractFile, atomically: true, encoding: .utf8)
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
