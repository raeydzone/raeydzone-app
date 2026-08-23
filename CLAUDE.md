# RaeydZone

A desktop production tracker for YouTube creators. Tracks video projects through an
editing pipeline, owns their folder structure on disk, and enforces a daily work goal.

Ships as a single Windows 11 executable with a GUI — no CLI, no server, no accounts, no
telemetry. Single-user by design: skip multi-user and i18n concerns unless asked. It
should run correctly on any Windows 11 machine, so never assume a specific user, drive,
or folder layout.

Product detail lives in [SPEC.md](SPEC.md). This file is the rules.

## Stack

Electron + React 19 + TypeScript, bundled with electron-vite.

- **UI primitives:** Radix UI for anything with focus/keyboard behaviour — dialogs, context menus, dropdowns, tooltips, sliders. Unstyled; we paint them. Never hand-roll these.
- **Animation:** Motion (`motion/react`). No CSS keyframe soup for anything interactive.
- **Styling:** plain CSS via CSS Modules. No Tailwind, no CSS-in-JS.
- **State:** React state and context until it genuinely hurts. No Redux.

## Hard rules

**Never hardcode a user path or username.** No `C:\Users\<name>\...` anywhere, ever. The
synced root resolves from settings, else `path.join(app.getPath('home'), 'Documents',
'RaeydZone')`, and is always overridable via a folder picker. Never use
`app.getPath('documents')` — it resolves into OneDrive. OneDrive paths are not valid
roots. See SPEC §1. Same for anything user-specific.

**All timestamps display as `DD, Month YYYY HH:MM`** — `23, August 2026 14:30`. 24-hour,
local system time. Store ISO 8601 UTC; format only at the render layer, via one shared
helper. Never format inline.

**Filesystem writes go through main, never the renderer.** Every path is validated to sit
inside the root before anything is written, moved, or deleted.

**Moves are moves.** `fs.rename`, falling back to copy + unlink only on `EXDEV`. A failed
move must leave the source file untouched.

## Comments

Hard cap: **5% of lines**. Over that, the change is rejected.

Comments explain *why*, never *what*. No restating the signature, no section banners, no
TODO noise.

```ts
// bad
// This function loads the config file and returns it
function loadConfig() { ... }

// good
// Electron caches this path before app.ready, so resolve it lazily
function loadConfig() { ... }
```

If a comment is needed to explain what code does, rename things instead.

## Design

Black background, red accent. That is the identity — keep it consistent everywhere.

- Base: near-black surfaces (`#0a0a0a` – `#141414`), layered by elevation, not by borders alone
- Accent: the mascot's eye red, used sparingly — active states, focus, key actions, subtle glows
- Text: off-white primary, muted grey secondary. Never pure `#fff` on pure `#000`
- Motion: everything transitions. 120–200ms, ease-out. Nothing snaps
- Custom frameless window with our own titlebar — no native Windows chrome
- Modern and quiet: generous spacing, soft radii, no heavy borders, no gradients-for-the-sake-of-it

Every color, space, radius, and duration is a CSS custom property in
`src/renderer/styles/theme.css`. Components read variables only — a raw hex or px value in
a `.module.css` is a bug.

Brand assets live in `assets/brand/`. The hooded
red-eyed cat is the app's face — window icon, sidebar mark, empty states.

## Code

- Keep `main`, `preload`, and `renderer` cleanly separated. `contextIsolation: true`, `nodeIntegration: false`
- All main↔renderer traffic goes through explicit IPC channels exposed in the preload — no ad-hoc `ipcRenderer` in the renderer
- Small files, small functions. Prefer deleting code over adding flags
- No dependency unless it earns its place

## Build

`npm run dev` for development, `npm run build` to produce the distributable `.exe` via
electron-builder. The packaged executable is the deliverable — if it doesn't run
standalone, it isn't done.

Packaging needs Windows **Developer Mode** on (Settings → System → For developers).
Without it, electron-builder's `winCodeSign` cache fails to extract — it contains macOS
symlinks, and creating symlinks otherwise requires admin. The error is
`Cannot create symbolic link ... libcrypto.dylib`.
