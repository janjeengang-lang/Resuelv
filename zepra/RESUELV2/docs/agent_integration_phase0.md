# Phase 0 – Manifest audit & file inventory

## Nanobrowser manifest snapshot
- **Service worker**: `background.iife.js` runs as a module worker and drives the automation backend. [manifest.json]
- **Content script**: `content/index.iife.js` injected into all frames on every URL, giving DOM access everywhere. [manifest.json]
- **Permissions**: Requests `storage`, `scripting`, `tabs`, `activeTab`, `debugger`, `unlimitedStorage`, `webNavigation`, and `sidePanel` for deep automation control. [manifest.json]
- **Host permissions**: `<all_urls>` enabling cross-site DOM traversal and action execution. [manifest.json]
- **Side panel & options**: Dedicated `side-panel/index.html` and `options/index.html`, plus `web_accessible_resources` exposing permission pages, JS, CSS, and icons to in-page scripts. [manifest.json]

## Zepra manifest snapshot
- **Service worker**: `background.js` (non-module) handles Cerebras LLM requests, OCR, identity generation, and UI messaging. [manifest.json]
- **Content script**: `content.js` runs in all frames at `document_idle` for page augmentation and tool overlays. [manifest.json]
- **Permissions**: Includes `storage`, `activeTab`, `scripting`, `tabs`, `contextMenus`, `notifications`, clipboard read/write, `browsingData`, and `history`, but lacks Nanobrowser's `debugger`, `webNavigation`, `unlimitedStorage`, and `sidePanel`. [manifest.json]
- **Host permissions**: Whitelists multiple APIs plus `<all_urls>` for page instrumentation. [manifest.json]
- **Options UI**: Uses `options.html` via `options_ui` (embedded modal) rather than Nanobrowser's full-page `options_page`. [manifest.json]
- **Web accessible assets**: Limited to icons and media under `src/media`, so Nanobrowser's permission page/scripts are not yet exposed. [manifest.json]

## Potential conflicts & deltas to resolve
1. **Automation permissions**: Zepra is missing `debugger`, `webNavigation`, `unlimitedStorage`, and `sidePanel`—all required for Nanobrowser's automation patterns (DOM mirroring, action replay, side panel UI). Need to evaluate necessity and add selectively.
2. **Side panel availability**: Nanobrowser relies on the MV3 side panel; Zepra currently surfaces tools via popups/modals. Integration will require updating `manifest.json` and `background.js` to register a panel.
3. **Web-accessible resources**: Voice/permission flows from Nanobrowser expect blanket exposure of JS/CSS. Zepra will need explicit entries for imported modules (e.g., `permission/index.html`, automation bundles) to avoid 404s.
4. **Options architecture**: Nanobrowser's `options_page` is a standalone React view; Zepra's `options_ui` is simpler. Need a migration strategy (either embed Nanobrowser panels or recreate forms within existing options.)
5. **All-frames execution**: Both inject across frames, but Nanobrowser's script loads earlier (default `document_idle`). Confirm no race conditions when merging logic into Zepra's `content.js`.

## Working file inventory for next phases
- **From Nanobrowser**:
  - `buildDomTree.js` – DOM snapshot/highlight utility for survey parsing.
  - `background.iife.js` – contains action executors, LLM plumbing, and side panel messaging (needs de-minifying).
  - `content/index.iife.js` – orchestrates DOM capture and UI overlays (for reference when merging behaviors).
  - `side-panel/index.html` & bundled JS/CSS – baseline for agent control UI.
  - `options/index.html` bundle – source for API settings layout.
  - `permission/index.html` & `permission.js` – microphone access flow to reuse for voice commands.
- **Within Zepra**:
  - `background.js` – central hub to receive DOM trees, dispatch LLM plans, and execute actions.
  - `content.js` – entry point for injecting DOM scanners and agent overlays.
  - `options.html` / `options.js` – where Cerebras/OpenAI settings and agent toggles will surface.
  - `src/` (create `agent/` subdirectory) – location for planner, action executor, and shared config modules.
  - `docs/agent_integration_phase0.md` – this tracker for later reference in LLM prompts.

