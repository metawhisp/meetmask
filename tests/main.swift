import Foundation

// Standalone unit test for MaskLibrary's mask-source policy (no Xcode test target
// exists; this compiles against the real MaskLibrary.swift).
//
// Run:
//   swiftc MEETAMASK/MaskLibrary.swift tests/main.swift -o /tmp/masktest && /tmp/masktest
//
// Lives under tests/ (NOT under MEETAMASK/, which is globbed into the app target —
// top-level code there would break the app build).
//
// POLICY UNDER TEST (current): user-imported masks ARE loaded, because the engine runs
// anything under userMasksDir in a jail (`--untrusted`: no local-file read, no network —
// see EngineFrameReceiver.isUntrustedMaskURL). The security property that must hold is
// that a user mask can never SHADOW a built-in id — that would let dropped HTML
// impersonate an app-authored mask and inherit its trusted path.

func mask(_ id: String, builtIn: Bool) -> Mask {
    Mask(id: id, name: id.capitalized, indexURL: URL(fileURLWithPath: "/tmp/\(id)/index.html"), isBuiltIn: builtIn)
}

let builtin = [mask("vhs", builtIn: true), mask("thermal", builtIn: true)]
// User-imported masks — including an id that collides with a built-in (the spoof attempt).
let user = [mask("evil", builtIn: false), mask("thermal", builtIn: false)]

let approved = MaskLibrary.approvedMasks(builtin: builtin, user: user)

// 1) User masks are offered to the user — they are safe because they run sandboxed.
assert(approved.contains { $0.id == "evil" }, "user-imported mask should be listed (it runs sandboxed)")

// 2) THE security property: a colliding id always resolves to the BUILT-IN entry.
let thermal = approved.filter { $0.id == "thermal" }
assert(thermal.count == 1, "id must be unique after the merge, got \(thermal.count)")
assert(thermal.first?.isBuiltIn == true, "a user mask must NEVER shadow a built-in id")

// 3) No duplicates, everything accounted for.
assert(Set(approved.map { $0.id }).count == approved.count, "no duplicate ids")
assert(approved.count == 3, "expected vhs + thermal + evil, got \(approved.count)")

// 4) Sorted by display name.
assert(approved.map { $0.id } == ["evil", "thermal", "vhs"], "sorted by display name")

// 5) With no built-ins, user masks still load — and none of them claims built-in trust.
let userOnly = MaskLibrary.approvedMasks(builtin: [], user: user)
assert(userOnly.count == 2, "user masks load even with no built-ins")
assert(userOnly.allSatisfy { !$0.isBuiltIn }, "no user mask may claim built-in trust")

// 6) Empty everything is fine.
assert(MaskLibrary.approvedMasks(builtin: [], user: []).isEmpty, "no masks ⇒ empty list")

print("OK: user masks load sandboxed, and can never shadow a built-in id")
