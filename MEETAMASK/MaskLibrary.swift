import Foundation

/// A mask = a self-contained web page (folder with an `index.html`), run as-is.
struct Mask: Identifiable, Hashable {
    let id: String        // folder name, unique
    let name: String      // display name
    let indexURL: URL     // file URL to index.html
    let isBuiltIn: Bool
}

/// Discovers masks and applies the load policy. Built-in masks are bundled in the app
/// (`Resources/Masks/<id>/index.html`) and are app-approved. User-droppable masks in
/// Application Support are enumerated but NOT loaded — running arbitrary uploaded HTML
/// is forbidden (spec §6 / §4 Excluded). A verified app-approved allow-list (+ sha256 +
/// signature) for non-built-in masks is a separate later step.
enum MaskLibrary {

    /// User masks folder, created on first access. This is where downloaded / user-made
    /// masks land later; for a sandboxed app it lives inside the app container.
    static var userMasksDir: URL? {
        let fm = FileManager.default
        guard let support = try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                        appropriateFor: nil, create: true) else { return nil }
        let dir = support.appendingPathComponent("Masks", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func all() -> [Mask] {
        let builtin = Bundle.main.resourceURL
            .map { scan($0.appendingPathComponent("Masks", isDirectory: true), isBuiltIn: true) } ?? []
        let user = userMasksDir.map { scan($0, isBuiltIn: false) } ?? []
        return approvedMasks(builtin: builtin, user: user)
    }

    /// Load policy: only app-approved built-ins are shown. User-droppable masks are
    /// enumerated (so we can warn) but NEVER loaded — running arbitrary uploaded HTML is
    /// forbidden (spec §6). A verified allow-list (+ sha256 + signature) for non-built-in
    /// masks is a separate later step; until it exists, user-dropped masks are ignored.
    static func approvedMasks(builtin: [Mask], user: [Mask]) -> [Mask] {
        if !user.isEmpty {
            let ids = user.map { $0.id }.joined(separator: ", ")
            fputs("MaskLibrary: ignoring \(user.count) user-dropped mask(s) — not app-approved: \(ids)\n", stderr)
        }
        var seen = Set<String>()
        return builtin
            .filter { seen.insert($0.id).inserted }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private static func scan(_ root: URL, isBuiltIn: Bool) -> [Mask] {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(at: root,
                                                        includingPropertiesForKeys: [.isDirectoryKey],
                                                        options: [.skipsHiddenFiles]) else { return [] }
        var masks: [Mask] = []
        for dir in entries {
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: dir.path, isDirectory: &isDir), isDir.boolValue else { continue }
            let index = dir.appendingPathComponent("index.html")
            guard fm.fileExists(atPath: index.path) else { continue }
            let id = dir.lastPathComponent
            masks.append(Mask(id: id, name: prettify(id), indexURL: index, isBuiltIn: isBuiltIn))
        }
        return masks
    }

    private static func prettify(_ id: String) -> String {
        id.replacingOccurrences(of: "-", with: " ")
          .replacingOccurrences(of: "_", with: " ")
          .capitalized
    }
}
