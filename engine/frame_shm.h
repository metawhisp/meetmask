// Shared-memory frame hand-off: the engine writes each rendered BGRA frame here;
// the host app reads it and pushes it to the virtual camera. Avoids needing the
// engine itself to talk to CMIO (which requires the app-group).
#ifndef MEETAMASK_FRAME_SHM_H_
#define MEETAMASK_FRAME_SHM_H_

#include <cstddef>

class FrameSHM {
 public:
  // Open (create) the shared file at `path` and map it.
  bool Open(const char* path);
  // Write one tightly-packed BGRA frame (width*height*4 bytes); bumps the sequence.
  void Write(const void* bgra, int width, int height);

 private:
  void* base_ = nullptr;
  size_t size_ = 0;
};

#endif  // MEETAMASK_FRAME_SHM_H_
