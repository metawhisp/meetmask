import Foundation
import CoreMediaIO
import IOKit.audio
import os.log
import Cocoa

// Custom property published on the SOURCE stream so the host app can poll whether the
// sink is ready to receive frames. The raw value encodes a four-char-code ("sink").
private let customSinkProperty: CMIOExtensionProperty =
    .init(rawValue: "4cc_" + SinkPropertyName.sink.rawValue + "_glob_0000")

// MARK: - Device source (test-pattern fallback + sink→source relay)

class CameraDeviceSource: NSObject, CMIOExtensionDeviceSource {

    private(set) var device: CMIOExtensionDevice!

    fileprivate var _streamSource: CameraStreamSource!
    private var _streamSink: CameraStreamSink!

    // Counts consumers of the SOURCE stream (Meet, Photo Booth, …).
    fileprivate var _streamingSourceCounter: UInt32 = 0
    // Counts producers feeding the SINK stream (our host app).
    private var _streamingSinkCounter: UInt32 = 0

    private var _sourceTimer: DispatchSourceTimer?
    private let _sourceTimerQueue = DispatchQueue(label: "ai.overchat.meetamask.source",
                                                  qos: .userInteractive,
                                                  attributes: [],
                                                  autoreleaseFrequency: .workItem,
                                                  target: .global(qos: .userInteractive))

    private var _sinkTimer: DispatchSourceTimer?
    private let _sinkTimerQueue = DispatchQueue(label: "ai.overchat.meetamask.sink",
                                                qos: .userInteractive,
                                                attributes: [],
                                                autoreleaseFrequency: .workItem,
                                                target: .global(qos: .userInteractive))

    private var _videoDescription: CMFormatDescription!
    private var _bufferPool: CVPixelBufferPool!
    private var _bufferAuxAttributes: NSDictionary!

    private var _frameCounter: UInt64 = 0

    init(localizedName: String) {
        super.init()

        let deviceID = UUID()
        self.device = CMIOExtensionDevice(localizedName: localizedName,
                                          deviceID: deviceID,
                                          legacyDeviceID: deviceID.uuidString,
                                          source: self)

        let dims = CMVideoDimensions(width: fixedCamWidth, height: fixedCamHeight)
        CMVideoFormatDescriptionCreate(allocator: kCFAllocatorDefault,
                                       codecType: kCVPixelFormatType_32BGRA,
                                       width: dims.width, height: dims.height,
                                       extensions: nil, formatDescriptionOut: &_videoDescription)

        let pixelBufferAttributes: NSDictionary = [
            kCVPixelBufferWidthKey: dims.width,
            kCVPixelBufferHeightKey: dims.height,
            kCVPixelBufferPixelFormatTypeKey: _videoDescription.mediaSubType,
            kCVPixelBufferIOSurfacePropertiesKey: [:]
        ]
        CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, pixelBufferAttributes, &_bufferPool)

        let videoStreamFormat = CMIOExtensionStreamFormat(formatDescription: _videoDescription,
                                                          maxFrameDuration: CMTime(value: 1, timescale: Int32(kFrameRate)),
                                                          minFrameDuration: CMTime(value: 1, timescale: Int32(kFrameRate)),
                                                          validFrameDurations: nil)
        _bufferAuxAttributes = [kCVPixelBufferPoolAllocationThresholdKey: 5]

        _streamSource = CameraStreamSource(localizedName: "MEETAMASK.Video",
                                           streamID: UUID(),
                                           streamFormat: videoStreamFormat,
                                           device: device)
        _streamSink = CameraStreamSink(localizedName: "MEETAMASK.Video.Sink",
                                       streamID: UUID(),
                                       streamFormat: videoStreamFormat,
                                       device: device)
        do {
            try device.addStream(_streamSource.stream)
        } catch let error {
            fatalError("Failed to add source stream: \(error.localizedDescription)")
        }
        do {
            try device.addStream(_streamSink.stream)
        } catch let error {
            fatalError("Failed to add sink stream: \(error.localizedDescription)")
        }
    }

    var availableProperties: Set<CMIOExtensionProperty> {
        return [.deviceTransportType, .deviceModel]
    }

    func deviceProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionDeviceProperties {
        let deviceProperties = CMIOExtensionDeviceProperties(dictionary: [:])
        if properties.contains(.deviceTransportType) {
            deviceProperties.transportType = kIOAudioDeviceTransportTypeVirtual
        }
        if properties.contains(.deviceModel) {
            deviceProperties.model = "MEETAMASK Virtual Camera"
        }
        return deviceProperties
    }

    func setDeviceProperties(_ deviceProperties: CMIOExtensionDeviceProperties) throws {}

    // True when the host app should push frames (a downstream consumer is attached).
    fileprivate var sinkShouldBeFed: Bool {
        return _streamingSourceCounter <= 1
    }

    // MARK: Source stream (internal test pattern; paused while the app feeds the sink)

    func startStreamingSource() {
        guard _bufferPool != nil else { return }

        _streamingSourceCounter += 1
        _sourceTimer = DispatchSource.makeTimerSource(flags: .strict, queue: _sourceTimerQueue)
        _sourceTimer!.schedule(deadline: .now(), repeating: 1.0 / Double(kFrameRate), leeway: .seconds(0))

        _sourceTimer!.setEventHandler { [weak self] in
            guard let self = self else { return }
            // The app is feeding the sink — the relay handles output, skip the test pattern.
            if self._streamingSinkCounter > 0 { return }

            var pixelBuffer: CVPixelBuffer?
            let err = CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(kCFAllocatorDefault,
                                                                          self._bufferPool,
                                                                          self._bufferAuxAttributes,
                                                                          &pixelBuffer)
            if err != 0 {
                os_log(.error, "MEETAMASK: out of pixel buffers (%d)", err)
                return
            }
            guard let pixelBuffer = pixelBuffer else { return }

            CVPixelBufferLockBaseAddress(pixelBuffer, [])
            let pixelData = CVPixelBufferGetBaseAddress(pixelBuffer)
            let width = CVPixelBufferGetWidth(pixelBuffer)
            let height = CVPixelBufferGetHeight(pixelBuffer)
            let rgbColorSpace = CGColorSpaceCreateDeviceRGB()
            if let context = CGContext(data: pixelData,
                                       width: width,
                                       height: height,
                                       bitsPerComponent: 8,
                                       bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
                                       space: rgbColorSpace,
                                       bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue) {
                let graphicsContext = NSGraphicsContext(cgContext: context, flipped: false)
                NSGraphicsContext.saveGraphicsState()
                NSGraphicsContext.current = graphicsContext
                self.drawTestPattern(into: context, width: width, height: height)
                NSGraphicsContext.restoreGraphicsState()
            }
            CVPixelBufferUnlockBaseAddress(pixelBuffer, [])

            var sbuf: CMSampleBuffer!
            var timingInfo = CMSampleTimingInfo()
            timingInfo.presentationTimeStamp = CMClockGetTime(CMClockGetHostTimeClock())
            let sErr = CMSampleBufferCreateForImageBuffer(allocator: kCFAllocatorDefault,
                                                          imageBuffer: pixelBuffer,
                                                          dataReady: true,
                                                          makeDataReadyCallback: nil,
                                                          refcon: nil,
                                                          formatDescription: self._videoDescription,
                                                          sampleTiming: &timingInfo,
                                                          sampleBufferOut: &sbuf)
            if sErr == 0, let sbuf = sbuf {
                self._streamSource.stream.send(sbuf,
                                               discontinuity: [],
                                               hostTimeInNanoseconds: UInt64(timingInfo.presentationTimeStamp.seconds * Double(NSEC_PER_SEC)))
            }
            self._frameCounter += 1
        }

        _sourceTimer!.setCancelHandler {}
        _sourceTimer!.resume()
    }

    func stopStreamingSource() {
        if _streamingSourceCounter > 1 {
            _streamingSourceCounter -= 1
        } else {
            _streamingSourceCounter = 0
            if let timer = _sourceTimer {
                timer.cancel()
                _sourceTimer = nil
            }
        }
    }

    // MARK: Sink stream (frames pushed by the host app → relayed to the source)

    func startStreamingSink(client: CMIOExtensionClient) {
        guard _bufferPool != nil else { return }
        _streamingSinkCounter += 1

        _sinkTimer = DispatchSource.makeTimerSource(flags: .strict, queue: _sinkTimerQueue)
        // Poll faster than the frame rate so we can absorb jitter; early-return when empty.
        _sinkTimer!.schedule(deadline: .now(), repeating: 1.0 / (Double(kFrameRate) * 3.0), leeway: .milliseconds(10))

        _sinkTimer!.setEventHandler { [weak self] in
            guard let self = self else { return }
            self._streamSink.stream.consumeSampleBuffer(from: client) { sbuf, seq, _, _, _ in
                guard let sbuf = sbuf else { return }
                let now = CMClockGetTime(CMClockGetHostTimeClock())
                let output = CMIOExtensionScheduledOutput(sequenceNumber: seq,
                                                          hostTimeInNanoseconds: UInt64(now.seconds * Double(NSEC_PER_SEC)))
                if self._streamingSourceCounter > 0 {
                    self._streamSource.stream.send(sbuf,
                                                   discontinuity: [],
                                                   hostTimeInNanoseconds: UInt64(sbuf.presentationTimeStamp.seconds * Double(NSEC_PER_SEC)))
                }
                self._streamSink.stream.notifyScheduledOutputChanged(output)
            }
        }

        _sinkTimer!.setCancelHandler {}
        _sinkTimer!.resume()
    }

    func stopStreamingSink() {
        if _streamingSinkCounter > 1 {
            _streamingSinkCounter -= 1
        } else {
            _streamingSinkCounter = 0
            if let timer = _sinkTimer {
                timer.cancel()
                _sinkTimer = nil
            }
        }
    }

    // MARK: Test pattern

    private func drawTestPattern(into context: CGContext, width: Int, height: Int) {
        let w = CGFloat(width)
        let h = CGFloat(height)

        // 1) SMPTE-style vertical color bars — instantly reads as a camera test signal.
        let bars: [CGColor] = [
            NSColor.white, NSColor.systemYellow, NSColor.cyan, NSColor.systemGreen,
            NSColor.magenta, NSColor.systemRed, NSColor.systemBlue
        ].map { $0.cgColor }
        let barWidth = w / CGFloat(bars.count)
        for (i, color) in bars.enumerated() {
            context.setFillColor(color)
            context.fill(CGRect(x: CGFloat(i) * barWidth, y: 0, width: ceil(barWidth), height: h))
        }

        // 2) Moving scan line — proves frames are live, not a frozen image. Sweeps every 4s.
        let period = UInt64(max(kFrameRate, 1) * 4)
        let phase = CGFloat(_frameCounter % period) / CGFloat(period)
        context.setFillColor(NSColor.white.withAlphaComponent(0.9).cgColor)
        context.fill(CGRect(x: phase * w, y: 0, width: 4, height: h))

        // 3) Dark band + branded label + live counters, vertically centered.
        let bandHeight = h * 0.30
        context.setFillColor(NSColor.black.withAlphaComponent(0.80).cgColor)
        context.fill(CGRect(x: 0, y: (h - bandHeight) / 2, width: w, height: bandHeight))

        let seconds = Int(CMClockGetTime(CMClockGetHostTimeClock()).seconds)
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center

        let label = NSMutableAttributedString()
        label.append(NSAttributedString(string: "MEETAMASK Camera\n", attributes: [
            .font: NSFont.systemFont(ofSize: 54, weight: .bold),
            .foregroundColor: NSColor.white,
            .paragraphStyle: paragraph
        ]))
        label.append(NSAttributedString(string: "\(fixedCamWidth)×\(fixedCamHeight) · \(kFrameRate) fps · frame \(_frameCounter) · \(seconds)s", attributes: [
            .font: NSFont.systemFont(ofSize: 26, weight: .medium),
            .foregroundColor: NSColor.white.withAlphaComponent(0.92),
            .paragraphStyle: paragraph
        ]))

        let bounding = label.boundingRect(with: NSSize(width: w, height: h), options: [.usesLineFragmentOrigin])
        let textRect = CGRect(x: 0, y: (h - bounding.height) / 2, width: w, height: bounding.height)
        label.draw(with: textRect, options: [.usesLineFragmentOrigin])
    }
}

// MARK: - Source stream (read by Meet / Zoom / QuickTime / FaceTime)

class CameraStreamSource: NSObject, CMIOExtensionStreamSource {

    private(set) var stream: CMIOExtensionStream!

    let device: CMIOExtensionDevice
    private let _streamFormat: CMIOExtensionStreamFormat
    private var _sink = false

    init(localizedName: String, streamID: UUID, streamFormat: CMIOExtensionStreamFormat, device: CMIOExtensionDevice) {
        self.device = device
        self._streamFormat = streamFormat
        super.init()
        self.stream = CMIOExtensionStream(localizedName: localizedName,
                                          streamID: streamID,
                                          direction: .source,
                                          clockType: .hostTime,
                                          source: self)
    }

    var formats: [CMIOExtensionStreamFormat] {
        return [_streamFormat]
    }

    var activeFormatIndex: Int = 0 {
        didSet {
            if activeFormatIndex >= 1 {
                os_log(.error, "MEETAMASK: invalid active format index")
            }
        }
    }

    var availableProperties: Set<CMIOExtensionProperty> {
        return [.streamActiveFormatIndex, .streamFrameDuration, customSinkProperty]
    }

    func streamProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionStreamProperties {
        let streamProperties = CMIOExtensionStreamProperties(dictionary: [:])
        if properties.contains(.streamActiveFormatIndex) {
            streamProperties.activeFormatIndex = 0
        }
        if properties.contains(.streamFrameDuration) {
            streamProperties.frameDuration = CMTime(value: 1, timescale: Int32(kFrameRate))
        }
        if properties.contains(customSinkProperty) {
            if let deviceSource = device.source as? CameraDeviceSource {
                _sink = deviceSource.sinkShouldBeFed
            }
            let sinkState = _sink ? SinkStateOptions.trueState.rawValue : SinkStateOptions.falseState.rawValue
            streamProperties.setPropertyState(CMIOExtensionPropertyState(value: sinkState as NSString),
                                              forProperty: customSinkProperty)
        }
        return streamProperties
    }

    func setStreamProperties(_ streamProperties: CMIOExtensionStreamProperties) throws {
        if let activeFormatIndex = streamProperties.activeFormatIndex {
            self.activeFormatIndex = activeFormatIndex
        }
    }

    func authorizedToStartStream(for client: CMIOExtensionClient) -> Bool {
        return true
    }

    func startStream() throws {
        guard let deviceSource = device.source as? CameraDeviceSource else {
            fatalError("Unexpected source type \(String(describing: device.source))")
        }
        deviceSource.startStreamingSource()
    }

    func stopStream() throws {
        guard let deviceSource = device.source as? CameraDeviceSource else {
            fatalError("Unexpected source type \(String(describing: device.source))")
        }
        deviceSource.stopStreamingSource()
    }
}

// MARK: - Sink stream (written by the host app)

class CameraStreamSink: NSObject, CMIOExtensionStreamSource {

    private(set) var stream: CMIOExtensionStream!

    let device: CMIOExtensionDevice
    private let _streamFormat: CMIOExtensionStreamFormat
    private var _client: CMIOExtensionClient?

    init(localizedName: String, streamID: UUID, streamFormat: CMIOExtensionStreamFormat, device: CMIOExtensionDevice) {
        self.device = device
        self._streamFormat = streamFormat
        super.init()
        self.stream = CMIOExtensionStream(localizedName: localizedName,
                                          streamID: streamID,
                                          direction: .sink,
                                          clockType: .hostTime,
                                          source: self)
    }

    var formats: [CMIOExtensionStreamFormat] {
        return [_streamFormat]
    }

    var activeFormatIndex: Int = 0 {
        didSet {
            if activeFormatIndex >= 1 {
                os_log(.error, "MEETAMASK: invalid active format index")
            }
        }
    }

    var availableProperties: Set<CMIOExtensionProperty> {
        return [.streamActiveFormatIndex, .streamFrameDuration,
                .streamSinkBufferQueueSize, .streamSinkBuffersRequiredForStartup,
                .streamSinkBufferUnderrunCount, .streamSinkEndOfData]
    }

    func streamProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionStreamProperties {
        let streamProperties = CMIOExtensionStreamProperties(dictionary: [:])
        if properties.contains(.streamActiveFormatIndex) {
            streamProperties.activeFormatIndex = 0
        }
        if properties.contains(.streamFrameDuration) {
            streamProperties.frameDuration = CMTime(value: 1, timescale: Int32(kFrameRate))
        }
        if properties.contains(.streamSinkBufferQueueSize) {
            streamProperties.sinkBufferQueueSize = 1
        }
        if properties.contains(.streamSinkBuffersRequiredForStartup) {
            streamProperties.sinkBuffersRequiredForStartup = 1
        }
        return streamProperties
    }

    func setStreamProperties(_ streamProperties: CMIOExtensionStreamProperties) throws {
        if let activeFormatIndex = streamProperties.activeFormatIndex {
            self.activeFormatIndex = activeFormatIndex
        }
    }

    func authorizedToStartStream(for client: CMIOExtensionClient) -> Bool {
        _client = client
        return true
    }

    func startStream() throws {
        guard let deviceSource = device.source as? CameraDeviceSource, let client = _client else {
            fatalError("Unexpected source type \(String(describing: device.source)) or no client.")
        }
        deviceSource.startStreamingSink(client: client)
    }

    func stopStream() throws {
        guard let deviceSource = device.source as? CameraDeviceSource else {
            fatalError("Unexpected source type \(String(describing: device.source))")
        }
        deviceSource.stopStreamingSink()
    }
}

// MARK: - Provider

class CameraProviderSource: NSObject, CMIOExtensionProviderSource {

    private(set) var provider: CMIOExtensionProvider!
    private var deviceSource: CameraDeviceSource!

    init(clientQueue: DispatchQueue?) {
        super.init()
        provider = CMIOExtensionProvider(source: self, clientQueue: clientQueue)
        deviceSource = CameraDeviceSource(localizedName: cameraName)
        do {
            try provider.addDevice(deviceSource.device)
        } catch let error {
            fatalError("Failed to add device: \(error.localizedDescription)")
        }
    }

    func connect(to client: CMIOExtensionClient) throws {}

    func disconnect(from client: CMIOExtensionClient) {}

    var availableProperties: Set<CMIOExtensionProperty> {
        return [.providerManufacturer]
    }

    func providerProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionProviderProperties {
        let providerProperties = CMIOExtensionProviderProperties(dictionary: [:])
        if properties.contains(.providerManufacturer) {
            providerProperties.manufacturer = "MEETAMASK"
        }
        return providerProperties
    }

    func setProviderProperties(_ providerProperties: CMIOExtensionProviderProperties) throws {}
}
