# 📦 MEETAMASK distribution — sign + notarize

The shipped app is tiny (~1.5 MB, no engine). Two artifacts get signed + notarized:

1. **Host app** `MEETAMASK.app` — what the user downloads.
2. **Engine** `MEETAMASKEngine.app` (~302 MB) — downloaded by the app on first launch.

Both are signed with **Developer ID Application: Andrey Dyuzhov (6D6948Z4MW)** + hardened
runtime, and notarized so Gatekeeper accepts them on any Mac.

## The CEF-framework gotcha (already handled)

CMake's `COPY_MAC_FRAMEWORK` mangles the CEF framework's symlinks (creates a self-referential
`Versions/A/A -> A`), which makes `codesign --deep --strict` — and notarization — fail with
"No such file". `package-engine.sh` fixes this by replacing the framework with a clean `ditto`
copy from the pristine CEF dist (`cef/dist/Release/...`) before signing.
(Long-term: fix the CMake copy to use `ditto`; until then the packaging script handles it.)

## One-time credentials (YOUR part — done once)

Notarization needs your Apple ID. Create an **app-specific password** at
<https://appleid.apple.com> → Sign-In & Security → App-Specific Passwords, then store a
notarytool keychain profile (your password never leaves your keychain):

```bash
xcrun notarytool store-credentials "meetamask" \
  --apple-id "YOUR_APPLE_ID@example.com" \
  --team-id  "6D6948Z4MW" \
  --password "xxxx-xxxx-xxxx-xxxx"     # the app-specific password
```

(Or use an App Store Connect API key: `--key …p8 --key-id … --issuer …`.)

## Release flow

```bash
# 1) Build the light host (no engine) and the engine.
xcodegen generate
xcodebuild -project MEETAMASK.xcodeproj -scheme MEETAMASK -configuration Release \
  -allowProvisioningUpdates -derivedDataPath build/app build
cmake --build engine/build --config Release

# 2) Sign + package each artifact.
dist/sign-host.sh      build/app/Build/Products/Release/MEETAMASK.app
dist/package-engine.sh                 # → build/dist/MEETAMASKEngine.app + .zip (signed)

# 3) Notarize + staple each (needs the keychain profile above).
dist/notarize.sh       build/app/Build/Products/Release/MEETAMASK.app
dist/notarize.sh       build/dist/MEETAMASKEngine.app

# 4) Re-zip the STAPLED engine → the file the app downloads (has the ticket → offline-clean).
ditto -c -k --keepParent build/dist/MEETAMASKEngine.app build/dist/MEETAMASKEngine.zip

# 5) Upload build/dist/MEETAMASKEngine.zip to the CDN and set the URL in
#    EngineInstaller.sourceURL. Ship the stapled host app (zip/DMG).
```

## ⚠️ Release invariant — ship BOTH assets, always

`dl.meetamask.com/app` **and** `dl.meetamask.com/engine` both redirect to
`releases/latest/download/<name>.zip`. The moment a new tag becomes `latest` it MUST already
carry `MEETAMASK.zip` **and** `MEETAMASKEngine.zip`. Cutting a release with only the host made
`/engine` return 404, so a first run on a clean Mac could not install the engine at all.

Host and engine are ONE wire contract (the frame geometry is compiled into both, see
`engine/frame_geometry.h` + `Shared/Shared.swift`) — never publish one without the matching
other, and bump `EngineInstaller.engineContract` when that contract changes so existing
installs re-download instead of silently dropping every frame.

Check after every release:
```bash
curl -sIL https://dl.meetamask.com/app    | grep -i '^HTTP'   # must end 200/206
curl -sIL https://dl.meetamask.com/engine | grep -i '^HTTP'   # must end 200/206
```

## Verify (on this machine, and ideally a clean one)

```bash
spctl -a -vvv build/app/Build/Products/Release/MEETAMASK.app   # → accepted, Notarized Developer ID
codesign --verify --deep --strict build/dist/MEETAMASKEngine.app
```

## Scripts

- `sign-host.sh`     — Developer ID sign the light host + camera extension.
- `sign-engine.sh`   — Developer ID sign the engine inside-out (framework dylibs → framework → 5 helpers → engine), stripping bogus symlinks.
- `package-engine.sh`— stage engine, replace mangled framework with pristine, sign, zip.
- `notarize.sh`      — submit to Apple notary, wait, staple.
- `entitlements/cef.plist` — JIT / unsigned-memory / disable-library-validation for CEF processes.
