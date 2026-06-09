// Pushes BGRA frames from CEF OnPaint into the MEETAMASK virtual camera's CMIO
// sink stream (the same sink the Swift CameraFeeder used). The camera extension
// relays sink -> source -> Meet/Zoom.
#ifndef MEETAMASK_CAMERA_SINK_H_
#define MEETAMASK_CAMERA_SINK_H_

#include <CoreMedia/CoreMedia.h>
#include <CoreMediaIO/CMIOHardware.h>
#include <CoreVideo/CoreVideo.h>

class CameraSink {
 public:
  // Find the MEETAMASK virtual camera, grab its sink queue and start the stream.
  bool Connect();
  void Disconnect();

  // Copy a width*height BGRA frame into a pixel buffer and enqueue it.
  void PushFrame(const void* bgra, int width, int height);

  bool connected() const { return connected_; }

 private:
  bool EnsurePool();

  bool connected_ = false;
  CMIODeviceID device_ = 0;
  CMIOStreamID sink_stream_ = 0;
  CMSimpleQueueRef sink_queue_ = nullptr;        // not owned (owned by CMIO)
  CVPixelBufferPoolRef pool_ = nullptr;
  CMFormatDescriptionRef format_ = nullptr;
};

#endif  // MEETAMASK_CAMERA_SINK_H_
