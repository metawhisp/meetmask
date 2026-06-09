import Foundation

// Standalone unit test for MaskLibrary's mask-source policy (no Xcode test target
// exists; this compiles against the real MaskLibrary.swift).
//
// Run:
//   swiftc MEETAMASK/MaskLibrary.swift tests/main.swift -o /tmp/masktest && /tmp/masktest
//
// Lives under tests/ (NOT under MEETAMASK/, which is globbed into the app target —
// top-level code there would break the app build).

func mask(_ id: String, builtIn: Bool) -> Mask {
    Mask(id: id, name: id.capitalized, indexURL: URL(fileURLWithPath: "/tmp/\(id)/index.html"), isBuiltIn: builtIn)
}

let builtin = [mask("vhs", builtIn: true), mask("thermal", builtIn: true)]
// Attacker-dropped masks in the user dir — including an id that collides with a built-in.
let user = [mask("evil", builtIn: false), mask("thermal", builtIn: false)]

let approved = MaskLibrary.approvedMasks(builtin: builtin, user: user)

assert(!approved.contains { $0.id == "evil" }, "user-dropped mask must NOT be loaded")
assert(approved.allSatisfy { $0.isBuiltIn }, "only app-approved built-ins may load")
assert(approved.count == 2, "expected exactly the two built-ins, got \(approved.count)")
assert(approved.map { $0.id } == ["thermal", "vhs"], "built-ins sorted by display name")

// Empty inputs are fine.
assert(MaskLibrary.approvedMasks(builtin: [], user: user).isEmpty, "no built-ins ⇒ nothing loads")

print("OK: arbitrary user-droppable HTML is not loaded")
