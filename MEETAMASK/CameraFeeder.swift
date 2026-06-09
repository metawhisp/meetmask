import Foundation
import AVFoundation
import CoreMedia
import CoreMediaIO
import AppKit
import os.log

/// Owns the connection to the MEETAMASK virtual camera's SINK stream and pushes frames
/// into it. The frame SOURCE is pluggable:
///  - `startTestFeed()` drives an internal "APP FEED" test pattern (proves the pipe).
///  - external callers (e.g. the mask studio) call `connect()` then `enqueue(makeSampleBuffer(from:))`.
///
/// Shared singleton so the whole app feeds ONE sink (only one source at a time).
final class CameraFeeder: NSObject, ObservableObject {

    static let shared = CameraFeeder()

    @Published private(set) var statusText: String = "Idle"
    @Published private(set) var isFeeding: Bool = false           // test feed running
    private(set) var sinkReady = false

    private var connected = false
    private var deviceID: CMIOObjectID?
    private var sourceStreamID: CMIOStreamID?
    private var sinkStreamID: CMIOStreamID?
    private var sinkQueue: CMSimpleQueue?

    private var frameTimer: DispatchSourceTimer?
    private let timerQueue = DispatchQueue(label: "com.meetamask.app.feeder",
                                           qos: .userInteractive,
                                           autoreleaseFrequency: .workItem)
    private var readinessTimer: Timer?

    private var pool: CVPixelBufferPool?
    private var formatDescription: CMFormatDescription?
    private var frameIndex: UInt64 = 0

    private var framesSinceMark = 0
    private var lastMark = Date()
    private(set) var totalPushed: UInt64 = 0   // cumulative frames accepted by the sink queue

    // MARK: Connection (shared by test feed and external sources)

    /// Idempotent: connect to the sink + prepare the frame pool. Returns true if ready to enqueue.
    @discardableResult
    func connect() -> Bool {
        if connected { return true }
        guard connectToSink() else {
            setStatus("Не нашёл MEETAMASK Camera или её sink. Расширение активно?")
            return false
        }
        guard setupPool() else {
            setStatus("Не удалось создать пул кадров.")
            return false
        }
        startReadinessPolling()
        connected = true
        os_log("MEETAMASK feeder: connected, sink stream started (device+source+sink found)")
        return true
    }

    func disconnect() {
        readinessTimer?.invalidate(); readinessTimer = nil
        if let dev = deviceID, let sink = sinkStreamID { CMIODeviceStopStream(dev, sink) }
        sinkQueue = nil
        sinkReady = false
        connected = false
    }

    /// Push one frame to the virtual camera. Drops (never blocks) if the queue is full or sink not ready.
    func enqueue(_ sampleBuffer: CMSampleBuffer) {
        guard sinkReady, let queue = sinkQueue else { return }
        if CMSimpleQueueGetCount(queue) < CMSimpleQueueGetCapacity(queue) {
            let ptr = UnsafeMutableRawPointer(Unmanaged.passRetained(sampleBuffer).toOpaque())
            if CMSimpleQueueEnqueue(queue, element: ptr) != noErr {
                Unmanaged<CMSampleBuffer>.fromOpaque(ptr).release()
            } else {
                framesSinceMark += 1
                totalPushed &+= 1
            }
        }
        markFPSIfNeeded()
    }

    /// Wrap a raw tightly-packed BGRA buffer (from the engine's shared memory) into a
    /// 1280×720 sample buffer using the shared pool.
    func makeSampleBuffer(fromBGRA bytes: UnsafeRawPointer, width: Int, height: Int) -> CMSampleBuffer? {
        guard let pool = pool, let fmt = formatDescription else { return nil }
        var pixelBuffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixelBuffer) == kCVReturnSuccess,
              let pixelBuffer = pixelBuffer else { return nil }
        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        let dstStride = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let dstH = CVPixelBufferGetHeight(pixelBuffer)
        let srcStride = width * 4
        let rows = min(dstH, height)
        let rowBytes = min(dstStride, srcStride)
        if let dst = CVPixelBufferGetBaseAddress(pixelBuffer) {
            for y in 0..<rows {
                memcpy(dst.advanced(by: y * dstStride), bytes.advanced(by: y * srcStride), rowBytes)
            }
        }
        CVPixelBufferUnlockBaseAddress(pixelBuffer, [])
        var sbuf: CMSampleBuffer?
        var timing = CMSampleTimingInfo()
        timing.presentationTimeStamp = CMClockGetTime(CMClockGetHostTimeClock())
        let err = CMSampleBufferCreateForImageBuffer(allocator: kCFAllocatorDefault,
                                                     imageBuffer: pixelBuffer, dataReady: true,
                                                     makeDataReadyCallback: nil, refcon: nil,
                                                     formatDescription: fmt, sampleTiming: &timing,
                                                     sampleBufferOut: &sbuf)
        return err == noErr ? sbuf : nil
    }

    /// Wrap a rendered image into a 1280×720 BGRA sample buffer using the shared pool.
    func makeSampleBuffer(from image: NSImage) -> CMSampleBuffer? {
        guard let pool = pool, let fmt = formatDescription else { return nil }
        var pixelBuffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixelBuffer) == kCVReturnSuccess,
              let pixelBuffer = pixelBuffer else { return nil }

        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        let w = CVPixelBufferGetWidth(pixelBuffer)
        let h = CVPixelBufferGetHeight(pixelBuffer)
        if let ctx = CGContext(data: CVPixelBufferGetBaseAddress(pixelBuffer),
                               width: w, height: h, bitsPerComponent: 8,
                               bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
                               space: CGColorSpaceCreateDeviceRGB(),
                               bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue) {
            ctx.setFillColor(NSColor.black.cgColor)
            ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
            let nsCtx = NSGraphicsContext(cgContext: ctx, flipped: false)
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = nsCtx
            image.draw(in: CGRect(x: 0, y: 0, width: w, height: h),
                       from: .zero, operation: .copy, fraction: 1.0)
            NSGraphicsContext.restoreGraphicsState()
        }
        CVPixelBufferUnlockBaseAddress(pixelBuffer, [])

        var sbuf: CMSampleBuffer?
        var timing = CMSampleTimingInfo()
        timing.presentationTimeStamp = CMClockGetTime(CMClockGetHostTimeClock())
        let err = CMSampleBufferCreateForImageBuffer(allocator: kCFAllocatorDefault,
                                                     imageBuffer: pixelBuffer, dataReady: true,
                                                     makeDataReadyCallback: nil, refcon: nil,
                                                     formatDescription: fmt, sampleTiming: &timing,
                                                     sampleBufferOut: &sbuf)
        return err == noErr ? sbuf : nil
    }

    // MARK: Test feed (Камера tab — "Feed app frames")

    func start() {
        guard !isFeeding else { return }
        guard connect() else { return }
        frameIndex = 0; framesSinceMark = 0; lastMark = Date()
        let timer = DispatchSource.makeTimerSource(flags: .strict, queue: timerQueue)
        timer.schedule(deadline: .now(), repeating: 1.0 / Double(kFrameRate), leeway: .milliseconds(2))
        timer.setEventHandler { [weak self] in
            guard let self = self, let pool = self.pool, let fmt = self.formatDescription else { return }
            if let sbuf = CameraFeeder.makeTestFrame(index: self.frameIndex, pool: pool, formatDescription: fmt) {
                self.frameIndex += 1
                self.enqueue(sbuf)
            }
        }
        timer.resume()
        frameTimer = timer
        isFeeding = true
        setStatus("Подключился к sink, кормлю камеру (APP FEED)…")
    }

    func stop() {
        frameTimer?.cancel(); frameTimer = nil
        disconnect()
        isFeeding = false
        setStatus("Остановлено.")
    }

    /// Stop the internal APP FEED test pattern WITHOUT dropping the sink connection, so a
    /// real source (the mask engine) can own the feed without the test pattern flickering
    /// through it.
    func stopTestFeed() {
        frameTimer?.cancel(); frameTimer = nil
        isFeeding = false
    }

    // MARK: Sink connection internals

    private func connectToSink() -> Bool {
        guard let device = findDevice(named: cameraName) else {
            os_log(.error, "MEETAMASK feeder: AVCaptureDevice '%{public}@' not found", cameraName); return false
        }
        guard let devID = cmioDeviceID(forUID: device.uniqueID) else {
            os_log(.error, "MEETAMASK feeder: CMIO device for UID not found"); return false
        }
        let streams = cmioStreams(of: devID)
        guard streams.count >= 2, let source = streams.first, let sink = streams.last, source != sink else {
            os_log(.error, "MEETAMASK feeder: device has no distinct source+sink streams (%d)", streams.count); return false
        }
        deviceID = devID; sourceStreamID = source; sinkStreamID = sink

        let pointerQueue = UnsafeMutablePointer<Unmanaged<CMSimpleQueue>?>.allocate(capacity: 1)
        defer { pointerQueue.deallocate() }
        let refcon = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
        let copyErr = CMIOStreamCopyBufferQueue(sink, { _, _, _ in }, refcon, pointerQueue)
        guard copyErr == noErr, let unmanaged = pointerQueue.pointee else {
            os_log(.error, "MEETAMASK feeder: CMIOStreamCopyBufferQueue failed (%d)", copyErr); return false
        }
        guard CMIODeviceStartStream(devID, sink) == noErr else {
            os_log(.error, "MEETAMASK feeder: CMIODeviceStartStream failed"); return false
        }
        sinkQueue = unmanaged.takeUnretainedValue()
        return true
    }

    private func setupPool() -> Bool {
        if pool != nil, formatDescription != nil { return true }
        let attrs: NSDictionary = [
            kCVPixelBufferWidthKey: fixedCamWidth,
            kCVPixelBufferHeightKey: fixedCamHeight,
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
            kCVPixelBufferIOSurfacePropertiesKey: [:]
        ]
        var newPool: CVPixelBufferPool?
        guard CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, attrs, &newPool) == kCVReturnSuccess,
              let newPool = newPool else { return false }
        pool = newPool
        CMVideoFormatDescriptionCreate(allocator: kCFAllocatorDefault, codecType: kCVPixelFormatType_32BGRA,
                                       width: fixedCamWidth, height: fixedCamHeight,
                                       extensions: nil, formatDescriptionOut: &formatDescription)
        return formatDescription != nil
    }

    private func startReadinessPolling() {
        let selector = SinkPropertyName.sink.rawValue.convertedToCMIOObjectPropertySelectorName()
        readinessTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self = self, let source = self.sourceStreamID else { return }
            self.sinkReady = (self.stringProperty(selector: selector, on: source) == SinkStateOptions.trueState.rawValue)
        }
        readinessTimer?.fire()
    }

    // MARK: Test-pattern frame

    private static func makeTestFrame(index: UInt64, pool: CVPixelBufferPool, formatDescription: CMFormatDescription) -> CMSampleBuffer? {
        var pixelBuffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixelBuffer) == kCVReturnSuccess,
              let pixelBuffer = pixelBuffer else { return nil }
        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        let width = CVPixelBufferGetWidth(pixelBuffer), height = CVPixelBufferGetHeight(pixelBuffer)
        if let ctx = CGContext(data: CVPixelBufferGetBaseAddress(pixelBuffer), width: width, height: height,
                               bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
                               space: CGColorSpaceCreateDeviceRGB(),
                               bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue) {
            let nsCtx = NSGraphicsContext(cgContext: ctx, flipped: false)
            NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = nsCtx
            drawAppFeed(into: ctx, width: width, height: height, index: index)
            NSGraphicsContext.restoreGraphicsState()
        }
        CVPixelBufferUnlockBaseAddress(pixelBuffer, [])
        var sbuf: CMSampleBuffer?
        var timing = CMSampleTimingInfo(); timing.presentationTimeStamp = CMClockGetTime(CMClockGetHostTimeClock())
        let err = CMSampleBufferCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixelBuffer,
                                                     dataReady: true, makeDataReadyCallback: nil, refcon: nil,
                                                     formatDescription: formatDescription, sampleTiming: &timing, sampleBufferOut: &sbuf)
        return err == noErr ? sbuf : nil
    }

    private static func drawAppFeed(into context: CGContext, width: Int, height: Int, index: UInt64) {
        let w = CGFloat(width), h = CGFloat(height)
        context.setFillColor(NSColor(calibratedRed: 0.04, green: 0.18, blue: 0.22, alpha: 1).cgColor)
        context.fill(CGRect(x: 0, y: 0, width: w, height: h))
        let period = UInt64(max(kFrameRate, 1) * 3)
        let phase = CGFloat(index % period) / CGFloat(period)
        let blockW = w * 0.12
        context.setFillColor(NSColor.systemOrange.cgColor)
        context.fill(CGRect(x: phase * (w - blockW), y: h * 0.12, width: blockW, height: h * 0.12))
        let seconds = CMClockGetTime(CMClockGetHostTimeClock()).seconds
        let p = NSMutableParagraphStyle(); p.alignment = .center
        let label = NSMutableAttributedString()
        label.append(NSAttributedString(string: "APP FEED\n", attributes: [.font: NSFont.systemFont(ofSize: 96, weight: .heavy), .foregroundColor: NSColor.white, .paragraphStyle: p]))
        label.append(NSAttributedString(string: "frame \(index) · \(String(format: "%.1f", seconds))s · pushed by MEETAMASK app", attributes: [.font: NSFont.systemFont(ofSize: 30, weight: .medium), .foregroundColor: NSColor.systemOrange, .paragraphStyle: p]))
        let b = label.boundingRect(with: NSSize(width: w, height: h), options: [.usesLineFragmentOrigin])
        label.draw(with: CGRect(x: 0, y: (h - b.height) / 2, width: w, height: b.height), options: [.usesLineFragmentOrigin])
    }

    // MARK: CMIO helpers

    private func findDevice(named name: String) -> AVCaptureDevice? {
        AVCaptureDevice.DiscoverySession(deviceTypes: [.externalUnknown], mediaType: .video, position: .unspecified)
            .devices.first { $0.localizedName == name }
    }

    private func cmioDeviceID(forUID uid: String) -> CMIOObjectID? {
        var address = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices),
                                                mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                                mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
        var dataSize: UInt32 = 0, used: UInt32 = 0
        CMIOObjectGetPropertyDataSize(CMIOObjectPropertySelector(kCMIOObjectSystemObject), &address, 0, nil, &dataSize)
        var ids = [CMIOObjectID](repeating: 0, count: Int(dataSize) / MemoryLayout<CMIOObjectID>.size)
        CMIOObjectGetPropertyData(CMIOObjectPropertySelector(kCMIOObjectSystemObject), &address, 0, nil, dataSize, &used, &ids)
        for id in ids {
            address.mSelector = CMIOObjectPropertySelector(kCMIODevicePropertyDeviceUID)
            CMIOObjectGetPropertyDataSize(id, &address, 0, nil, &dataSize)
            var name: NSString = ""
            CMIOObjectGetPropertyData(id, &address, 0, nil, dataSize, &used, &name)
            if String(name) == uid { return id }
        }
        return nil
    }

    private func cmioStreams(of deviceID: CMIOObjectID) -> [CMIOStreamID] {
        var address = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIODevicePropertyStreams),
                                                mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                                mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
        var dataSize: UInt32 = 0, used: UInt32 = 0
        CMIOObjectGetPropertyDataSize(deviceID, &address, 0, nil, &dataSize)
        var ids = [CMIOStreamID](repeating: 0, count: Int(dataSize) / MemoryLayout<CMIOStreamID>.size)
        CMIOObjectGetPropertyData(deviceID, &address, 0, nil, dataSize, &used, &ids)
        return ids
    }

    private func stringProperty(selector: CMIOObjectPropertySelector, on streamID: CMIOStreamID) -> String? {
        var address = CMIOObjectPropertyAddress(mSelector: selector,
                                                mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                                mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
        guard CMIOObjectHasProperty(streamID, &address) else { return nil }
        var dataSize: UInt32 = 0, used: UInt32 = 0
        CMIOObjectGetPropertyDataSize(streamID, &address, 0, nil, &dataSize)
        var value: NSString = ""
        CMIOObjectGetPropertyData(streamID, &address, 0, nil, dataSize, &used, &value)
        return value as String
    }

    private func markFPSIfNeeded() {
        let now = Date(); let elapsed = now.timeIntervalSince(lastMark)
        if elapsed >= 1.0 {
            let fps = Double(framesSinceMark) / elapsed
            framesSinceMark = 0; lastMark = now
            let ready = sinkReady
            DispatchQueue.main.async {
                if self.isFeeding {
                    self.statusText = ready ? String(format: "APP FEED → камера: %.0f fps", fps) : "Жду готовности sink…"
                }
            }
        }
    }

    private func setStatus(_ text: String) { DispatchQueue.main.async { self.statusText = text } }
}
