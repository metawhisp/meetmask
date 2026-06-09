import Foundation
import SystemExtensions
import os.log

/// Drives activation / deactivation of the bundled camera system extension.
/// Callbacks arrive on the main queue (we pass `.main` to the request), so it is
/// safe to mutate the @Published properties directly from the delegate methods.
final class ExtensionManager: NSObject, ObservableObject {

    static let extensionIdentifier = "com.meetamask.app.CameraExtension"

    @Published private(set) var statusLog: String = ""
    @Published private(set) var isBusy: Bool = false
    @Published private(set) var needsApproval: Bool = false

    func activate() {
        log("Requesting activation of \(Self.extensionIdentifier)…")
        isBusy = true
        needsApproval = false
        let request = OSSystemExtensionRequest.activationRequest(forExtensionWithIdentifier: Self.extensionIdentifier,
                                                                 queue: .main)
        request.delegate = self
        OSSystemExtensionManager.shared.submitRequest(request)
    }

    func deactivate() {
        log("Requesting deactivation of \(Self.extensionIdentifier)…")
        isBusy = true
        needsApproval = false
        let request = OSSystemExtensionRequest.deactivationRequest(forExtensionWithIdentifier: Self.extensionIdentifier,
                                                                   queue: .main)
        request.delegate = self
        OSSystemExtensionManager.shared.submitRequest(request)
    }

    private func log(_ message: String) {
        os_log("MEETAMASK: %{public}@", message)
        statusLog += message + "\n"
    }
}

extension ExtensionManager: OSSystemExtensionRequestDelegate {

    func request(_ request: OSSystemExtensionRequest,
                 actionForReplacingExtension existing: OSSystemExtensionProperties,
                 withExtension ext: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction {
        log("Replacing existing extension \(existing.bundleShortVersion) with \(ext.bundleShortVersion).")
        return .replace
    }

    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        needsApproval = true
        log("Needs approval — open System Settings → General → Login Items & Extensions → Camera Extensions and enable MEETAMASK.")
    }

    func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) {
        isBusy = false
        needsApproval = false
        switch result {
        case .completed:
            log("Done. The “MEETAMASK Camera” should now be available in camera apps.")
        case .willCompleteAfterReboot:
            log("Will complete after reboot.")
        @unknown default:
            log("Finished with result code \(result.rawValue).")
        }
    }

    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        isBusy = false
        needsApproval = false
        log("Failed: \(error.localizedDescription)")
        log("Tip: run MEETAMASK from /Applications, or enable developer mode: systemextensionsctl developer on")
    }
}
