#include "frame_shm.h"

#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace {
struct Header {
  uint64_t seq;     // bumped after each complete write
  uint32_t width;
  uint32_t height;
};
constexpr size_t kData = 1280u * 720u * 4u;
constexpr size_t kTotal = sizeof(Header) + kData;  // header is 16 bytes
}  // namespace

bool FrameSHM::Open(const char* path) {
  int fd = open(path, O_RDWR | O_CREAT, 0666);
  if (fd < 0) {
    fprintf(stderr, "[MEETAMASK Engine] shm open failed: %s\n", path);
    return false;
  }
  if (ftruncate(fd, (off_t)kTotal) != 0) {
    close(fd);
    return false;
  }
  base_ = mmap(nullptr, kTotal, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  close(fd);
  if (base_ == MAP_FAILED) {
    base_ = nullptr;
    return false;
  }
  size_ = kTotal;
  memset(base_, 0, sizeof(Header));
  fprintf(stderr, "[MEETAMASK Engine] shm mapped: %s (%zu bytes)\n", path, kTotal);
  return true;
}

void FrameSHM::Write(const void* bgra, int width, int height) {
  if (!base_ || !bgra) return;
  // Never publish a frame whose dimensions don't fit the fixed buffer. Truncating the
  // copy but publishing the original (larger) dimensions would make the reader copy
  // past the buffer (out-of-bounds). Drop such a frame instead.
  if (width <= 0 || height <= 0) return;
  Header* h = static_cast<Header*>(base_);
  uint8_t* data = static_cast<uint8_t*>(base_) + sizeof(Header);
  size_t bytes = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
  if (bytes > kData) return;

  // Seqlock: publish even seq numbers; odd = "write in progress". Without this a
  // reader can copy the buffer WHILE this memcpy runs (the seq, bumped only at the
  // end, looks unchanged) and hand a torn frame to the camera. Marking the write as
  // odd up front lets the reader reject an in-flight frame, and its before/after
  // seq comparison catches a write that starts mid-copy.
  uint64_t inProgress = h->seq | 1ull;   // odd (also recovers if a prior write was interrupted)
  h->seq = inProgress;
  __sync_synchronize();                  // odd seq visible before the buffer changes
  memcpy(data, bgra, bytes);
  h->width = static_cast<uint32_t>(width);
  h->height = static_cast<uint32_t>(height);
  __sync_synchronize();                  // frame + dims visible before publishing
  h->seq = inProgress + 1ull;            // even, strictly greater → "new complete frame"
}
