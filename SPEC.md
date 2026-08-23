# RaeydZone — Product Spec

A personal control room for the YouTube grind. Tracks video projects through a fixed
production pipeline, owns the folder structure on disk, and enforces a daily work goal.

Not a video editor. Not a publisher. It manages **folders, progress, and time**.

---

## 1. The synced root

Everything lives under one root folder, default `<Documents>/RaeydZone`.

**The username is never hardcoded.** Resolution order:

1. `settings.rootPath` if set and still exists
2. `path.join(app.getPath('home'), 'Documents', 'RaeydZone')`
3. First run, or root missing: a setup screen shows that path with
   **Use this** / **Browse…**

**Never `app.getPath('documents')`.** It returns Windows' *redirected* Documents, which
lands inside OneDrive. OneDrive paths are not valid roots — a root chosen by picker that
sits inside a OneDrive tree is rejected with an explanation, not merely warned about. The
profile path is derived from `home`, never typed.

The setup screen also warns if the chosen root sits on a removable drive.

Settings always offers **Change root folder…**. Changing it re-points the app; it never
moves files.

```
RaeydZone/
  .raeydzone/
    db.json            source of truth
    db.backup.json     last good copy, rewritten on each successful save
    template.prproj    blank Premiere project, copied per video
  Videos/
    <Video Name>/
  Streams/
    <Stream Name>/
```

`db.json` is written atomically (temp file → rename). It lives inside the root so the
whole thing moves and syncs as one unit.

**Free space** is shown in Settings next to the root, since footage fills a disk fast.

**Rescan** (Settings): walks `Videos/` and `Streams/`, adds folders the DB doesn't
know about, and flags DB entries whose folder has vanished. Recovery path if the DB is
ever lost or the folder is edited by hand.

---

## 2. Video projects

### Creation

Type a name → folder is created immediately.

```
Videos/<Video Name>/
  <Video Name>.prproj      copy of template.prproj
  raw_base_video.mp4       the base video file, one slot
  thumbnail.<ext>          only once set
  footage/
  assets/
```

Folder name = the typed name, sanitized: strip `< > : " / \ | ? *`, collapse whitespace,
trim trailing dots and spaces (Windows rejects them), reject reserved names
(`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`). Collision → append ` (2)`.

The display name in the app keeps the original typed text; the folder name is the
sanitized one. Both stored.

### Renaming

Renames the folder and the `.prproj` alongside it. If either is locked (Premiere open),
the rename fails loudly and nothing changes — no half-renamed state.

### Premiere Pro

`.prproj` is gzipped XML, so we do not synthesize one. Instead: the user saves one blank
project from Premiere 2025 as `.raeydzone/template.prproj`, and creation copies + renames
it. Version-correct by construction.

**Launch project** button (Premiere icon) → `shell.openPath(prprojPath)`. Disabled with a
tooltip if the file is missing or no template was ever installed.

### Base video

`raw_base_video.mp4` sits at the project root and behaves like the thumbnail: one slot,
its own drop target on the detail page, and setting a new one replaces the old. Dropped
onto that slot the file is moved and renamed to `raw_base_video.mp4` regardless of what it
was called.

The detail page shows whether the slot is filled, and **Reveal in Explorer** next to it.

### Dropping files

Everything outside the two dedicated slots lands on the page's general drop target. Files
are **moved, never copied**.

| Extension | Destination |
|---|---|
| `.mp4 .mkv .mov .avi .webm .m4v .mts .m2ts` | `footage/` |
| everything else | `assets/` |

- Real paths come from `webUtils.getPathForFile()` in the preload
- `fs.rename`, falling back to copy + unlink on `EXDEV` (cross-drive moves)
- Name collision in the destination → ` (2)`
- Each file produces a toast and a log entry naming its destination
- A failed move leaves the source untouched

### Thumbnail

Lives at `<project>/thumbnail.<ext>`. Setting a new one deletes any existing
`thumbnail.*` first, so there is exactly one. Previewed in the detail page and as the
card image in the list. Preview URLs are cache-busted by mtime.

Images are served through a custom `raeydzone://` protocol registered in main, scoped to
paths inside the root folder. No `file://`, no disabled web security.

### Progress

Six steps, fixed order in the UI, **checkable in any order**:

1. Recording footage
2. Base editing
3. Effects / memes / edits
4. Short
5. Thumbnail
6. Uploaded

Each check stores its own completion timestamp. Unchecking clears it and logs the
reversal. A video is **completed** when all six are done.

The list shows six pips per card so state reads at a glance, and has a **Show completed**
toggle — off by default.

---

## 3. Streams

Lighter than videos. Name, thumbnail, scheduled datetime, and a single
**Streamed / Not yet** state. No pipeline.

```
Streams/<Stream Name>/
  thumbnail.<ext>
  <dropped files land here directly>
```

Same thumbnail rules. No `footage/` or `assets/` split and no `.prproj` — streams carry
little enough that a flat folder is the right shape. Dropped files go straight into the
stream folder.

The scheduled time fires a native desktop notification. Missed reminders (app was closed)
surface once on next launch rather than being lost.

---

## 4. Timer

One timer, one daily goal: **60 minutes**.

- **Start** begins a session. **Stop** ends it and shows that session's duration.
- Starting again the same day **continues the day's total** — sessions accumulate, nothing
  resets mid-day.
- Today's total drives a progress bar that hits 100% at exactly 1:00:00. Past that it
  stays full and shows the overflow (`1:24 · +24m`).
- A session crossing midnight is split at the boundary so each day gets its real minutes.
- A running session writes a heartbeat every 30s. If the app dies, the next launch
  recovers the session up to the last heartbeat instead of losing it.
- History: a bar chart of the last 30 days with a goal line at 1h. Bars that hit goal are
  accent red; misses are muted.

---

## 5. Log

Every state change is logged: video created / renamed, step checked or unchecked, file
moved (with source and destination), thumbnail set or replaced, Premiere project opened,
stream created / marked streamed, timer started / stopped, root folder changed.

Each entry: timestamp, type, target, human-readable message.

Shown per-video on the detail page (filtered to that video) and in full on a global
**Log** page with type and date filters.

---

## 6. Navigation

| Page | Contents |
|---|---|
| **Dashboard** | Today's timer ring + goal, videos in progress with step pips, next stream, recent log |
| **Videos** | Grid of project cards, Show-completed toggle, New video |
| **Streams** | Upcoming and past |
| **Timer** | Big clock, start/stop, 30-day chart |
| **Log** | Global history |
| **Settings** | Root folder, Premiere template, daily goal, rescan |

---

## 7. Formatting

All displayed timestamps: **`DD, Month YYYY HH:MM`** → `23, August 2026 14:30`.
24-hour, local system time. Stored as ISO 8601 UTC, formatted on display only.

Durations: `1:24:07` when running, `1h 24m` when summarized.

---

## 8. Brand

The hooded red-eyed cat is the app's face — window icon, taskbar `.ico`, sidebar mark,
and empty states. Assets belong in `assets/brand/`:

- `mascot.png` — transparent cutout (from `avatarpfp_transparent.png`), for in-app use
- `icon.ico` — multi-size Windows icon built from the mascot
- `wordmark.png` — the RAEYD banner lockup, for the about screen
- `mascot-framed.png` — the flat-background avatar, fallback only

Red is the mascot's eyes: vivid, saturated, used only where attention belongs.
