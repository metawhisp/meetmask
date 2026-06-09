#include "camera_sink.h"

#import <Foundation/Foundation.h>
#include <algorithm>
#include <vector>

namespace {

constexpr int kW = 1280;
constexpr int kH = 720;

void QueueAltered(CMIOStreamID, void*, void*) {}

CMIOObjectPropertyAddress Addr(CMIOObjectPropertySelector sel) {
  CMIOObjectPropertyAddress a;
  a.mSelector = sel;
  a.mScope = kCMIOObjectPropertyScopeGlobal;
  a.mElement = kCMIOObjectPropertyElementMain;
  return a;
}

CMIODeviceID FindDeviceByName(CFStringRef target) {
  CMIOObjectPropertyAddress addr = Addr(kCMIOHardwarePropertyDevices);
  UInt32 size = 0;
  if (CMIOObjectGetPropertyDataSize(kCMIOObjectSystemObject, &addr, 0, nullptr,
                                    &size) != noErr ||
      size == 0) {
    return 0;
  }
  std::vector<CMIODeviceID> devices(size / sizeof(CMIODeviceID));
  UInt32 used = 0;
  if (CMIOObjectGetPropertyData(kCMIOObjectSystemObject, &addr, 0, nullptr, size,
                                &used, devices.data()) != noErr) {
    return 0;
  }
  for (CMIODeviceID dev : devices) {
    CMIOObjectPropertyAddress na = Addr(kCMIOObjectPropertyName);
    CFStringRef name = nullptr;
    UInt32 u = 0;
    if (CMIOObjectGetPropertyData(dev, &na, 0, nullptr, sizeof(name), &u,
                                  &name) == noErr &&
        name) {
      bool match = CFEqual(name, target);
      CFRelease(name);
      if (match) {
        return dev;
      }
    }
  }
  return 0;
}

std::vector<CMIOStreamID> GetStreams(CMIODeviceID device) {
  CMIOObjectPropertyAddress addr = Addr(kCMIODevicePropertyStreams);
  UInt32 size = 0;
  if (CMIOObjectGetPropertyDataSize(device, &addr, 0, nullptr, &size) != noErr) {
    return {};
  }
  std::vector<CMIOStreamID> streams(size / sizeof(CMIOStreamID));
  UInt32 used = 0;
  CMIOObjectGetPropertyData(device, &addr, 0, nullptr, size, &used,
                            streams.data());
  return streams;
}

}  // namespace

bool CameraSink::Connect() {
  if (connected_) {
    return true;
  }
  CMIODeviceID device = FindDeviceByName(CFSTR("MEETAMASK Camera"));
  if (device == 0) {
    fprintf(stderr, "[MEETAMASK Engine] camera: device not found\n");
    return false;
  }
  std::vector<CMIOStreamID> streams = GetStreams(device);
  if (streams.size() < 2) {
    fprintf(stderr, "[MEETAMASK Engine] camera: <2 streams (%zu)\n",
            streams.size());
    return false;
  }
  CMIOStreamID sink = streams.back();

  CMSimpleQueueRef queue = nullptr;
  if (CMIOStreamCopyBufferQueue(sink, &QueueAltered, this, &queue) != noErr ||
      !queue) {
    fprintf(stderr, "[MEETAMASK Engine] camera: CopyBufferQueue failed\n");
    return false;
  }
  if (CMIODeviceStartStream(device, sink) != noErr) {
    fprintf(stderr, "[MEETAMASK Engine] camera: StartStream failed\n");
    return false;
  }

  device_ = device;
  sink_stream_ = sink;
  sink_queue_ = queue;
  connected_ = true;
  fprintf(stderr, "[MEETAMASK Engine] camera: connected to sink\n");
  return true;
}

void CameraSink::Disconnect() {
  if (device_ && sink_stream_) {
    CMIODeviceStopStream(device_, sink_stream_);
  }
  if (pool_) {
    CVPixelBufferPoolRelease(pool_);
    pool_ = nullptr;
  }
  if (format_) {
    CFRelease(format_);
    format_ = nullptr;
  }
  sink_queue_ = nullptr;
  connected_ = false;
}

bool CameraSink::EnsurePool() {
  if (pool_ && format_) {
    return true;
  }
  NSDictionary* attrs = @{
    (id)kCVPixelBufferWidthKey : @(kW),
    (id)kCVPixelBufferHeightKey : @(kH),
    (id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
    (id)kCVPixelBufferIOSurfacePropertiesKey : @{},
  };
  if (CVPixelBufferPoolCreate(kCFAllocatorDefault, nullptr,
                              (__bridge CFDictionaryRef)attrs,
                              &pool_) != kCVReturnSuccess) {
    return false;
  }
  CMVideoFormatDescriptionCreate(kCFAllocatorDefault, kCVPixelFormatType_32BGRA,
                                 kW, kH, nullptr, &format_);
  return format_ != nullptr;
}

void CameraSink::PushFrame(const void* bgra, int width, int height) {
  if (!connected_ || !sink_queue_ || !bgra) {
    return;
  }
  if (!EnsurePool()) {
    return;
  }
  // FACT-finding: is the extension consuming our frames? If the queue stays full
  // the extension is NOT pulling; if it cycles low it IS.
  static unsigned long long push_n = 0;
  ++push_n;
  if (push_n % 30 == 0) {
    fprintf(stderr,
            "[MEETAMASK Engine] camera: queue %u/%u (pushed #%llu)\n",
            (unsigned)CMSimpleQueueGetCount(sink_queue_),
            (unsigned)CMSimpleQueueGetCapacity(sink_queue_), push_n);
    fflush(stderr);
  }
  // Drop instead of blocking if the queue is full.
  if (CMSimpleQueueGetCount(sink_queue_) >=
      CMSimpleQueueGetCapacity(sink_queue_)) {
    return;
  }

  CVPixelBufferRef pb = nullptr;
  if (CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool_, &pb) !=
          kCVReturnSuccess ||
      !pb) {
    return;
  }

  CVPixelBufferLockBaseAddress(pb, 0);
  uint8_t* dst = static_cast<uint8_t*>(CVPixelBufferGetBaseAddress(pb));
  const size_t dst_stride = CVPixelBufferGetBytesPerRow(pb);
  const size_t src_stride = static_cast<size_t>(width) * 4;
  const size_t row_bytes = std::min(dst_stride, src_stride);
  const size_t rows =
      std::min(static_cast<size_t>(height), CVPixelBufferGetHeight(pb));
  const uint8_t* src = static_cast<const uint8_t*>(bgra);
  for (size_t y = 0; y < rows; ++y) {
    memcpy(dst + y * dst_stride, src + y * src_stride, row_bytes);
  }
  CVPixelBufferUnlockBaseAddress(pb, 0);

  CMSampleTimingInfo timing;
  timing.duration = kCMTimeInvalid;
  timing.presentationTimeStamp = CMClockGetTime(CMClockGetHostTimeClock());
  timing.decodeTimeStamp = kCMTimeInvalid;

  CMSampleBufferRef sbuf = nullptr;
  OSStatus s = CMSampleBufferCreateForImageBuffer(
      kCFAllocatorDefault, pb, true, nullptr, nullptr, format_, &timing, &sbuf);
  CVPixelBufferRelease(pb);
  if (s != noErr || !sbuf) {
    if (sbuf) {
      CFRelease(sbuf);
    }
    return;
  }

  // Transfer ownership to the queue; the extension releases it on consume.
  if (CMSimpleQueueEnqueue(sink_queue_, sbuf) != noErr) {
    CFRelease(sbuf);
  }
}
