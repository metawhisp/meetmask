import Foundation
import AppKit
import AVFoundation
import os.log

/// Launches the headless CEF engine with a mask, reads the frames it writes to shared
/// memory, and pushes them to the virtual camera via CameraFeeder. The engine has no
/// window (never throttled) and this relay disables App Nap, so the mask keeps streaming
/// to Meet even when the app is hidden / minimised / Meet is full-screen.
///
/// IMPORTANT: the camera connection (CameraFeeder sink) is opened ONCE and kept alive for
/// the whole session. Switching masks only swaps the engine subprocess — it must NOT
/// disconnect/reconnect the sink, because stopping+restarting the sink stream breaks the
/// live feed a consumer (Photo Booth / Meet) is reading.
final class EngineFrameReceiver: ObservableObject {

    @Published private(set) var isRunning = false
    @Published private(set) var status = "Готов"
    /// Set for anything the USER has to act on (no camera permission, dead engine, stale
    /// engine…). `status` alone was never rendered anywhere, so every one of these messages
    /// was invisible; the UI now shows `problem` verbatim. Cleared when frames flow again.
    @Published private(set) var problem: String?
    @Published var previewImage: NSImage?
    // True from the moment a mask (re)launch is requested until its FIRST real frame lands.
    // The UI uses this to show "Switching…" and to withhold the ON-AIR badge until the new
    // mask is actually on camera (honest status — codex review).
    @Published private(set) var switching = false

    private let feeder = CameraFeeder.shared
    private var process: Process?
    private var base: UnsafeMutableRawPointer?
    private var fd: Int32 = -1
    private var lastSeq: UInt64 = 0
    private var frameCount = 0
    private var pendingFirstFrame = false   // frameQueue-owned: true from (re)launch until first frame
    private var reportedGeometryMismatch = false   // frameQueue-owned: only shout about a stale engine once
    private var expectingExit = false       // frameQueue-owned: WE asked the engine to die — not a crash
    private var lastFrameAt = Date()        // frameQueue-owned: watchdog baseline
    private var reportedStall = false       // frameQueue-owned: say "no frames" once, not 30x/s
    private var previewPending = false      // frameQueue-owned: at most one preview in flight
    private var timer: DispatchSourceTimer?
    private var activity: NSObjectProtocol?

    // All shared-memory + subprocess state (base/lastSeq/process/header) is touched only
    // on this serial queue — tick, relaunch and teardown — so they can never race each
    // other (e.g. munmap during a tick, or two engines writing the same buffer).
    // .userInteractive: this is the only real-time path in the app — a late tick is a dropped
    // frame in someone's call. Everything else in the pipeline already runs at this QoS.
    private let frameQueue = DispatchQueue(label: "com.meetamask.frames", qos: .userInteractive)

    // The shared buffer is a FIXED size. Frames of any other dimensions are rejected on
    // both sides, never copied with attacker/garbage dimensions.
    // Derived from the single source of truth shared with the camera extension
    // (Shared.swift) — the engine renders at exactly this size (engine/frame_geometry.h).
    static let frameW = Int(fixedCamWidth)
    static let frameH = Int(fixedCamHeight)
    // Per-instance shm file: two windows / app instances each get their own buffer, so
    // they can never become two writers on one file (the seqlock assumes a single writer).
    private let shmPath = NSTemporaryDirectory() + "meetamask-frame-\(UUID().uuidString).bin"
    private let total = 16 + EngineFrameReceiver.frameW * EngineFrameReceiver.frameH * 4   // header(16) + BGRA
    private let log = OSLog(subsystem: "com.meetamask.app", category: "receiver")

    init() {
        // Quitting (⌘Q) or closing the window while ON AIR used to skip stop() entirely: the
        // CEF engine kept running, the camera stayed claimed and an 8.3 MB /tmp file stayed
        // behind until reboot. Tear down on the way out.
        NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            self?.stop()
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        if isRunning { stop() }
    }

    /// Start streaming a mask. If already running, ONLY the engine subprocess is swapped;
    /// the camera connection + read loop stay alive.
    func start(maskURL: URL) {
        // Security boundary lives at the loader, not just the gallery list: only ever
        // launch the engine on an app-approved (bundled) mask URL.
        guard isApprovedMaskURL(maskURL) else {
            setError("Маска не одобрена")
            os_log("receiver: refused non-approved mask URL: %{public}@", log: log, type: .error, maskURL.path)
            return
        }
        // 🔒 Fail loud, never silently black: a denied macOS camera permission makes every mask
        // render black. Say so explicitly instead of launching a doomed engine. The host requests
        // access at launch (MEETAMASKApp.init); authorized / notDetermined → proceed normally.
        let camAuth = AVCaptureDevice.authorizationStatus(for: .video)
        if camAuth == .denied || camAuth == .restricted {
            setError("Нет доступа к камере → System Settings ▸ Privacy & Security ▸ Camera ▸ включи MEETAMASK")
            os_log("receiver: camera access denied/restricted — refusing start (masks would be black)", log: log, type: .error)
            return
        }
        switching = true   // on main (start is called from the UI) — cleared when the first frame lands
        if isRunning {
            frameQueue.async { [weak self] in self?.relaunchEngine(maskURL: maskURL) }
            return
        }
        guard Self.findEngine() != nil else { setError("Движок не найден — переустанови приложение"); return }

        fd = open(shmPath, O_RDWR | O_CREAT, 0o666)
        guard fd >= 0 else { setError("Не удалось создать буфер кадров (shm open)"); return }
        // A short file would still mmap: every later access past EOF raises SIGBUS and kills
        // the app. Refuse the start instead (ENOSPC / quota).
        guard ftruncate(fd, off_t(total)) == 0 else {
            releaseSHM()
            setError("Не хватает места для буфера кадров (\(total / 1_000_000) МБ)"); return
        }
        let mapped = mmap(nil, total, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0)
        guard let mapped = mapped, mapped != MAP_FAILED else {
            releaseSHM()                      // don't leak the fd + on-disk file on a failed start
            setError("Не удалось отобразить буфер кадров (mmap)"); return
        }
        base = mapped
        resetHeader()           // clear header so we don't read a stale frame
        lastSeq = 0

        // Kill any internal APP FEED test pattern so it can't flicker through the mask.
        feeder.stopTestFeed()

        // Camera connection — ONCE, kept alive across engine restarts.
        guard feeder.connect() else {
            releaseSHM()                      // ditto: this start never got off the ground
            setError("Камера не найдена. Если только что обновил приложение — перезагрузи Mac: расширение камеры доустанавливается при перезапуске.")
            dbg("feeder.connect() FAILED")
            return
        }
        dbg("feeder connected, read loop starting")

        activity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiated, .idleSystemSleepDisabled],
            reason: "MEETAMASK mask broadcast")

        let t = DispatchSource.makeTimerSource(queue: frameQueue)   // serial: tick never overlaps relaunch/teardown
        t.schedule(deadline: .now() + 0.3, repeating: 1.0 / 30.0, leeway: .milliseconds(2))
        t.setEventHandler { [weak self] in self?.tick() }
        t.resume()
        timer = t

        frameQueue.async { [weak self] in self?.launchEngine(maskURL: maskURL) }
        isRunning = true
        setStatus("Маска идёт в MEETAMASK Camera…")
    }

    /// Swap the mask without touching the camera connection. Runs on `frameQueue`, so it
    /// never overlaps a tick. The OLD engine MUST be gone before we reset the header and
    /// start a new one — two writers (or a reset racing a live writer) would break the
    /// seqlock's single-writer assumption and could publish a torn frame.
    private func relaunchEngine(maskURL: URL) {
        if let p = process { waitForExit(p, timeout: 2.0) }
        process = nil
        resetHeader()                 // no writer is alive now → safe to reset
        lastSeq = 0
        launchEngine(maskURL: maskURL)
        os_log("receiver: engine relaunched for new mask (feeder kept alive)", log: log, type: .info)
    }

    /// Terminate the engine and GUARANTEE it is gone before returning: SIGTERM, wait
    /// briefly, then SIGKILL (uncatchable) and reap. This is what makes the seqlock's
    /// single-writer assumption hold across mask switches and stop/start — the old
    /// writer is always dead before a new one (or a header reset) touches the buffer.
    private func waitForExit(_ p: Process, timeout: TimeInterval) {
        expectingExit = true
        defer { expectingExit = false }
        p.terminate()   // SIGTERM
        let deadline = Date().addingTimeInterval(timeout)
        while p.isRunning && Date() < deadline { usleep(5_000) }
        if p.isRunning {
            kill(p.processIdentifier, SIGKILL)   // hard kill — cannot be ignored
            let killDeadline = Date().addingTimeInterval(1.0)   // SIGKILL is near-instant; bound anyway
            while p.isRunning && Date() < killDeadline { usleep(5_000) }
        }
    }

    /// Zero the header with an aligned 8-byte store for `seq` (atomic on arm64), so a
    /// concurrent reader never observes a half-written sequence number.
    private func resetHeader() {
        guard let b = base else { return }
        b.storeBytes(of: UInt32(0), toByteOffset: 8, as: UInt32.self)
        b.storeBytes(of: UInt32(0), toByteOffset: 12, as: UInt32.self)
        OSMemoryBarrier()
        b.storeBytes(of: UInt64(0), toByteOffset: 0, as: UInt64.self)
    }

    /// A mask URL is approved if it lives inside the app's bundled Masks dir (trusted,
    /// app-authored) OR the user's imported-masks dir (untrusted — run in the engine jail).
    /// Rejects arbitrary paths. Symlinks are resolved so a link can't point outside either root.
    private func isApprovedMaskURL(_ url: URL) -> Bool {
        isURL(url, under: Self.bundleMasksDir) || isURL(url, under: MaskLibrary.userMasksDir)
    }

    /// True when the mask is USER-imported → the engine MUST run it sandboxed (`--untrusted`).
    /// Path-derived, not a UI flag: a mask under userMasksDir can never accidentally run trusted.
    private func isUntrustedMaskURL(_ url: URL) -> Bool {
        isURL(url, under: MaskLibrary.userMasksDir) && !isURL(url, under: Self.bundleMasksDir)
    }

    private static var bundleMasksDir: URL? {
        Bundle.main.resourceURL?.appendingPathComponent("Masks", isDirectory: true)
    }

    /// Is `url` the same as, or nested inside, `root` — after resolving symlinks on both sides?
    private func isURL(_ url: URL, under root: URL?) -> Bool {
        guard url.isFileURL, let root = root else { return false }
        let base = root.resolvingSymlinksInPath().standardizedFileURL.path
        let cand = url.resolvingSymlinksInPath().standardizedFileURL.path
        return cand == base || cand.hasPrefix(base + "/")
    }

    private func launchEngine(maskURL: URL) {
        pendingFirstFrame = true   // frameQueue: next committed frame clears `switching`
        reportedGeometryMismatch = false   // a fresh engine deserves a fresh verdict
        lastFrameAt = Date()               // the watchdog measures from the launch, not from boot
        guard let enginePath = Self.findEngine() else {
            // Returning silently here left the UI stuck on "Switching…" with a dead stream.
            setError("Движок пропал — переустанови приложение")
            return
        }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: enginePath)
        // Pass as --key=value switches (NOT positional args) so Chromium never treats
        // the shm path or mask URL as a page to open / download.
        var args = ["--shm=\(shmPath)", "--mask=\(maskURL.absoluteString)"]
        // User-imported masks are untrusted HTML → run them in the engine's FS + network jail.
        if isUntrustedMaskURL(maskURL) { args.append("--untrusted") }
        p.arguments = args
        // CEF crashes happen. Without this the receiver kept ticking against a dead writer:
        // last frame frozen on camera, UI still claiming "Маска идёт…". Report it instead.
        p.terminationHandler = { [weak self] proc in
            guard let self = self else { return }
            self.frameQueue.async {
                guard self.process === proc, !self.expectingExit else { return }   // we didn't ask for this
                self.process = nil
                self.setError("Движок остановился (код \(proc.terminationStatus)) — нажми Go live, чтобы перезапустить")
            }
        }
        do { try p.run() } catch {
            setError("Не удалось запустить движок: \(error.localizedDescription)")
            os_log("receiver: engine launch failed: %{public}@", log: log, type: .error, String(describing: error))
            return
        }
        process = p
    }

    func stop() {
        timer?.cancel(); timer = nil
        // Tear down shm + subprocess on the frame queue so it runs AFTER any in-flight
        // tick — never munmap a buffer a tick is still reading.
        frameQueue.sync {
            if let p = self.process { self.waitForExit(p, timeout: 1.5) }   // old writer dead before teardown
            self.process = nil
            self.releaseSHM()
        }
        feeder.disconnect()
        if let a = activity { ProcessInfo.processInfo.endActivity(a); activity = nil }
        isRunning = false
        switching = false
        os_log("receiver: stopped (feeder disconnected)", log: log, type: .info)
        DispatchQueue.main.async { self.previewImage = nil }
    }

    /// Release the shared-memory mapping, its fd AND the backing file. The path is unique per
    /// session, so leaving it behind leaked one 8.3 MB file in /tmp per run (they only vanish
    /// on reboot). Safe to call twice.
    private func releaseSHM() {
        if let b = base { munmap(b, total); base = nil }
        if fd >= 0 { close(fd); fd = -1 }
        unlink(shmPath)
    }

    private func tick() {
        guard let base = base else { return }
        // Frames can stop without the process dying: the renderer wedges, the page throws,
        // the mask hangs. Nothing else notices — the camera just freezes on the last frame.
        if !reportedStall, Date().timeIntervalSince(lastFrameAt) > 4.0 {
            reportedStall = true
            setError("Движок не отдаёт кадры 4 секунды — переключи маску или нажми Go live")
        }
        // Seqlock read (mirrors engine/frame_shm.mm + engine/test/seqlock_test.mm):
        // the engine publishes EVEN sequence numbers and marks a write in progress as
        // ODD. Reject odd, copy the frame, then re-read seq and only COMMIT if it did
        // not change across the copy. Otherwise a half-written (torn) frame could be
        // pushed to the virtual camera. Bounded retries; the next tick catches up.
        // Retries sleep ~0.3 ms: the writer holds the odd marker for the length of an 8.3 MB
        // memcpy (~1 ms), so spinning 8 times in a microsecond just guaranteed we lost the
        // whole 33 ms tick. 8 x 0.3 ms outlasts a write and still leaves the budget intact.
        for _ in 0..<8 {
            let s1 = base.load(fromByteOffset: 0, as: UInt64.self)
            if s1 & 1 == 1 { usleep(300); continue }   // writer mid-write → back off, retry
            if s1 == lastSeq { return }          // no new frame
            OSMemoryBarrier()   // acquire: dimension + data reads must happen-after reading s1
            let w = Int(base.load(fromByteOffset: 8, as: UInt32.self))
            let h = Int(base.load(fromByteOffset: 12, as: UInt32.self))
            // Fixed-size buffer — reject any other dimensions instead of copying past it.
            // A PERSISTENT mismatch means the installed engine speaks an older wire contract
            // (e.g. a 720p engine left over from a previous app version). Dropping frames
            // silently would look like a dead camera, so say it out loud — once.
            guard w == Self.frameW, h == Self.frameH else {
                if !reportedGeometryMismatch {
                    reportedGeometryMismatch = true
                    os_log("receiver: engine publishes %dx%d, expected %dx%d — engine is outdated",
                           log: log, type: .error, w, h, Self.frameW, Self.frameH)
                    setError("Движок устарел (\(w)×\(h) вместо \(Self.frameW)×\(Self.frameH)) — переустанови движок")
                }
                return
            }
            let data = base.advanced(by: 16)
            // Copy out (into a CVPixelBuffer, and optionally the preview image) while
            // the frame is believed stable…
            let sbuf = feeder.makeSampleBuffer(fromBGRA: data, width: w, height: h)
            // The preview is a small thumbnail in the app window — building a full 8.3 MB
            // NSImage 15x/s (~124 MB/s) and firing each one at the main queue could pile up
            // unbounded if the main thread stalls. Downscale, and never queue more than one.
            let img = (!previewPending && frameCount % 6 == 0) ? Self.makePreview(data, w, h) : nil
            OSMemoryBarrier()
            // …then verify no write started during the copy. If it did, discard and retry.
            if base.load(fromByteOffset: 0, as: UInt64.self) != s1 { usleep(300); continue }

            lastSeq = s1
            lastFrameAt = Date()
            if reportedStall {       // frames are back — stop shouting
                reportedStall = false
                setStatus("Маска идёт в MEETAMASK Camera…")
            }
            if pendingFirstFrame {   // first real frame of the new mask → it's actually on camera now
                pendingFirstFrame = false
                DispatchQueue.main.async { self.switching = false; self.problem = nil }
            }
            if let sbuf = sbuf { feeder.enqueue(sbuf) }
            frameCount &+= 1
            #if DEBUG
            if frameCount % 30 == 0 {   // ~1/s: proof the push is alive (dev only — no disk writes in a release)
                let line = "read=\(frameCount) seq=\(s1) sinkReady=\(feeder.sinkReady) pushedToCamera=\(feeder.totalPushed)"
                dbg(line)
                try? line.write(toFile: "/tmp/mm-push.txt", atomically: true, encoding: .utf8)
            }
            #endif
            if let img = img {
                previewPending = true
                DispatchQueue.main.async {
                    self.previewImage = img
                    self.frameQueue.async { self.previewPending = false }
                }
            }
            return
        }
    }

    /// Build a SMALL preview image from a tightly-packed BGRA buffer. The window shows a
    /// thumbnail, so the full 1080p frame is downscaled here (once, on the frame queue)
    /// instead of shipping 8.3 MB to the main thread and letting AppKit scale it.
    private static let previewSpace = CGColorSpaceCreateDeviceRGB()   // one, not one per frame
    private static func makePreview(_ data: UnsafeRawPointer, _ w: Int, _ h: Int) -> NSImage? {
        let bitmapInfo = CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        guard let src = CGContext(data: UnsafeMutableRawPointer(mutating: data),
                                  width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: previewSpace, bitmapInfo: bitmapInfo),
              let full = src.makeImage() else { return nil }
        let pw = 480, ph = max(1, h * 480 / max(1, w))
        guard let dst = CGContext(data: nil, width: pw, height: ph, bitsPerComponent: 8,
                                  bytesPerRow: 0, space: previewSpace, bitmapInfo: bitmapInfo)
        else { return NSImage(cgImage: full, size: NSSize(width: w, height: h)) }
        dst.interpolationQuality = .medium
        dst.draw(full, in: CGRect(x: 0, y: 0, width: pw, height: ph))
        guard let small = dst.makeImage() else { return nil }
        return NSImage(cgImage: small, size: NSSize(width: pw, height: ph))
    }

    private func setStatus(_ s: String) { DispatchQueue.main.async { self.status = s; self.problem = nil } }

    /// Something the user must fix or know about. Unlike `setStatus` this also lights up
    /// `problem`, which the UI renders — silent failures are how a dead engine used to look
    /// exactly like a working one.
    private func setError(_ s: String) {
        os_log("receiver: PROBLEM: %{public}@", log: log, type: .error, s)
        DispatchQueue.main.async { self.status = s; self.problem = s; self.switching = false }
    }

    /// Unbuffered debug line to stderr (visible when the app is launched from a terminal).
    private func dbg(_ s: String) { fputs("MEETAMASK receiver: \(s)\n", stderr) }

    /// Locate the engine: bundled in the app, else the dev build output.
    static func findEngine() -> String? {
        // 1) Downloaded engine in Application Support — the normal location. Keeps the shipped
        //    app tiny; the engine arrives once on first launch (see EngineInstaller).
        if FileManager.default.isExecutableFile(atPath: EngineInstaller.enginePath) {
            return EngineInstaller.enginePath
        }
        // 2) Engine embedded in the app bundle (only if a build chooses to ship it inside).
        if let res = Bundle.main.resourceURL {
            let bundled = res.appendingPathComponent("MEETAMASKEngine.app/Contents/MacOS/MEETAMASKEngine").path
            if FileManager.default.isExecutableFile(atPath: bundled) { return bundled }
        }
        #if DEBUG
        // 3) Local dev build output.
        let dev = "/Users/android/MEETOMASK/engine/build/Release/MEETAMASKEngine.app/Contents/MacOS/MEETAMASKEngine"
        if FileManager.default.isExecutableFile(atPath: dev) { return dev }
        #endif
        return nil
    }
}
