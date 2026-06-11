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
    private var timer: DispatchSourceTimer?
    private var activity: NSObjectProtocol?

    // All shared-memory + subprocess state (base/lastSeq/process/header) is touched only
    // on this serial queue — tick, relaunch and teardown — so they can never race each
    // other (e.g. munmap during a tick, or two engines writing the same buffer).
    private let frameQueue = DispatchQueue(label: "com.meetamask.frames")

    // The shared buffer is a FIXED size. Frames of any other dimensions are rejected on
    // both sides, never copied with attacker/garbage dimensions.
    static let frameW = 1280
    static let frameH = 720
    // Per-instance shm file: two windows / app instances each get their own buffer, so
    // they can never become two writers on one file (the seqlock assumes a single writer).
    private let shmPath = NSTemporaryDirectory() + "meetamask-frame-\(UUID().uuidString).bin"
    private let total = 16 + EngineFrameReceiver.frameW * EngineFrameReceiver.frameH * 4   // header(16) + BGRA
    private let log = OSLog(subsystem: "com.meetamask.app", category: "receiver")

    /// Start streaming a mask. If already running, ONLY the engine subprocess is swapped;
    /// the camera connection + read loop stay alive.
    func start(maskURL: URL) {
        // Security boundary lives at the loader, not just the gallery list: only ever
        // launch the engine on an app-approved (bundled) mask URL.
        guard isApprovedMaskURL(maskURL) else {
            setStatus("Маска не одобрена")
            os_log("receiver: refused non-approved mask URL: %{public}@", log: log, type: .error, maskURL.path)
            return
        }
        // 🔒 Fail loud, never silently black: a denied macOS camera permission makes every mask
        // render black. Say so explicitly instead of launching a doomed engine. The host requests
        // access at launch (MEETAMASKApp.init); authorized / notDetermined → proceed normally.
        let camAuth = AVCaptureDevice.authorizationStatus(for: .video)
        if camAuth == .denied || camAuth == .restricted {
            setStatus("Нет доступа к камере → System Settings ▸ Privacy & Security ▸ Camera ▸ включи MEETAMASK")
            os_log("receiver: camera access denied/restricted — refusing start (masks would be black)", log: log, type: .error)
            return
        }
        switching = true   // on main (start is called from the UI) — cleared when the first frame lands
        if isRunning {
            frameQueue.async { [weak self] in self?.relaunchEngine(maskURL: maskURL) }
            return
        }
        guard Self.findEngine() != nil else { setStatus("Движок не найден"); return }

        fd = open(shmPath, O_RDWR | O_CREAT, 0o666)
        guard fd >= 0 else { setStatus("shm open failed"); return }
        ftruncate(fd, off_t(total))
        let mapped = mmap(nil, total, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0)
        guard let mapped = mapped, mapped != MAP_FAILED else { setStatus("mmap failed"); return }
        base = mapped
        resetHeader()           // clear header so we don't read a stale frame
        lastSeq = 0

        // Kill any internal APP FEED test pattern so it can't flicker through the mask.
        feeder.stopTestFeed()

        // Camera connection — ONCE, kept alive across engine restarts.
        guard feeder.connect() else {
            setStatus("Камера не найдена. Расширение активно?")
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

    /// A mask URL is approved only if it is a file URL inside the app's bundled Masks
    /// directory (the app-approved set). Rejects user-dropped / arbitrary paths.
    private func isApprovedMaskURL(_ url: URL) -> Bool {
        guard url.isFileURL,
              let root = Bundle.main.resourceURL?.appendingPathComponent("Masks", isDirectory: true)
        else { return false }
        // Resolve symlinks (not just lexical ./..) so a link under Masks/ can't point out.
        let approved = root.resolvingSymlinksInPath().standardizedFileURL.path
        let candidate = url.resolvingSymlinksInPath().standardizedFileURL.path
        return candidate == approved || candidate.hasPrefix(approved + "/")
    }

    private func launchEngine(maskURL: URL) {
        pendingFirstFrame = true   // frameQueue: next committed frame clears `switching`
        guard let enginePath = Self.findEngine() else { return }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: enginePath)
        // Pass as --key=value switches (NOT positional args) so Chromium never treats
        // the shm path or mask URL as a page to open / download.
        p.arguments = ["--shm=\(shmPath)", "--mask=\(maskURL.absoluteString)"]
        do { try p.run() } catch {
            setStatus("Не удалось запустить движок: \(error.localizedDescription)")
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
            if let b = self.base { munmap(b, self.total); self.base = nil }
            if self.fd >= 0 { close(self.fd); self.fd = -1 }
        }
        feeder.disconnect()
        if let a = activity { ProcessInfo.processInfo.endActivity(a); activity = nil }
        isRunning = false
        switching = false
        os_log("receiver: stopped (feeder disconnected)", log: log, type: .info)
        DispatchQueue.main.async { self.previewImage = nil }
    }

    private func tick() {
        guard let base = base else { return }
        // Seqlock read (mirrors engine/frame_shm.mm + engine/test/seqlock_test.mm):
        // the engine publishes EVEN sequence numbers and marks a write in progress as
        // ODD. Reject odd, copy the frame, then re-read seq and only COMMIT if it did
        // not change across the copy. Otherwise a half-written (torn) frame could be
        // pushed to the virtual camera. Bounded retries; the next tick catches up.
        for _ in 0..<8 {
            let s1 = base.load(fromByteOffset: 0, as: UInt64.self)
            if s1 & 1 == 1 { continue }          // writer mid-write → retry
            if s1 == lastSeq { return }          // no new frame
            OSMemoryBarrier()   // acquire: dimension + data reads must happen-after reading s1
            let w = Int(base.load(fromByteOffset: 8, as: UInt32.self))
            let h = Int(base.load(fromByteOffset: 12, as: UInt32.self))
            // Fixed-size buffer — reject any other dimensions instead of copying past it.
            guard w == Self.frameW, h == Self.frameH else { return }
            let data = base.advanced(by: 16)
            // Copy out (into a CVPixelBuffer, and optionally the preview image) while
            // the frame is believed stable…
            let sbuf = feeder.makeSampleBuffer(fromBGRA: data, width: w, height: h)
            let img = (frameCount % 2 == 0) ? Self.makeImage(data, w, h) : nil
            OSMemoryBarrier()
            // …then verify no write started during the copy. If it did, discard and retry.
            if base.load(fromByteOffset: 0, as: UInt64.self) != s1 { continue }

            lastSeq = s1
            if pendingFirstFrame {   // first real frame of the new mask → it's actually on camera now
                pendingFirstFrame = false
                DispatchQueue.main.async { self.switching = false }
            }
            if let sbuf = sbuf { feeder.enqueue(sbuf) }
            frameCount &+= 1
            if frameCount % 30 == 0 {   // ~1/s: proof the push is alive
                let line = "read=\(frameCount) seq=\(s1) sinkReady=\(feeder.sinkReady) pushedToCamera=\(feeder.totalPushed)"
                dbg(line)
                try? line.write(toFile: "/tmp/mm-push.txt", atomically: true, encoding: .utf8)
            }
            if let img = img {
                DispatchQueue.main.async { self.previewImage = img }
            }
            return
        }
    }

    /// Build an NSImage from a tightly-packed BGRA buffer (copies, so shm may be reused).
    private static func makeImage(_ data: UnsafeRawPointer, _ w: Int, _ h: Int) -> NSImage? {
        let bitmapInfo = CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        guard let ctx = CGContext(data: UnsafeMutableRawPointer(mutating: data),
                                  width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: bitmapInfo),
              let cg = ctx.makeImage() else { return nil }
        return NSImage(cgImage: cg, size: NSSize(width: w, height: h))
    }

    private func setStatus(_ s: String) { DispatchQueue.main.async { self.status = s } }

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
