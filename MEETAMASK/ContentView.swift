import SwiftUI

struct ContentView: View {
    @StateObject private var manager = ExtensionManager()
    @ObservedObject private var feeder = CameraFeeder.shared

    var body: some View {
        VStack(spacing: 18) {
            VStack(spacing: 4) {
                Text("MEETAMASK")
                    .font(.system(size: 34, weight: .bold))
                Text("Virtual camera · M1 Iteration 2 (app-fed frames)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 12) {
                Button(action: manager.activate) {
                    Label("Activate camera", systemImage: "video.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(manager.isBusy)

                Button(role: .destructive, action: manager.deactivate) {
                    Label("Deactivate", systemImage: "video.slash.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .disabled(manager.isBusy)
            }

            if manager.needsApproval {
                Label("Approve MEETAMASK in System Settings → General → Login Items & Extensions → Camera Extensions.",
                      systemImage: "exclamationmark.triangle.fill")
                    .font(.callout)
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            GroupBox("Status") {
                ScrollView {
                    Text(manager.statusLog.isEmpty ? "Idle." : manager.statusLog)
                        .font(.system(.footnote, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .frame(height: 170)
            }

            Text("After activating and approving, pick “MEETAMASK Camera” in Photo Booth, QuickTime, or Google Meet.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(width: 560)
    }
}

#Preview {
    ContentView()
}
