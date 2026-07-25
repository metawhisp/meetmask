//  Shared.swift
//  Constants and helpers compiled into BOTH the host app and the camera extension,
//  so the two processes agree on the camera name, format and the sink-readiness
//  handshake property. Keep this file dependency-light.

import Foundation
import CoreMediaIO

// MARK: - Camera format (single source of truth for both targets)

let kFrameRate: Int = 30
let cameraName = "MEETAMASK Camera"
// 1080p, matching what the physical Mac camera delivers. A 720p virtual camera made every
// call visibly softer than the built-in one (2.25x fewer pixels). Keep in sync with
// engine/frame_geometry.h — the engine renders and publishes frames at exactly this size.
let fixedCamWidth: Int32 = 1920
let fixedCamHeight: Int32 = 1080

// MARK: - Sink readiness handshake
//
// The extension publishes a custom property on its SOURCE stream that the app polls
// to learn whether it should push frames into the sink yet. The property name must be
// exactly 4 characters so it maps to a CMIOObjectPropertySelector four-char-code.

enum SinkPropertyName: String, CaseIterable {
    case sink // 4 chars — maps to a four-char-code selector on the host side
}

enum SinkStateOptions: String {
    case trueState = "true"
    case falseState = "false"
}

extension String {
    /// Converts a 4-character string into a `CMIOObjectPropertySelector` four-char-code,
    /// matching how the extension registers its custom sink property.
    func convertedToCMIOObjectPropertySelectorName() -> CMIOObjectPropertySelector {
        let noName: CMIOObjectPropertySelector = 0
        if count == MemoryLayout<CMIOObjectPropertySelector>.size {
            return data(using: .utf8, allowLossyConversion: false)?.withUnsafeBytes {
                $0.load(as: CMIOObjectPropertySelector.self).byteSwapped
            } ?? noName
        } else {
            return noName
        }
    }
}
