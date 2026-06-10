# MEETAMASK — Production design: "The Stage"

> Final, founder-approved direction for the app's main screen. Verified against the
> macOS 26 SDK surface and the brand site by an independent codex review (2026-06-10).
> Implementation is split into iterations I3–I6 in `ROADMAP.md`.

## Concept

The app is the inverse of the site's hero "You" tile: a **dark warm stage** where the
user's live video is the content and every control is glass floating above it.
One screen. No tabs. The site stays light paper; the app is its night-side — same
typography, same hairlines, same monochrome discipline.

## Tokens (shared with the site)

| Token | Value | Source |
|---|---|---|
| Stage background | `#0c0b0a` (warm black) | site `.tile.you` |
| Ink | `#f5f1e9` (cream) | site mask fill |
| Ink secondary | `#bdb9b2` · muted `#7c766c` | site |
| Hairline | cream @ 13% · soft @ 7% | site `--line` grammar |
| Display font | **Schibsted Grotesk** (wordmark caps `.08em`, kickers 600/10–12px `.16em` uppercase) | site `--disp` |
| Body font | **Hanken Grotesk** | site `--body` |
| System signal red | `#e0543e`-family, dot only — never decoration | site `.rec i` |
| Colour | **only inside mask thumbnails** — all chrome is monochrome | site rule |

Fonts are **bundled in the app** (codex: otherwise the app silently falls back to SF
and the brand link weakens).

## Layout (one screen, min window ≈ 1080×640)

- **Toolbar (native chrome, not a drawn bar):** wordmark MEETAMASK · spacer ·
  status capsule · gear. No "+ New mask" until Preset Maker ships (hidden behind a flag).
- **Left rail (~280px, one glass panel):**
  - live preview 16:9 — the same source frames the camera gets, mirrored only in UI;
  - mask name (display 600) + favorite star (always visible here);
  - tag chips (hairline capsules; tags are free-form, set by the author at creation/publish);
  - one primary capsule button: **Pause** ↔ **Go live** (cream fill, dark text);
  - guidance row when sink isn't consumed: "Choose MEETAMASK Camera in Meet";
  - bottom kicker telemetry — **measured values only** (`30 FPS · 1280×720` from the
    feeder's real counter; show `MEASURING…` until first measurement).
- **Right (library):** search capsule + tag chip row (`All` + aggregated free tags);
  **4-column grid** of 16:10 cards — static pre-rendered thumbnails (only the selected
  mask renders live), name on bottom scrim, star on hover/selected, selected = cream ring.

## Honest status model (codex: don't overclaim)

| State | Capsule | Preview | Grid badge | Primary button |
|---|---|---|---|---|
| Engine pushing frames | `● ENGINE LIVE` (red dot) | LIVE badge | `ON AIR` on the *confirmed* mask | Pause |
| Mask switching | `SWITCHING…` (amber dot) | switching overlay | `SWITCHING` on selected | Pause |
| Paused | `PAUSED` (grey dot) | no badge | none; card is just *Selected* | Go live |

`ON AIR` appears **only after the first frame of the new mask actually arrives** —
never on click. "Engine live" ≠ "you're on camera in Meet": the Meet guidance row
covers that gap.

## Liquid Glass — pragmatic mapping (codex-verified)

- Real APIs: `glassEffect` / `GlassEffectContainer` / `.buttonStyle(.glass/.glassProminent)`,
  AppKit `NSGlassEffectView` where SwiftUI is not enough. `.ultraThinMaterial` is a
  fallback, not "Liquid Glass".
- Native toolbar/titlebar idioms — no fake chrome.
- **Cut from v1 (decoration over function):** live blurred video as ambient backdrop
  (GPU cost on the same path that feeds the camera). Stage is solid warm black; revisit
  later as a downsampled 2–5fps, Reduce-Transparency-aware effect if ever.
- Glass budget: one rail + one toolbar treatment + cards. More glass = mush.

## Production states the screen must absorb (same visual language, glass sheets over dimmed stage)

Permissions (notDetermined/denied/restricted) · system extension (activating / needs
approval / reboot / failed / wrong install location) · engine (downloading + progress /
offline / unzip / signature / launch fail / crash) · stream (first-frame timeout / black
preview / low fps / frozen) · library (empty / no matches / invalid mask) · accessibility
(Reduce Transparency, Increase Contrast, Reduce Motion, keyboard nav; favorites must be
keyboard-accessible, not hover-only).

## Iteration mapping

- **I3 — Tags:** `tags: [String]` in the model + `meetamask.json` per mask + tag all 49 built-ins. (Author-set tags become an input in Preset Maker later.)
- **I4 — Stage structure:** kill the TabView; one screen — left rail + grid + tag filter + search + favorites; honest status machine (live/switching/paused + first-frame confirmation); EN strings; min window 1080.
- **I5 — Glass + brand polish:** bundled fonts, glassEffect materials, selection/switching micro-motion, static thumbnail pipeline for all 49.
- **I6 — System states:** extension approval sheet, engine download progress, permission/error states — all as stage sheets.
