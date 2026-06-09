import SwiftUI

/// Gallery of masks (built-in + user). Renders the selected mask in the headless engine and
/// streams it into the MEETAMASK virtual camera. The preview shows the exact frames going to
/// the camera. Because the engine has no window, the stream never freezes when the app is
/// hidden / minimised / Meet is full-screen.
struct MaskGalleryView: View {
    @State private var masks: [Mask] = MaskLibrary.all()
    @State private var selectedID: String?
    @StateObject private var engine = EngineFrameReceiver()
    @StateObject private var installer = EngineInstaller()

    private var selected: Mask? {
        masks.first { $0.id == selectedID } ?? masks.first
    }

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Маски")
                    .font(.headline)
                    .padding(.horizontal, 12).padding(.top, 12)

                List(selection: $selectedID) {
                    ForEach(masks) { mask in
                        Label(mask.name, systemImage: mask.isBuiltIn ? "theatermasks.fill" : "theatermasks")
                            .tag(mask.id)
                    }
                }
                .listStyle(.sidebar)

                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(engine.isRunning ? Color.red : Color.secondary)
                            .frame(width: 9, height: 9)
                        Text(engine.isRunning ? "В эфире → MEETAMASK Camera" : "Эфир на паузе")
                            .font(.callout.weight(.medium))
                    }

                    Button(action: toggle) {
                        Label(engine.isRunning ? "Поставить на паузу" : "Включить эфир",
                              systemImage: engine.isRunning ? "pause.circle.fill" : "dot.radiowaves.left.and.right")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)

                    Text(engine.status)
                        .font(.caption)
                        .foregroundStyle(engine.isRunning ? Color.green : Color.secondary)

                    Button {
                        masks = MaskLibrary.all()
                    } label: {
                        Label("Обновить список", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.borderless)
                }
                .padding(12)
            }
            .frame(width: 250)

            Divider()

            ZStack {
                Color.black
                previewContent
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onChange(of: selectedID) { _ in
            if engine.isRunning, let mask = selected { engine.start(maskURL: mask.indexURL) }
        }
        .onAppear {
            if selectedID == nil {
                // Default to the clean studio mask (webcam + tasteful always-on grade, no clutter).
                selectedID = masks.first(where: { $0.id == "meetamask-studio" })?.id ?? masks.first?.id
            }
        }
        .task {
            // First launch: fetch the CEF engine into Application Support, THEN go live.
            await installer.ensureInstalled()
            startIfReady()
        }
        // NOTE: deliberately no .onDisappear stop — the stream must survive tab switches and
        // the app being hidden. The engine stops only via the pause button or app quit.
    }

    private func startIfReady() {
        if installer.state == .installed, !engine.isRunning, let mask = selected {
            engine.start(maskURL: mask.indexURL)
        }
    }

    private func toggle() {
        if engine.isRunning { engine.stop(); return }
        Task { await installer.ensureInstalled(); startIfReady() }
    }

    @ViewBuilder private var previewContent: some View {
        switch installer.state {
        case .downloading(let p):
            installProgress("Загрузка движка…", p)
        case .unpacking:
            installProgress("Установка движка…", nil)
        case .failed(let msg):
            placeholder("Не удалось загрузить движок:\n\(msg)")
        case .checking, .installed:
            if let img = engine.previewImage {
                Image(nsImage: img)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .scaleEffect(x: -1, y: 1)   // mirror the SELF-VIEW only; camera output stays raw
            } else if engine.isRunning {
                ProgressView("Запуск маски…").controlSize(.large).tint(.white)
            } else if selected != nil {
                placeholder("Нажми «Включить эфир», чтобы запустить маску.")
            } else {
                placeholder("Масок нет.\nПоложи папку с index.html в Masks/.")
            }
        }
    }

    private func installProgress(_ text: String, _ progress: Double?) -> some View {
        VStack(spacing: 12) {
            if let p = progress {
                ProgressView(value: p).frame(width: 220).tint(.white)
                Text("\(text) \(Int(p * 100))%").foregroundStyle(.secondary)
            } else {
                ProgressView().controlSize(.large).tint(.white)
                Text(text).foregroundStyle(.secondary)
            }
        }
    }

    private func placeholder(_ text: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "theatermasks").font(.system(size: 40)).foregroundStyle(.secondary)
            Text(text).multilineTextAlignment(.center).foregroundStyle(.secondary)
        }
    }
}
