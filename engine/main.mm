// MEETAMASK render engine — headless browser-process entry point.
// Renders a mask page offscreen via CEF and (later) feeds frames to the
// MEETAMASK virtual camera. Runs without any window, so it keeps rendering
// regardless of whether the controlling app is hidden / minimised / occluded.

#import <Cocoa/Cocoa.h>
#include <pthread.h>
#include <unistd.h>
#include <string>
#include <mach-o/dyld.h>   // _NSGetExecutablePath
#include <limits.h>        // PATH_MAX
#include <stdlib.h>        // realpath

#include "include/cef_application_mac.h"
#include "include/cef_command_line.h"
#include "include/wrapper/cef_helpers.h"
#include "include/wrapper/cef_library_loader.h"

#include "engine_app.h"

// NSApplication subclass that implements CefAppProtocol (required by CEF).
@interface EngineApplication : NSApplication <CefAppProtocol> {
 @private
  BOOL handlingSendEvent_;
}
@end

@implementation EngineApplication
- (BOOL)isHandlingSendEvent {
  return handlingSendEvent_;
}
- (void)setHandlingSendEvent:(BOOL)handlingSendEvent {
  handlingSendEvent_ = handlingSendEvent;
}
- (void)sendEvent:(NSEvent*)event {
  CefScopedSendingEvent sendingEventScoper;
  [super sendEvent:event];
}
- (BOOL)applicationSupportsSecureRestorableState:(NSApplication*)app {
  return YES;
}
@end

// Self-exit if the controlling app (our parent) dies, so a crashed or force-quit app
// never leaves an orphaned engine holding the camera or writing the shared buffer.
// When the parent exits, this process is reparented (ppid changes, e.g. to launchd).
static void* WatchParent(void* arg) {
  pid_t original_ppid = *static_cast<pid_t*>(arg);
  delete static_cast<pid_t*>(arg);
  for (;;) {
    pid_t ppid = getppid();
    // Reparented (parent died) OR already adopted by launchd (pid 1, e.g. the app died
    // before we even captured the original parent) ⇒ orphaned, leave immediately.
    if (ppid != original_ppid || ppid == 1) {
      _exit(0);
    }
    usleep(500 * 1000);  // 0.5s
  }
  return nullptr;
}

int main(int argc, char* argv[]) {
  setvbuf(stderr, nullptr, _IONBF, 0);  // unbuffered logs (survive hard kill during tests)

  // Start the parent watcher before anything else (capture the real parent pid now).
  {
    pthread_t watcher;
    if (pthread_create(&watcher, nullptr, WatchParent, new pid_t(getppid())) == 0) {
      pthread_detach(watcher);
    }
  }

  // Load the CEF framework library at runtime.
  CefScopedLibraryLoader library_loader;
  if (!library_loader.LoadInMain()) {
    return 1;
  }

  CefMainArgs main_args(argc, argv);

  @autoreleasepool {
    [EngineApplication sharedApplication];

    // Args are passed ONLY as --key=value switches, never as positional arguments.
    // A positional file/URL argument would be picked up by Chromium and opened as a
    // page — which dumped the shm buffer into ~/Downloads and popped a browser.
    //   --shm=<path>   shared frame buffer
    //   --mask=<url>   mask page to render
    std::string url = "about:blank";
    std::string shmPath;
    const std::string kShm = "--shm=";
    const std::string kMask = "--mask=";
    for (int i = 1; i < argc; ++i) {
      std::string arg = argv[i];
      if (arg.rfind(kShm, 0) == 0) {
        shmPath = arg.substr(kShm.size());
      } else if (arg.rfind(kMask, 0) == 0) {
        url = arg.substr(kMask.size());
      }
    }

    CefSettings settings;
    settings.no_sandbox = true;
    settings.windowless_rendering_enabled = true;

    // Per-SESSION cache dir. Chromium keeps a PROCESS-SINGLETON keyed on this path: when two
    // engine processes shared ONE dir, the second handed its launch to the first, which popped a
    // stray blank "New Tab" WINDOW on screen (looked like a random Chrome opening). Two engines
    // coexist whenever the host app is opened more than once. Deriving the dir from the per-instance
    // shm key — unique per host session, but STABLE across mask switches so the HTTP cache (e.g. the
    // MediaPipe download) is reused, not re-fetched every switch — gives each host its own singleton
    // scope, so they never collide and no window is ever shown.
    NSFileManager* fm = [NSFileManager defaultManager];
    NSString* cacheBase =
        [[NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES) firstObject]
            stringByAppendingPathComponent:@"ai.overchat.meetamask.engine"];
    [fm createDirectoryAtPath:cacheBase withIntermediateDirectories:YES attributes:nil error:nil];
    // Bound disk: drop instance dirs left by long-dead sessions (best-effort, >24h untouched).
    NSDate* cutoff = [NSDate dateWithTimeIntervalSinceNow:-24 * 60 * 60];
    for (NSString* name in [fm contentsOfDirectoryAtPath:cacheBase error:nil]) {
      NSString* sib = [cacheBase stringByAppendingPathComponent:name];
      NSDate* mod = [[fm attributesOfItemAtPath:sib error:nil] fileModificationDate];
      if (mod && [mod compare:cutoff] == NSOrderedAscending) [fm removeItemAtPath:sib error:nil];
    }
    // Session key = the shm file's basename (…/meetamask-frame-<UUID>.bin → meetamask-frame-<UUID>);
    // falls back to the pid when the engine is run standalone without --shm.
    NSString* sessionKey =
        shmPath.empty()
            ? [NSString stringWithFormat:@"inst-%d", getpid()]
            : [[[NSString stringWithUTF8String:shmPath.c_str()] lastPathComponent] stringByDeletingPathExtension];
    NSString* cacheDir = [cacheBase stringByAppendingPathComponent:sessionKey];
    CefString(&settings.root_cache_path) = [cacheDir UTF8String];

    // Explicit CEF bundle paths, derived from THIS executable's real location. When the
    // engine .app is NESTED inside the host app, CEF's automatic main-bundle detection can
    // resolve to the OUTER host bundle and then fail to locate the framework / helper /
    // resources → a CHECK-crash inside cef_initialize. Computing paths from the unambiguous
    // executable path makes nesting safe (and is a no-op when run standalone).
    {
      char exe[PATH_MAX];
      uint32_t sz = sizeof(exe);
      if (_NSGetExecutablePath(exe, &sz) == 0) {
        char resolved[PATH_MAX];
        if (realpath(exe, resolved)) {
          std::string p(resolved);                                  // …/MEETAMASKEngine.app/Contents/MacOS/MEETAMASKEngine
          std::string macosDir  = p.substr(0, p.find_last_of('/'));        // …/Contents/MacOS
          std::string contents  = macosDir.substr(0, macosDir.find_last_of('/'));   // …/Contents
          std::string appBundle = contents.substr(0, contents.find_last_of('/'));   // …/MEETAMASKEngine.app
          std::string framework = contents + "/Frameworks/Chromium Embedded Framework.framework";
          std::string helper    = contents + "/Frameworks/MEETAMASKEngine Helper.app/Contents/MacOS/MEETAMASKEngine Helper";
          CefString(&settings.framework_dir_path)      = framework;
          CefString(&settings.browser_subprocess_path) = helper;
          CefString(&settings.main_bundle_path)        = appBundle;
        }
      }
    }

    CefRefPtr<EngineApp> app(new EngineApp(url, shmPath));

    if (!CefInitialize(main_args, settings, app.get(), nullptr)) {
      return CefGetExitCode();
    }

    CefRunMessageLoop();
    CefShutdown();
  }

  return 0;
}
