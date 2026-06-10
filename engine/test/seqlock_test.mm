// Concurrency test for the shared-memory frame hand-off (FrameSHM).
//
// Reproduces production: the engine maps the file and WRITES frames; the host app
// maps the SAME file and READS them. Each frame is filled so every 32-bit word ==
// the frame counter, so a torn read (prefix of one frame, suffix of another) shows
// up as word[first] != word[last].
//
// Two readers:
//   naive   — mirrors the CURRENT app reader (read seq; if new, read data). Unsafe.
//   seqlock — the FIX (reject odd seq = write-in-progress; copy; re-read seq; accept
//             only if unchanged). Combined with the writer's odd/even seqlock, no
//             accepted frame can tear.
//
// Pass criteria: the naive reader demonstrably tears (the workload really races) AND
// the seqlock reader never tears.
//
// Build + run (no CEF needed):
//   clang++ -std=c++17 -O2 engine/frame_shm.mm engine/test/seqlock_test.mm -o /tmp/seqtest && /tmp/seqtest
// Exit 0 = pass.

#include "../frame_shm.h"

#include <atomic>
#include <thread>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>

namespace {
constexpr int kW = 1280, kH = 720;
constexpr size_t kWords = static_cast<size_t>(kW) * kH;
constexpr size_t kData = kWords * 4;
constexpr size_t kTotal = 16 + 1280u * 720u * 4u;
constexpr uint64_t kFrames = 1500;

inline uint64_t loadSeq(volatile uint8_t* b) { return *reinterpret_cast<volatile uint64_t*>(b); }
inline uint32_t loadU32(volatile uint8_t* b, size_t off) { return *reinterpret_cast<volatile uint32_t*>(b + off); }

bool naiveRead(volatile uint8_t* rb, uint64_t* last, uint8_t* dst, int* outW, int* outH) {
  uint64_t s = loadSeq(rb);
  if (s == *last) return false;
  *last = s;
  uint32_t w = loadU32(rb, 8), h = loadU32(rb, 12);
  size_t bytes = static_cast<size_t>(w) * h * 4u;
  if (bytes == 0 || bytes > kData) return false;
  memcpy(dst, const_cast<const uint8_t*>(rb + 16), bytes);
  *outW = (int)w; *outH = (int)h;
  return true;
}

bool seqlockRead(volatile uint8_t* rb, uint64_t* last, uint8_t* dst, int* outW, int* outH) {
  for (int attempt = 0; attempt < 64; attempt++) {
    uint64_t s1 = loadSeq(rb);
    if (s1 & 1ull) continue;            // writer mid-write
    if (s1 == *last) return false;      // no new frame
    __sync_synchronize();
    uint32_t w = loadU32(rb, 8), h = loadU32(rb, 12);
    size_t bytes = static_cast<size_t>(w) * h * 4u;
    if (bytes == 0 || bytes > kData) return false;
    memcpy(dst, const_cast<const uint8_t*>(rb + 16), bytes);
    __sync_synchronize();
    if (loadSeq(rb) == s1) { *last = s1; *outW = (int)w; *outH = (int)h; return true; }
  }
  return false;
}

// Run one writer + one reader concurrently; return how many ACCEPTED frames were torn.
long runPhase(const char* path, bool useSeqlock) {
  unlink(path);
  FrameSHM shm;
  if (!shm.Open(path)) { fprintf(stderr, "Open failed\n"); exit(2); }
  int rfd = open(path, O_RDWR);
  void* rmap = mmap(nullptr, kTotal, PROT_READ | PROT_WRITE, MAP_SHARED, rfd, 0);
  volatile uint8_t* rb = static_cast<volatile uint8_t*>(rmap);

  std::atomic<bool> done{false};
  std::atomic<long> torn{0};

  std::thread writer([&] {
    auto* frame = static_cast<uint32_t*>(malloc(kData));
    for (uint64_t i = 1; i <= kFrames; i++) {
      for (size_t k = 0; k < kWords; k++) frame[k] = static_cast<uint32_t>(i);
      shm.Write(frame, kW, kH);
    }
    free(frame);
    done.store(true);
  });

  std::thread reader([&] {
    auto* dst = static_cast<uint8_t*>(malloc(kData));
    uint64_t last = 0;
    int w = 0, h = 0;
    for (;;) {
      bool got = useSeqlock ? seqlockRead(rb, &last, dst, &w, &h)
                            : naiveRead(rb, &last, dst, &w, &h);
      if (got) {
        const uint32_t* words = reinterpret_cast<const uint32_t*>(dst);
        size_t n = static_cast<size_t>(w) * h;
        if (words[0] != words[n - 1]) torn.fetch_add(1);
      } else if (done.load() && last == loadSeq(rb)) {
        break;
      }
    }
    free(dst);
  });

  writer.join();
  reader.join();
  munmap(rmap, kTotal);
  close(rfd);
  unlink(path);
  return torn.load();
}
}  // namespace

int main() {
  long naive = runPhase("/tmp/mm-seqlock-naive.bin", false);
  long seq = runPhase("/tmp/mm-seqlock-seq.bin", true);
  printf("naive torn=%ld   seqlock torn=%ld\n", naive, seq);

  // Exit 2 = INCONCLUSIVE (the workload didn't race this run — e.g. a slow/oddly-scheduled
  // CI runner). NOT a regression: callers (CI) should retry rather than fail the build.
  if (naive == 0) { fprintf(stderr, "INCONCLUSIVE: workload did not race (naive reader saw no tears)\n"); return 2; }
  // Exit 1 = REAL FAILURE: the seqlock reader accepted a torn frame. Deterministic regression.
  if (seq != 0) { fprintf(stderr, "FAIL: seqlock reader accepted %ld torn frames\n", seq); return 1; }
  printf("PASS: naive tears (%ld), seqlock is tear-free\n", naive);
  return 0;
}
