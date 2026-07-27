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

    /// Ensure the engine is present; download+unpack it if not. Safe to call repeatedly —
    /// concurrent callers (window opening + "Go live") join the SAME install instead of
    /// starting a second 300 MB download that fights the first one over the same files.
    func ensureInstalled() async {
        if let running = installTask { await running.value; return }
        let t = Task { await ensureInstalledOnce() }
        installTask = t
        await t.value
        installTask = nil
    }
    private var installTask: Task<Void, Never>?

    private func ensureInstalledOnce() async {
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
            Self.sweepLeftovers()   // a crash mid-unpack leaves ~300 MB of staging behind

            // 1) Download the archive, reporting real progress. `URLSession.download` gives
            //    none, so the first run showed an indeterminate spinner for 130+ MB and looked
            //    hung. Stream the bytes instead and publish the fraction as they land.
            let zip = Self.installRoot.appendingPathComponent("engine.download.zip")
            try? FileManager.default.removeItem(at: zip)
            let progress = DownloadProgress { [weak self] fraction in
                Task { @MainActor in
                    guard let self = self, case .downloading = self.state else { return }
                    self.state = .downloading(fraction)
                }
            }
            let (tmp, response) = try await URLSession.shared.download(from: url, delegate: progress)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw Err.msg("HTTP \(http.statusCode)")
            }
            try FileManager.default.moveItem(at: tmp, to: zip)

            // 2) Unpack + verify + swap. ditto over 300 MB, a recursive xattr and a codesign
            //    walk take SECONDS — on the main actor that is a frozen window with a
            //    spinner that cannot even animate. Do the whole filesystem phase off-main.
            state = .unpacking
            try await Task.detached(priority: .userInitiated) { try Self.unpackAndSwap(zip: zip) }.value

            guard Self.isInstalled() else { throw Err.msg("движок не запускаем после распаковки") }
            // Record the contract, and make sure it LANDED: a silently failed write means the
            // next launch re-downloads 300 MB for nothing.
            try Self.engineContract.write(to: Self.contractFile, atomically: true, encoding: .utf8)
            guard Self.installedContract() == Self.engineContract else { throw Err.msg("не удалось записать контракт движка") }
            state = .installed
            os_log("installer: engine installed at %{public}@", log: log, type: .info, Self.engineApp.path)
        } catch {
            // A failed install must not leave the ~250 MB staging tree + zip on disk.
            try? FileManager.default.removeItem(at: Self.installRoot.appendingPathComponent("staging", isDirectory: true))
            try? FileManager.default.removeItem(at: Self.installRoot.appendingPathComponent("engine.download.zip"))
            state = .failed((error as? Err)?.text ?? error.localizedDescription)
            os_log("installer: FAILED: %{public}@", log: log, type: .error, String(describing: error))
        }
    }

    // MARK: helpers

    private enum Err: Error { case msg(String); var text: String { if case let .msg(s) = self { return s }; return "" } }

    /// Reports download progress: `URLSession.download(from:)` alone gives none, so the
    /// first-run 130 MB fetch showed an indeterminate spinner and read as a hang.
    private final class DownloadProgress: NSObject, URLSessionDownloadDelegate {
        private let onFraction: (Double?) -> Void
        init(onFraction: @escaping (Double?) -> Void) { self.onFraction = onFraction }

        func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                        didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                        totalBytesExpectedToWrite totalBytesExpectedToWrite: Int64) {
            onFraction(totalBytesExpectedToWrite > 0
                       ? Double(totalBytesWritten) / Double(totalBytesExpectedToWrite) : nil)
        }

        // Required by the protocol; the async `download(from:delegate:)` returns the file itself.
        func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                        didFinishDownloadingTo location: URL) {}
    }

    /// Delete anything an interrupted install left in the install root. Without this a crash
    /// (or a force-quit) during unpack strands a ~300 MB staging tree that nothing ever clears.
    nonisolated private static func sweepLeftovers() {
        let fm = FileManager.default
        let kids = (try? fm.contentsOfDirectory(at: installRoot, includingPropertiesForKeys: nil)) ?? []
        for k in kids where k.lastPathComponent.hasPrefix("staging-")
            || k.lastPathComponent == "staging"
            || k.lastPathComponent == "MEETAMASKEngine.old"
            || k.lastPathComponent == "engine.download.zip" {
            try? fm.removeItem(at: k)
        }
    }

    /// Extract → authenticate → swap into place. Runs OFF the main actor (see caller).
    /// Staging is per-attempt so two attempts can never delete each other's tree, and the
    /// live engine is moved aside (not deleted) so a crash mid-swap can be rolled back.
    nonisolated private static func unpackAndSwap(zip: URL) throws {
        let staging = installRoot.appendingPathComponent("staging-\(UUID().uuidString)", isDirectory: true)
        defer {
            try? FileManager.default.removeItem(at: staging)
            try? FileManager.default.removeItem(at: zip)
        }
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        try unzip(zip, into: staging)

        guard let staged = locateEngineApp(in: staging) else { throw Err.msg("в архиве нет MEETAMASKEngine.app") }

        // The engine is code we DOWNLOAD and then EXECUTE, so its signature is the only thing
        // between a hijacked download and arbitrary code running as the user. And its own
        // declared contract — not our assumption about it — decides whether it fits this host.
        try verifySignature(staged)
        try verifyDeclaredContract(staged)

        // Swap: move the old one aside, move the new one in, then drop the old one. If the
        // move fails we put the previous engine back rather than leaving nothing installed.
        let old = installRoot.appendingPathComponent("MEETAMASKEngine.old", isDirectory: true)
        try? FileManager.default.removeItem(at: old)
        let hadOld = FileManager.default.fileExists(atPath: engineApp.path)
        if hadOld { try FileManager.default.moveItem(at: engineApp, to: old) }
        do {
            try FileManager.default.moveItem(at: staged, to: engineApp)
        } catch {
            if hadOld { try? FileManager.default.moveItem(at: old, to: engineApp) }
            throw error
        }
        try? FileManager.default.removeItem(at: old)

        // Downloaded code is quarantined → strip it so the subprocess can launch.
        stripQuarantine(engineApp)
    }

    /// The engine states its own wire contract in its Info.plist. Trusting the host's
    /// expectation instead (what we do when we write engine.contract) would stamp ANY
    /// downloaded build as compatible — including a stale 720p one, whose every frame the
    /// receiver then silently drops.
    nonisolated private static func verifyDeclaredContract(_ app: URL) throws {
        let plist = app.appendingPathComponent("Contents/Info.plist")
        guard let data = try? Data(contentsOf: plist),
              let info = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
              let declared = info["MMEngineContract"] as? String
        else { throw Err.msg("движок не сообщает контракт (нужна свежая версия движка)") }
        guard declared == engineContract else {
            throw Err.msg("движок говорит на «\(declared)», хосту нужен «\(engineContract)»")
        }
    }

    nonisolated private static func locateEngineApp(in dir: URL) -> URL? {
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

    nonisolated private static func unzip(_ zip: URL, into dir: URL) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        p.arguments = ["-x", "-k", zip.path, dir.path]   // ditto preserves .app symlinks/perms correctly
        try p.run(); p.waitUntilExit()
        if p.terminationStatus != 0 { throw Err.msg("распаковка не удалась (ditto \(p.terminationStatus))") }
    }

    /// What a downloaded engine must satisfy to be allowed to run: an Apple-rooted chain,
    /// OUR Developer ID team, OUR bundle id. `--strict` walks the whole bundle, so a swapped
    /// framework or helper inside the .app fails too.
    private static let engineRequirement =
        "=anchor apple generic and identifier \"ai.overchat.meetamask.engine\""
        + " and certificate leaf[subject.OU] = \"6D6948Z4MW\""

    /// Refuse to install an engine that isn't ours. Runs on the STAGED copy, before it is
    /// moved into place and before quarantine is stripped — a failed check leaves nothing
    /// executable behind.
    nonisolated private static func verifySignature(_ app: URL) throws {
        #if DEBUG
        // Dev override points at a locally built (often unsigned) engine — only that path skips.
        if ProcessInfo.processInfo.environment["MEETAMASK_ENGINE_URL"] != nil { return }
        #endif
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
        p.arguments = ["--verify", "--strict", "-R", engineRequirement, app.path]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do { try p.run() } catch { throw Err.msg("не удалось проверить подпись движка") }
        p.waitUntilExit()
        guard p.terminationStatus == 0 else {
            throw Err.msg("подпись движка не прошла проверку — установка отменена")
        }
    }

    nonisolated private static func stripQuarantine(_ url: URL) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/xattr")
        p.arguments = ["-dr", "com.apple.quarantine", url.path]
        try? p.run(); p.waitUntilExit()
    }
}
