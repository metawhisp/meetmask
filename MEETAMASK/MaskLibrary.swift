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
/// (`Resources/Masks/<id>/index.html`, trusted). User-imported masks live in `userMasksDir`
/// and are ALSO loaded, but the engine runs them sandboxed (`--untrusted`: no FS read / no
/// network — see EngineFrameReceiver), so untrusted HTML can't steal files or exfiltrate.
/// Import + validation happens in `importMask(from:)`.
enum MaskLibrary {

    /// Where imported user masks live. Namespaced under our own dir (NOT the bare
    /// ApplicationSupport/Masks — that path collected stale dupes of built-ins).
    static var userMasksDir: URL? {
        let fm = FileManager.default
        guard let support = try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                        appropriateFor: nil, create: true) else { return nil }
        let dir = support
            .appendingPathComponent("MEETAMASK", isDirectory: true)
            .appendingPathComponent("UserMasks", isDirectory: true)
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

    /// Load policy: built-in masks (app-authored, trusted) PLUS user-imported masks. User HTML
    /// is untrusted but SAFE to run because the engine sandboxes it (`--untrusted`: no local-file
    /// read, no network). A built-in id always wins over a user id, so an imported mask can never
    /// shadow or spoof a bundled one.
    static func approvedMasks(builtin: [Mask], user: [Mask]) -> [Mask] {
        var seen = Set<String>()
        return (builtin + user)                          // built-ins first → they claim their id
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

    // MARK: - Import / delete user masks

    enum ImportError: LocalizedError {
        case noIndex, tooBig, unreadable, unpackFailed
        var errorDescription: String? {
            switch self {
            case .noIndex:      return "В выбранном файле нет index.html — это не маска."
            case .tooBig:       return "Маска слишком большая (лимит 200 МБ)."
            case .unreadable:   return "Не удалось прочитать выбранный файл."
            case .unpackFailed: return "Не удалось распаковать архив."
            }
        }
    }

    /// Import a user mask from a picked `.zip` or a folder into `userMasksDir/<id>/`; returns the
    /// new mask id. The mask CONTENT stays untrusted (it only ever runs in the engine's
    /// `--untrusted` jail) — this validates the package and stages the files only.
    @discardableResult
    static func importMask(from source: URL) throws -> String {
        let fm = FileManager.default
        guard let userRoot = userMasksDir else { throw ImportError.unreadable }

        // 1) Materialise a plain directory tree we can inspect (unzip, or use the folder as-is).
        let tmp = fm.temporaryDirectory.appendingPathComponent("mm-import-\(UUID().uuidString)", isDirectory: true)
        try? fm.removeItem(at: tmp)
        try fm.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tmp) }

        let staged: URL
        let ext = source.pathExtension.lowercased()
        var isDir: ObjCBool = false
        let exists = fm.fileExists(atPath: source.path, isDirectory: &isDir)
        if ext == "zip" {
            try unzip(source, into: tmp); staged = tmp
        } else if exists && isDir.boolValue {
            staged = source
        } else if exists && (ext == "html" || ext == "htm") {
            // A single page (e.g. straight from Claude) → wrap it as index.html in a fresh folder.
            try fm.copyItem(at: source, to: tmp.appendingPathComponent("index.html"))
            staged = tmp
        } else {
            throw ImportError.unreadable
        }

        // 2) Locate the mask root (dir directly containing index.html — the dir itself or one level down).
        guard let root = locateMaskRoot(in: staged) else { throw ImportError.noIndex }
        // 3) Reject oversized packages (zip-bomb / accidental) and any symlink escaping the root.
        guard directorySize(of: root) <= 200 * 1024 * 1024 else { throw ImportError.tooBig }
        if hasEscapingSymlink(root) { throw ImportError.unreadable }

        // 4) Copy into userMasksDir/<id> (sanitized, unique, never shadowing a built-in).
        var base = sanitizeID(source.deletingPathExtension().lastPathComponent)
        if base == "index" || base == "mask" { base = "my-mask" }   // a bare index.html shouldn't become "Index"
        let id = uniqueUserID(base: base)
        let dest = userRoot.appendingPathComponent(id, isDirectory: true)
        try? fm.removeItem(at: dest)
        try fm.copyItem(at: root, to: dest)
        return id
    }

    /// Delete an imported user mask by id (no-op for built-ins — their dir isn't here).
    static func deleteUserMask(id: String) {
        guard let dir = userMasksDir?.appendingPathComponent(id, isDirectory: true) else { return }
        try? FileManager.default.removeItem(at: dir)
    }

    private static func unzip(_ zip: URL, into dir: URL) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        p.arguments = ["-x", "-k", zip.path, dir.path]   // ditto guards against path-traversal entries
        do { try p.run() } catch { throw ImportError.unpackFailed }
        p.waitUntilExit()
        if p.terminationStatus != 0 { throw ImportError.unpackFailed }
    }

    /// A mask root = a directory directly containing index.html. Accept the staged dir itself,
    /// or exactly one wrapper level down (zips often wrap everything in a top folder).
    private static func locateMaskRoot(in dir: URL) -> URL? {
        let fm = FileManager.default
        if fm.fileExists(atPath: dir.appendingPathComponent("index.html").path) { return dir }
        let kids = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isDirectoryKey],
                                                options: [.skipsHiddenFiles])) ?? []
        for k in kids {
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: k.path, isDirectory: &isDir), isDir.boolValue else { continue }
            if fm.fileExists(atPath: k.appendingPathComponent("index.html").path) { return k }
        }
        return nil
    }

    private static func directorySize(of dir: URL) -> Int64 {
        let fm = FileManager.default
        var total: Int64 = 0
        if let en = fm.enumerator(at: dir, includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey]) {
            for case let u as URL in en {
                let v = try? u.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
                if v?.isRegularFile == true { total += Int64(v?.fileSize ?? 0) }
            }
        }
        return total
    }

    /// True if any symlink under `root` resolves OUTSIDE `root` (blocks link-based escapes).
    private static func hasEscapingSymlink(_ root: URL) -> Bool {
        let fm = FileManager.default
        let base = root.resolvingSymlinksInPath().standardizedFileURL.path
        guard let en = fm.enumerator(at: root, includingPropertiesForKeys: [.isSymbolicLinkKey]) else { return false }
        for case let u as URL in en {
            let isLink = (try? u.resourceValues(forKeys: [.isSymbolicLinkKey]))?.isSymbolicLink == true
            guard isLink else { continue }
            let resolved = u.resolvingSymlinksInPath().standardizedFileURL.path
            if resolved != base && !resolved.hasPrefix(base + "/") { return true }
        }
        return false
    }

    /// Fold to a safe slug: lowercase ASCII alnum, dashes elsewhere, collapsed, ≤40 chars.
    private static func sanitizeID(_ raw: String) -> String {
        let mapped = raw.lowercased().map { ch -> Character in
            (ch.isASCII && (ch.isLetter || ch.isNumber)) ? ch : "-"
        }
        var s = String(mapped)
        while s.contains("--") { s = s.replacingOccurrences(of: "--", with: "-") }
        s = s.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return s.isEmpty ? "mask" : String(s.prefix(40))
    }

    /// A user id that collides with neither an existing user mask nor a built-in (append -2, -3…).
    private static func uniqueUserID(base: String) -> String {
        let builtinIDs = Set((Bundle.main.resourceURL
            .map { scan($0.appendingPathComponent("Masks", isDirectory: true), isBuiltIn: true, meta: [:]) } ?? [])
            .map { $0.id })
        let fm = FileManager.default
        func taken(_ id: String) -> Bool {
            if builtinIDs.contains(id) { return true }
            if let d = userMasksDir?.appendingPathComponent(id, isDirectory: true), fm.fileExists(atPath: d.path) { return true }
            return false
        }
        if !taken(base) { return base }
        var n = 2
        while taken("\(base)-\(n)") { n += 1 }
        return "\(base)-\(n)"
    }
}
