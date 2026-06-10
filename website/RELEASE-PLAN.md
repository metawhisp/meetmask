# MEETAMASK — Pre-MVP Release Plan

> Built from the Codex pre-MVP review (2026-06-04). Goal: a **safe, honest, public
> MVP** = landing + real static gallery + real app download + legal/privacy. Fake
> auth/upload/browser-try are CUT from MVP; user uploads (Supabase) are deferred
> until a constrained mask format + sandbox + signed app-manifest exist.
>
> Workflow (owner's rule): each iteration → review with Codex → show owner → next.
> Each iteration is small, shippable, and has explicit acceptance + verification.

## MVP definition (smallest honest)
Landing page → real static gallery (47 real masks) → **real Download** of the
notarized app → honest privacy/terms/support. No accounts, no uploads, no
localhost "try in browser". The gallery funnels to Download ("these ship in the app").

## What MVP is NOT
No sign-in, no upload, no Supabase, no user masks, no browser demo embed. Those are
post-MVP and gated on the security model (mask package format + sandbox + signed
app-manifest).

---

## Iteration R1 — Honest, download-first surface  (P0 · solo · code-only)
Merge "copy honesty" + "re-scope download-first". The page must not state anything
unverifiable, and the primary action is Download.

**index.html**
- Delete competitive claim: "This is the part Snap Camera could never do." (`index.html:147`).
- Hidden-window copy (`:101`, `:139`, `:147`): keep the *architectural* fact (renders
  off-screen, so hiding the window doesn't pause it) but remove the *measured*
  guarantee wording ("full frame rate / never freezes") until owner-confirmed (R4).
- FPS/res (`:137`, `:150`): "30 fps" → "designed for 720p/30 fps" (or tie to evidence in R4).
  Keep "452 KB" (real: notarized host zip). Keep "1280×720" (real render size).
- Logo strip (`:118`) caption → honest: "Works with any app that accepts a virtual
  camera" (don't imply per-app integration/testing).
- "Bring your own mask" feature cell (`:151`) promises upload→app → remove/soften
  (contradicts the security plan; uploads are post-MVP, browser-sandbox only).
- Download = primary CTA. Until R3 wires a real URL, button copy is honest
  ("Download for macOS"), toast stays "coming soon".

**gallery.html / gallery.js**
- Remove Sign in / Upload CTAs + both modals from the MVP surface (keep code in a
  branch/comment, not wired).
- Lead copy (`gallery.html:60`): drop "Sign in to upload your own — curated
  submissions go live to everyone." → showcase framing ("Every mask below ships in
  the app.").
- Tile click: stop opening `http://localhost:8800/` (`gallery.js:17,71`). For MVP make
  tiles an honest showcase that funnels to Download ("Get the app to use this"), no
  dead localhost link.

**Acceptance:** every on-page claim is verifiable or softened; no fake auth/upload;
no dead localhost flow; Download is the primary CTA on landing + gallery.
**Verify:** enumerate every claim line → mark proven/softened; grep for `localhost`,
`Sign in`, `Upload`, `Snap Camera`, `30 fps` → none remain in a misleading context;
headless screenshot of both pages.

## Iteration R2 — Hygiene: structure + security + a11y + pipeline  (P1/P2 · solo · code-only)
**Structure/dead code**
- Delete dead `meetamask-site/app.js` (old wardrobe, `--accent` from the retired design,
  unreferenced).
- Rename `catalog.json` → `site-catalog.json` (reserve `app-manifest.json` for the
  signed app boundary). Update `gallery.js` fetch + `build-catalog.mjs` output.
- Stop shipping the build intermediate: `build-catalog.mjs` deletes
  `assets/masks/_catalog.json` after producing the catalog (or writes it to /tmp).

**Security**
- XSS: no `innerHTML` of dynamic text. Add an `esc()` escape helper (or build DOM
  nodes) for catalog fields AND any user-supplied string (`gallery.js:29-46,66,107-110`).
  Trusted-today, but must be safe before any shared data and before Supabase.

**Accessibility**
- Tiles → real button/link semantics (role+tabindex+Enter/Space activation).
- Modals (if kept anywhere) → `role="dialog"` + `aria-modal` + focus trap + restore
  focus + accessible name. Toast → `aria-live="polite"`.

**Capture pipeline (china_web/tools)**
- Derive expected count from the registry/catalog (drop hard-coded `EXPECT=47`).
- Exit nonzero on partial capture; don't emit catalog entries for failed tiles.
- Delete stale `_catalog.json`; document the esm.sh + `Math.random()` "capture once,
  commit the frozen art" caveat in `tools/README.md` (acceptable for static tiles).

**Acceptance:** no dead/stale shipped files; no `innerHTML` of dynamic data; gallery
keyboard-operable; pipeline fails loud on partial. **Verify:** grep `app.js`/`_catalog.json`
refs gone; a11y smoke (tab through, Enter activates); run pipeline with forced partial → nonzero.

## Iteration R3 — Real download path  (P0 · NEEDS OWNER: hosting/CDN)
- Decide host for the notarized **host app zip** (site Download target) and a **CDN**
  for `engine.zip` (`EngineInstaller.sourceURL`).
- Wire site Download CTAs → host zip URL; set the app's engine URL.
- **Verify on a clean machine:** Download → open → Gatekeeper OK (notarized) →
  first-launch engine install from CDN → camera works.
**Owner input:** where to host (e.g., the user's CDN/bucket/domain).

## Iteration R4 — Hidden-window live test  (P0 · NEEDS OWNER: runs it)
- Owner launches the Finder-installed app, selects **MEETAMASK Camera** in Zoom/Meet,
  wears a mask with a real face, hides the app (⌘H), Meet full-screen → confirm it
  keeps streaming. Record it.
- Update landing copy to the measured truth (then the hidden-window claim is honest).
**Owner input:** run + record the test.

## Iteration R5 — Legal / privacy  (P0 · NEEDS OWNER: decisions/content)
- Privacy policy, Terms/EULA, Support contact, camera-permission + engine-download
  disclosure. Link in footer.
**Owner input:** entity name, contact, jurisdiction, data choices.

## Iteration R6 — Deploy MVP  (P0)
- Host the site (domain + static host), final clean-machine E2E (download→install→use),
  verify all links, no console errors, basic analytics if wanted.

---

## Deferred (post-MVP, gated on security) — NOT in MVP
- **F1** Constrained mask package format + browser sandbox/CSP policy + signed
  `app-manifest.json` (SHA-256, content-addressed). Owner masks only reach the app
  through this.
- **F2** Split `site-catalog.json` (content) vs `app-manifest.json` (signed authority).
- **F3** Supabase: accounts + upload→Storage + masks(status) + moderation. User masks
  run **only** in the browser sandbox; never auto-delivered to the native app.
- **F4** Moderation ops: abuse/takedown (DMCA), identity, rights, quotas, scanning, audit log.

## Risk/dependency notes
- R3/R4/R5 are P0 but need owner action/decisions → can run in parallel with R1/R2 (solo).
- The hidden-window promise (R4) is the core value prop; copy must not assert it as
  measured fact until R4 passes.
- Truthfulness rule (owner): no unverifiable claim ships. R1 enforces this on copy.

---

## Revision after Codex plan-verify (2026-06-04) — incorporated
- **R1 add — kill the demo block.** Remove the placeholder demo-video section
  (`index.html:122-131`) + its toast (`main.js:5`). A "your demo goes here" placeholder
  can't ship; restore only when the owner provides a real screencast.
- **R1 hidden-window — stricter.** Even "Hide the app — the mask keeps running"
  (`index.html:139`) IS the hidden-window claim. Keep it OUT of public copy until R4;
  phrase only as the architecture fact ("renders off-screen") with no keeps-running
  guarantee. Same for `:101`, `:147`.
- **R1 more copy lines.** `:138` "every mask reacts to your face and hands" →
  "face, hand & camera-reactive masks/filters" (many are pure filters). `:148`
  "Works everywhere" + named apps → soften like the logo strip. `:125` "No plugin" →
  "No meeting-app plugin".
- **R1 RECONCILE (P0 truthfulness).** Site shows 47 masks; the app bundles **30** of
  them (verified: `MEETOMASK/Masks/` has 32 dirs incl. `ar-dr-strange` + `meetamask-studio`
  specials; 30 are china_web effects). NOT in the app (17): ascii, pixelwarp, sobel,
  invert, caustics, fisheye, bleach, hexpixel, polar, linerain, crosshatch, plasma,
  scan, pixeldrift, shards, crt, feedback. → MUST NOT claim "every mask ships in the
  app". OWNER DECISION: (a) trim gallery to the 30 in-app, (b) keep 47 as a neutral
  collection with no per-mask in-app claim, (c) add the 17 to the app build (separate
  effort). Add a build-time check: `site-catalog` IDs ⊆ app mask set wherever "in the
  app" copy is used.
- **R2 XSS — stronger.** Prefer DOM construction + an image-path allow-list over an
  escape helper (must cover attributes/URLs, not just text).
- **R2 pipeline — atomic.** Capture into a temp/staging dir and atomically replace
  assets only on success (don't delete production previews before capture succeeds).
  Remove hard-coded `/Users/android/...` paths (args/env).
- **R2 dead code — delete, don't comment.** Remove fake auth/upload entirely (don't
  ship as comments). NOTE: no git repo here → stash the removed stub in a non-served
  `_deferred/` dir (or accept it's reconstructable from the session) instead of
  "recover from git".
- **R3 engine integrity (P0).** A CDN URL alone is insufficient for a native app
  pulling an executable engine → require an immutable versioned URL + SHA-256/signature
  verification in the app BEFORE first-launch install. Make download CTAs real
  `<a href>`, not JS-only buttons.
- **Verdict:** execute after these are folded in (done here).

---

## Iteration log
### IT-1 — App: all 47 masks ship (reconcile 47/30) — DONE (2026-06-04, build-verified)
Owner chose option (c): ADD the 17 missing effects to the app (not trim the site).
- Created 17 redirect masks `MEETOMASK/Masks/<slug>/index.html` (asciicam, pixelwarp,
  sobel, invert, caustics, fisheye, bleach, hexpixel, polar, linerain, crosshatch,
  plasma, scan, pixeldrift, shards, crt, feedback) — same proven pattern as
  `portalpull` (`location.replace("../../Prototype/index.html?engine=1&autostart=<EffectId>")`).
- Verified: all 17 autostart ids exist in the registry; reconcile **site 47 ↔ app 47**
  effect masks (none missing/extra; neutral≡posestages alias); **Release build SUCCEEDED**
  with **47 effect masks** bundled in the `.app` (folder-reference, no xcodegen).
- Open: live render spot-check of the 5 experimental masks (crt/feedback/pixeldrift/
  shards/scan) — owner eyeball; rebuild→re-notarize→re-package host+engine for
  distribution at R3/R6; app-gallery name cosmetics (`prettify(slug)` vs real titles);
  optional rename app folder `neutral`→`posestages`.
- Codex review of this iteration: P0 none — sound to keep.

### IT-2 — R1: honest, download-first surface + cut fakes — DONE (2026-06-04, Codex P0/P1 none)
- **index.html copy honesty:** removed "Snap Camera could never do"; ⌘H cell → "Renders
  off-screen" (no keeps-running/no-freeze/full-frame-rate); hero lead + step 3 dropped the
  hide-the-app claim; "30 fps to run" → "designed for … 30 fps"; step 2 → "face, hands, or
  the camera"; logo caption → "Use it in any app that accepts a virtual camera"; "Works
  everywhere" → "Works as a camera"; "Bring your own mask → go live to everyone" → "47 masks,
  ready to wear". Kept real "452 KB" + "1280×720". Removed placeholder demo-video block (+ its
  toast in main.js).
- **gallery cut fakes:** removed Sign in / Upload buttons + both modals (stashed in
  `_deferred/`); lead → "Every mask below ships in the app — all 47 of them" (TRUE post IT-1);
  nav Download button.
- **gallery.js rewrite:** static showcase only — no localStorage accounts, no localhost demo,
  no upload; `esc()` on every field + strict preview-path allow-list
  (`^assets/masks/[a-z0-9_.-]+\.webp$`); tabs `aria-pressed`; descriptive `alt`; non-interactive
  display cards (no clickable affordance). Fetches `site-catalog.json`.
- **structure:** `catalog.json` → `site-catalog.json` (gallery.js + build-catalog.mjs);
  deleted dead `app.js`; stopped shipping `_catalog.json` (build deletes the intermediate).
- **Verify:** no stale claims/flows in shipped files; site-catalog 200 (47 masks, all previews
  exist), old catalog.json 404; `node --check` clean; Codex review **P0/P1 none, keepable**.
- **Codex P2 closed now:** strict img allow-list; cards no longer look clickable
  (cursor/lift removed); comment + log typos fixed.
- **Deferred to R2 (hygiene):** remove stale modal/auth CSS from `styles.css` + dead tile CSS
  in `gallery.html`; capture-pipeline atomic staging + de-hardcode paths.
