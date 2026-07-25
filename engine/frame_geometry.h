#pragma once

// Single source of truth for the virtual-camera frame geometry on the ENGINE side.
// Must stay in sync with Shared/Shared.swift (fixedCamWidth / fixedCamHeight), which is
// the contract between the host app and the camera system extension.
//
// 1080p, because that is what the physical Mac camera delivers: shipping a 720p virtual
// camera made every call visibly softer than the built-in one (2.25x fewer pixels).
namespace mm {
constexpr int kFrameWidth = 1920;
constexpr int kFrameHeight = 1080;
}  // namespace mm
