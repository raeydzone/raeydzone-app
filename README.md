<div align="center">

<img src="assets/brand/mascot.png" width="130" alt="RaeydZone">

# RaeydZone

**A control room for the YouTube grind.**

Tracks every video through a fixed production pipeline, owns the folder structure on
disk, and holds you to an hour a day.

<img src="https://img.shields.io/badge/platform-Windows-0a0a0a?style=flat-square&labelColor=0a0a0a&color=e11d21" alt="Windows">
<img src="https://img.shields.io/badge/Electron-35-0a0a0a?style=flat-square&labelColor=0a0a0a&color=e11d21" alt="Electron 35">
<img src="https://img.shields.io/badge/React-19-0a0a0a?style=flat-square&labelColor=0a0a0a&color=e11d21" alt="React 19">
<img src="https://img.shields.io/badge/SQLite-built--in-0a0a0a?style=flat-square&labelColor=0a0a0a&color=e11d21" alt="SQLite">

</div>

---

## What it does

Not a video editor. Not an uploader. It manages **folders, progress, and time** — the
three things that quietly rot when you make videos every week.

| | |
|---|---|
| **Videos** | Create a project, get a folder. Six pipeline steps, checkable in any order, each stamped with when you finished it. |
| **Drop to file** | Drag anything onto a project. Video files land in `footage/`, everything else in `assets/`. Files are **moved**, not copied — nothing is left behind in Downloads. |
| **Premiere** | Every new project copies your blank `template.prproj`, named to match. One button launches it. |
| **Thumbnails** | One slot per project. Drop a new image and it replaces the old one. Previewed everywhere. |
| **Streams** | Lighter than videos — name, thumbnail, a scheduled time that fires a desktop notification, and a streamed/not-yet flag. |
| **Timer** | Start, stop, resume — the day accumulates. Hit 1:00:00 and the bar fills. Thirty days of history, hoverable. |
| **Log** | Every state change, grouped by day, filterable. Per-project activity on each video too. |

## The pipeline

```
1  Recording footage
2  Base editing
3  Effects / memes
4  Short
5  Thumbnail
6  Uploaded
```

Displayed in order, completed in any order — because the thumbnail often lands before
the effects do. Each check stores its own timestamp; unchecking clears it and logs the
reversal.

## Folder layout

One root folder holds everything. It defaults to `~/Documents/RaeydZone` and is
changeable at any time.

```
RaeydZone/
├── .raeydzone/
│   ├── raeydzone.db        SQLite — projects, log, timer history
│   └── template.prproj     your blank Premiere project
├── Videos/
│   └── <Video Name>/
│       ├── <Video Name>.prproj
│       ├── raw_base_video.mp4
│       ├── thumbnail.png
│       ├── footage/
│       └── assets/
└── Streams/
    └── <Stream Name>/
        └── thumbnail.png
```

The database lives inside the root, so moving or syncing the folder moves everything as
one unit. **Rescan** in Settings rebuilds from whatever is actually on disk — the
recovery path if the folder is ever edited by hand.

## Design

Black surfaces, one red accent, borrowed from the mascot's eyes. Every colour, spacing
step, radius, and animation duration is a CSS custom property in one theme file; a raw
hex in a component is a bug. Nothing snaps — everything transitions in 120–200 ms.

## Stack

- **Electron 35** — frameless window, custom titlebar, `contextIsolation` on
- **React 19 + TypeScript** — strict, no `any`
- **node:sqlite** — SQLite built into Node 22, zero native modules to compile
- **Radix UI** — accessible primitives, unstyled, painted by us
- **Motion** — every transition
- **electron-vite** + **electron-builder**

All filesystem work happens in the main process, with every path validated to sit inside
the root before anything is written, moved, or deleted.

## Building

```bash
npm install
npm run dev
```

```bash
npm run build
```

Produces `dist/RaeydZone Setup <version>.exe`.

> **Windows Developer Mode must be on** (Settings → System → For developers). Without it
> electron-builder cannot extract its code-signing cache — it contains macOS symlinks,
> and Windows blocks symlink creation otherwise. The failure looks like
> `Cannot create symbolic link ... libcrypto.dylib`.

## Updates

The app checks GitHub Releases on launch and every six hours. When a new version is
downloaded, an **Update** button appears above the daily progress bar in the sidebar;
clicking it restarts into the new version.

To ship one: bump `version` in `package.json`, then

```bash
npx electron-builder --win --publish always
```

with `GH_TOKEN` set to a token that can write releases.

> Because this repository is private, the installed app also needs a read token to fetch
> releases. Either make a separate public repo for releases, or set `GH_TOKEN` in the
> app's environment. Shipping a token inside the binary works but puts it in every copy.

## Conventions

- Comments are capped at **5% of lines** and explain *why*, never *what*
- Timestamps always render as `DD, Month YYYY HH:MM` — `23, August 2026 14:30`
- No hardcoded user paths, ever; the root resolves from `app.getPath('home')`
- OneDrive folders are rejected as roots — footage does not belong in a sync engine

<div align="center">

<sub>Built for one person. Kept simple on purpose.</sub>

</div>
