import SwiftUI
import AppKit

// MEETAMASK — "The Stage". One dark screen: the user's live masked feed on the left,
// the mask library on the right. Brand language matches meetamask.com (Times New Roman
// caps + monospaced labels + warm black / cream, colour only from mask imagery).
// Design source of truth: DESIGN.md.

private enum Brand {
    static let stage  = Color(red: 0.047, green: 0.043, blue: 0.039)   // #0c0b0a
    static let ink    = Color(red: 0.961, green: 0.945, blue: 0.914)   // cream #f5f1e9
    static let ink2   = Color(red: 0.741, green: 0.725, blue: 0.698)   // #bdb9b2
    static let muted  = Color(red: 0.486, green: 0.463, blue: 0.424)   // #7c766c
    static let live   = Color(red: 0.878, green: 0.329, blue: 0.243)   // #e0543e
    static let warn   = Color(red: 0.957, green: 0.745, blue: 0.282)   // amber (switching)
    static let panel  = Color.white.opacity(0.035)
    static let card   = Color.white.opacity(0.05)
    static var hair: Color { ink.opacity(0.13) }

    static func disp(_ s: CGFloat) -> Font { .custom("TimesNewRomanPS-BoldMT", size: s) }
    static func mono(_ s: CGFloat, _ w: Font.Weight = .medium) -> Font { .system(size: s, weight: w, design: .monospaced) }

    /// Muted hue per mask, derived from its leading tag — gives the grid a colour rhythm
    /// grouped by vibe (colour encodes meaning, not sequence).
    static func tint(for tags: [String]) -> Color {
        for t in tags {
            switch t {
            case "color", "trippy":          return Color(hue: 0.74, saturation: 0.5, brightness: 0.7)
            case "retro", "glitch":          return Color(hue: 0.45, saturation: 0.45, brightness: 0.6)
            case "face", "tracking", "pose": return Color(hue: 0.56, saturation: 0.5, brightness: 0.7)
            case "hands", "gesture":         return Color(hue: 0.10, saturation: 0.55, brightness: 0.7)
            case "fun":                      return Color(hue: 0.95, saturation: 0.45, brightness: 0.7)
            case "motion":                   return Color(hue: 0.83, saturation: 0.4, brightness: 0.65)
            default: continue
            }
        }
        return Color(hue: 0.10, saturation: 0.05, brightness: 0.6)   // neutral for filter/edges/minimal/subtle/clean
    }
}

/// Lazily-decoded, cached mask preview images (bundled `preview.webp`).
private enum Thumb {
    static var cache: [String: NSImage] = [:]
    static func image(_ m: Mask) -> NSImage? {
        if let c = cache[m.id] { return c }
        guard let u = m.previewURL, let img = NSImage(contentsOf: u) else { return nil }
        cache[m.id] = img
        return img
    }
}

private enum AirStatus { case live, switching, paused }

struct StageView: View {
    @State private var masks: [Mask] = MaskLibrary.all()
    @State private var selectedID: String?
    @State private var search = ""
    @State private var activeTag = "All"
    @State private var paused = false
    @AppStorage("favoriteMaskIDs") private var favCSV = ""

    @StateObject private var engine = EngineFrameReceiver()
    @StateObject private var installer = EngineInstaller()
    @StateObject private var ext = ExtensionManager()

    private var selected: Mask? { masks.first { $0.id == selectedID } ?? masks.first }
    private var favorites: Set<String> { Set(favCSV.split(separator: ",").map(String.init)) }
    private var tags: [String] { ["All"] + MaskLibrary.allTags(masks) }

    private var status: AirStatus {
        if paused || !engine.isRunning { return .paused }
        return engine.switching ? .switching : .live
    }

    private var filtered: [Mask] {
        masks.filter { m in
            (activeTag == "All" || m.tags.contains(activeTag)) &&
            (search.isEmpty || m.name.localizedCaseInsensitiveContains(search))
        }
    }

    var body: some View {
        ZStack {
            Brand.stage.ignoresSafeArea()
            VStack(spacing: 0) {
                header
                HStack(alignment: .top, spacing: 14) {
                    rail.frame(width: 280)
                    library.frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
        }
        .frame(minWidth: 1080, minHeight: 680)
        .onChange(of: selectedID) { _ in
            if engine.isRunning, !paused, let m = selected { engine.start(maskURL: m.indexURL) }
        }
        .onAppear {
            if selectedID == nil {
                selectedID = masks.first(where: { $0.id == "meetamask-studio" })?.id ?? masks.first?.id
            }
        }
        .task {
            await installer.ensureInstalled()
            if installer.state == .installed, !engine.isRunning, !paused, let m = selected {
                engine.start(maskURL: m.indexURL)
            }
        }
    }

    // MARK: Header

    private var header: some View {
        HStack {
            Text("MEETAMASK").font(Brand.disp(19)).tracking(1.5).foregroundStyle(Brand.ink)
            Spacer()
            Text("Virtual camera").font(Brand.mono(9.5)).tracking(1).textCase(.uppercase).foregroundStyle(Brand.muted)
        }
        .padding(.leading, 80).padding(.trailing, 18)
        .padding(.top, 15).padding(.bottom, 11)
        .overlay(Rectangle().fill(Brand.hair).frame(height: 1), alignment: .bottom)
    }

    private var statusDot: Color {
        switch status { case .live: return Brand.live; case .switching: return Brand.warn; case .paused: return Brand.muted }
    }
    private var statusLabel: String {
        switch status { case .live: return "Engine live"; case .switching: return "Switching…"; case .paused: return "Paused" }
    }

    // MARK: Left rail (the ON AIR panel)

    private var rail: some View {
        VStack(alignment: .leading, spacing: 0) {
            preview
            if let m = selected {
                HStack {
                    Text(m.name).font(Brand.disp(20)).textCase(.uppercase).foregroundStyle(Brand.ink).lineLimit(1)
                    Spacer()
                    favButton(m, size: 16)
                }
                .padding(.top, 11)

                if !m.tags.isEmpty {
                    tagWrap(m.tags).padding(.top, 8)
                }
            }

            Button(action: toggleAir) {
                Text(status == .paused ? "Go live" : "Pause")
                    .font(Brand.mono(12.5, .semibold)).textCase(.uppercase).tracking(0.5)
                    .frame(maxWidth: .infinity).padding(.vertical, 9)
                    .background(Brand.ink).foregroundStyle(Brand.stage)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain).padding(.top, 12)

            HStack(spacing: 7) {
                Circle().fill(statusDot).frame(width: 6, height: 6)
                Text(statusLabel).font(Brand.mono(10)).tracking(0.5).textCase(.uppercase).foregroundStyle(Brand.ink2)
            }
            .padding(.top, 11)
            if status == .live {
                Text("Choose “MEETAMASK Camera” in Meet or Zoom")
                    .font(Brand.mono(9.5)).foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true).padding(.top, 5)
            }

            Spacer(minLength: 14)
            setupBlock
            Text("\(Self.fpsLabel(engine)) · 1280×720")
                .font(Brand.mono(9.5)).tracking(0.5).textCase(.uppercase).foregroundStyle(Brand.muted)
                .padding(.top, 10)
        }
        .padding(11)
        .background(Brand.panel)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Brand.hair, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var preview: some View {
        ZStack {
            Color.black
            switch installer.state {
            case .downloading(let p): installProgress("Downloading engine…", p)
            case .unpacking:          installProgress("Installing engine…", nil)
            case .failed(let msg):    centered(Text(msg).font(Brand.mono(10)).foregroundStyle(Brand.live))
            case .checking, .installed:
                if let img = engine.previewImage {
                    // Live self-view: mirrored (camera output stays raw).
                    Image(nsImage: img).resizable().aspectRatio(contentMode: .fill).scaleEffect(x: -1, y: 1)
                } else if let m = selected, let poster = Thumb.image(m) {
                    // No live frame yet (paused / starting): show the mask's preview render as a poster.
                    Image(nsImage: poster).resizable().aspectRatio(contentMode: .fill)
                } else {
                    centered(Text("Paused").font(Brand.mono(11)).tracking(1).textCase(.uppercase).foregroundStyle(Brand.muted))
                }
            }
            if status == .switching {
                ZStack { Color.black.opacity(0.55)
                    Text("Switching…").font(Brand.mono(11)).tracking(1).textCase(.uppercase).foregroundStyle(Brand.ink2) }
            }
            if status == .live {
                VStack { HStack {
                    HStack(spacing: 5) {
                        Circle().fill(Brand.live).frame(width: 6, height: 6)
                        Text("Live").font(Brand.mono(9)).tracking(1).textCase(.uppercase).foregroundStyle(Brand.ink)
                    }
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Color.black.opacity(0.5)).clipShape(Capsule())
                    Spacer()
                }; Spacer() }.padding(8)
            }
        }
        .aspectRatio(16.0/9.0, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 9))
    }

    // Camera-extension setup — lives in the rail's free space (no popup).
    private var setupBlock: some View {
        VStack(alignment: .leading, spacing: 7) {
            Rectangle().fill(Brand.hair).frame(height: 1)
            Text("Camera extension").font(Brand.mono(9.5)).tracking(1).textCase(.uppercase).foregroundStyle(Brand.muted)
            Group {
                if ext.needsApproval {
                    Text("Approve in System Settings → Camera Extensions").foregroundStyle(Brand.warn)
                } else if let last = lastLog {
                    Text(last).foregroundStyle(Brand.ink2).lineLimit(2)
                } else {
                    Text("Activate to register “MEETAMASK Camera”").foregroundStyle(Brand.ink2)
                }
            }
            .font(Brand.mono(9.5)).fixedSize(horizontal: false, vertical: true)
            Button { ext.activate() } label: {
                Text(ext.isBusy ? "Activating…" : "Activate")
                    .font(Brand.mono(10.5, .semibold)).textCase(.uppercase).tracking(0.5)
                    .padding(.horizontal, 14).padding(.vertical, 6)
                    .overlay(Capsule().stroke(Brand.hair, lineWidth: 1)).foregroundStyle(Brand.ink)
            }.buttonStyle(.plain).disabled(ext.isBusy)
        }
        .padding(.bottom, 8)
    }
    private var lastLog: String? { ext.statusLog.split(separator: "\n").map(String.init).last }

    // MARK: Right library

    private var library: some View {
        VStack(spacing: 11) {
            HStack(spacing: 9) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(Brand.muted)
                    TextField("Search", text: $search)
                        .textFieldStyle(.plain).font(Brand.mono(12)).foregroundStyle(Brand.ink)
                }
                .padding(.horizontal, 10).padding(.vertical, 6).frame(width: 150)
                .overlay(Capsule().stroke(Brand.hair, lineWidth: 1))

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) { ForEach(tags, id: \.self) { tagChip($0) } }
                }
            }

            if filtered.isEmpty {
                Spacer()
                Text("No masks match — clear search or tags")
                    .font(Brand.mono(11)).foregroundStyle(Brand.muted)
                Spacer()
            } else {
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                        ForEach(filtered) { card($0) }
                        // plusCard returns as the entry to Customize (preset maker) — the site
                        // has no upload today, so linking there was a dead end.
                    }
                    .padding(.bottom, 6)
                }
            }
        }
    }

    private func card(_ m: Mask) -> some View {
        let isSel = m.id == selectedID
        // NOTE: selection is an onTapGesture (NOT a Button) so the favourite star can be a
        // real Button overlaid on top — nesting Buttons made star taps fall through to select.
        return ZStack {
            if let img = Thumb.image(m) {
                Image(nsImage: img).resizable().aspectRatio(contentMode: .fill)
            } else {
                Brand.tint(for: m.tags).opacity(0.18).background(Brand.card)
            }
        }
        .aspectRatio(1, contentMode: .fit)   // square: native ratio of the 320×320 previews
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(alignment: .bottomLeading) {
            Text(m.name).font(Brand.disp(13)).textCase(.uppercase).foregroundStyle(Brand.ink)
                .lineLimit(1).padding(.horizontal, 7).padding(.vertical, 5)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(LinearGradient(colors: [.clear, Brand.stage.opacity(0.9)], startPoint: .top, endPoint: .bottom))
        }
        .overlay(alignment: .topLeading) { if isSel { airBadge.padding(5) } }
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(isSel ? Brand.ink : Brand.hair, lineWidth: isSel ? 2 : 1))
        .overlay(alignment: .topTrailing) { favButton(m, size: 13).padding(6) }
        .contentShape(Rectangle())
        // Tap only updates selection — .onChange(of: selectedID) performs the engine swap.
        // (Starting here too made every click relaunch the engine twice.)
        .onTapGesture { selectedID = m.id }
    }

    // The last cell: take the user to the site to get / upload a new mask.
    private var plusCard: some View {
        Button { NSWorkspace.shared.open(URL(string: "https://meetamask.com/gallery")!) } label: {
            ZStack {
                Brand.card
                VStack(spacing: 6) {
                    Image(systemName: "plus").font(.system(size: 22, weight: .light)).foregroundStyle(Brand.ink2)
                    Text("New mask").font(Brand.mono(9.5)).tracking(0.6).textCase(.uppercase).foregroundStyle(Brand.muted)
                }
            }
            .aspectRatio(16.0/10.0, contentMode: .fit).frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Brand.hair, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
        }.buttonStyle(.plain)
    }

    @ViewBuilder private var airBadge: some View {
        if status != .paused {
            let (c, t) = status == .switching ? (Brand.warn, "Switching") : (Brand.live, "On air")
            HStack(spacing: 4) {
                Circle().fill(c).frame(width: 5, height: 5)
                Text(t).font(Brand.mono(8, .semibold)).tracking(0.8).textCase(.uppercase).foregroundStyle(Brand.ink)
            }
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(Color.black.opacity(0.6)).clipShape(Capsule())
        }
    }

    // MARK: Bits

    private func tagChip(_ t: String) -> some View {
        let on = t == activeTag
        return Button { activeTag = t } label: {
            Text(t).font(Brand.mono(11)).foregroundStyle(on ? Brand.stage : Brand.ink2)
                .padding(.horizontal, 11).padding(.vertical, 5)
                .background(on ? Brand.ink : Color.clear)
                .overlay(Capsule().stroke(on ? Color.clear : Brand.hair, lineWidth: 1))
                .clipShape(Capsule())
        }.buttonStyle(.plain)
    }

    private func tagWrap(_ ts: [String]) -> some View {
        HStack(spacing: 5) {
            ForEach(ts.prefix(4), id: \.self) { t in
                Text(t).font(Brand.mono(10)).foregroundStyle(Brand.ink2)
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .overlay(Capsule().stroke(Brand.hair, lineWidth: 1))
            }
        }
    }

    private func favButton(_ m: Mask, size: CGFloat) -> some View {
        let fav = favorites.contains(m.id)
        return Button { toggleFav(m.id) } label: {
            Image(systemName: fav ? "star.fill" : "star")
                .font(.system(size: size)).foregroundStyle(fav ? Brand.warn : Brand.muted)
        }.buttonStyle(.plain)
    }

    private func installProgress(_ text: String, _ p: Double?) -> some View {
        VStack(spacing: 8) {
            ProgressView(value: p).frame(width: 120).tint(Brand.ink)
            Text(p == nil ? text : "\(text) \(Int((p ?? 0) * 100))%")
                .font(Brand.mono(9.5)).foregroundStyle(Brand.ink2)
        }
    }

    private func centered<V: View>(_ v: V) -> some View {
        VStack { Spacer(); v.multilineTextAlignment(.center).padding(10); Spacer() }
    }

    // MARK: Actions

    private func toggleAir() {
        if status == .paused {
            paused = false
            Task { await installer.ensureInstalled(); if let m = selected { engine.start(maskURL: m.indexURL) } }
        } else {
            paused = true
            engine.stop()
        }
    }

    private func toggleFav(_ id: String) {
        var s = favorites
        if s.contains(id) { s.remove(id) } else { s.insert(id) }
        favCSV = s.sorted().joined(separator: ",")
    }

    private static func fpsLabel(_ e: EngineFrameReceiver) -> String {
        e.isRunning ? "Live" : "Idle"   // fps shown only once actually measured
    }
}
