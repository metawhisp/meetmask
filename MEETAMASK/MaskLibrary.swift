import Foundation

/// A mask = a self-contained web page (folder with an `index.html`), run as-is.
struct Mask: Identifiable, Hashable {
    let id: String        // folder name, unique
    let name: String      // display name
    let indexURL: URL     // file URL to index.html
    let isBuiltIn: Bool
    var tags: [String] = []   // free-form, author-set (bundled: Masks/tags.json)
    var blurb: String = ""    // one-line description
    var previewURL: URL? = nil   // bundled preview.webp, if present
}

/// Tag catalog entry decoded from the bundled `Masks/tags.json`.
private struct MaskMeta: Decodable {
    let id: String
    let tags: [String]
    let blurb: String
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
        let masksRoot = Bundle.main.resourceURL?.appendingPathComponent("Masks", isDirectory: true)
        let meta = masksRoot.map(loadMeta) ?? [:]
        let builtin = masksRoot.map { scan($0, isBuiltIn: true, meta: meta) } ?? []
        let user = userMasksDir.map { scan($0, isBuiltIn: false, meta: meta) } ?? []
        return approvedMasks(builtin: builtin, user: user)
    }

    /// Every distinct tag across the given masks, in descending frequency then alphabetical —
    /// drives the gallery's tag filter row.
    static func allTags(_ masks: [Mask]) -> [String] {
        var freq: [String: Int] = [:]
        for m in masks { for t in m.tags { freq[t, default: 0] += 1 } }
        return freq.keys.sorted { (freq[$0]!, $1) > (freq[$1]!, $0) }
    }

    /// Load `Masks/tags.json` → id-keyed metadata. Missing file ⇒ empty (masks still load).
    private static func loadMeta(in root: URL) -> [String: MaskMeta] {
        let url = root.appendingPathComponent("tags.json")
        guard let data = try? Data(contentsOf: url),
              let list = try? JSONDecoder().decode([MaskMeta].self, from: data) else { return [:] }
        return Dictionary(list.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
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

    private static func scan(_ root: URL, isBuiltIn: Bool, meta: [String: MaskMeta]) -> [Mask] {
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
            let preview = dir.appendingPathComponent("preview.webp")
            masks.append(Mask(id: id, name: prettify(id), indexURL: index, isBuiltIn: isBuiltIn,
                              tags: meta[id]?.tags ?? [], blurb: meta[id]?.blurb ?? "",
                              previewURL: fm.fileExists(atPath: preview.path) ? preview : nil))
        }
        return masks
    }

    private static func prettify(_ id: String) -> String {
        id.replacingOccurrences(of: "-", with: " ")
          .replacingOccurrences(of: "_", with: " ")
          .capitalized
    }
}
