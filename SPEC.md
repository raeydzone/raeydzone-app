# RaeydZone — Product Spec

A desktop production tracker for YouTube creators. Tracks video projects through a fixed
editing pipeline, owns the folder structure on disk, and enforces a daily work goal.

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
  thumbnail_studio/        only once the studio is used
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
- Rows in the file list carry a small preview button beside the Show-in-Explorer one:
  images open in a popup viewer, GIFs play in the same popup (closing it stops them), and
  audio plays in place — the button shows a live indicator that turns into a stop button
  on hover. Only one audio file plays at a time
- A failed move leaves the source untouched

### Thumbnail

Lives at `<project>/thumbnail.<ext>`. Setting a new one deletes any existing
`thumbnail.*` first, so there is exactly one. Previewed in the detail page and as the
card image in the list. Preview URLs are cache-busted by mtime.

Images are served through a custom `raeydzone://` protocol registered in main, scoped to
paths inside the root folder. No `file://`, no disabled web security.

### Thumbnail Studio

**Create Thumbnail** on a video's detail page — or **Create thumbnail** on a stream card —
opens a full-window studio for that project. It
is a layered editor — image, text and shape layers with position, size, rotation, flip,
opacity, blend mode, outline, drop shadow, outer glow, colour tint and adjustments
(brightness, contrast, saturation, hue, blur) — that a person and Claude drive through the
**same operations**. Anything Claude can do on the canvas the person can do from the tools,
layers panel and inspector, and the other way round.

The brief goes in the chat panel: a message, any attached images (picked, dropped or pasted;
**copied** into the studio, never moved), and a **Versions** slider (1–6). Each version is
its own Claude session working on its own canvas from the same brief, told to differ in
layout and accents. Every change lands on the canvas as it happens and is listed in that
version's chat, and the layer Claude just touched flashes, so the work is visible step by
step rather than only as a result. Messages sent while Claude works steer it; **Stop**
interrupts it. Versions are never hidden by starting new ones: the strip under the canvas and
the version menu in the chat header both switch to any version and its chat, and **New
versions** only changes what the composer sends. A finished version can be refined by chat or by hand, duplicated, or applied:
**Apply as thumbnail** renders it at 1280×720 and fills the video's thumbnail slot
(PNG, or JPEG if the PNG would pass YouTube's 2 MB limit). Claude's first message names the
project and whether it is a video or a livestream, so the design fits what it is for.

**Claude** is the user's own Claude Code CLI run in the background with their subscription
(`claude -p` with streaming JSON in and out, no built-in tools, the user's settings files not
loaded). The canvas reaches it as an MCP server that main serves on `127.0.0.1` behind a
per-run token; main forwards each tool call to the renderer, which executes it against the
document and replies. Any `ANTHROPIC_API_KEY` is removed from the child environment so usage
never silently moves to API billing. Sessions idle for 15 minutes are ended and resumed by id
on the next message. Model and **effort** (low → max — higher effort spends more of the plan)
belong to each version, not to the app: the picker in the chat header changes the version being
viewed, and while composing new versions it sets what they start with (Opus 5.5 at medium the
first time, then whatever was last chosen in that studio). A changed choice restarts an idle
session on the same conversation.

**OpenRouter** carries every image-model operation — there are no local models:

- *Generate image* creates an asset, optionally from reference images — attachments, single
  layers or the whole current canvas — and on GPT Image models with a transparent background;
  it can also be placed and cut out
- *Generative fill* repaints a boxed region of the composite from a prompt; the result lands
  as a new feathered image layer, so it stays editable and removable
- *Smart cut-out* asks the model for a black-and-white matte of the subject (optionally
  inside a box) and applies it as the layer's mask on the **original** pixels — the model
  never repaints the person. Masks are then refined by hand or by Claude with a lasso of
  anchor points, a brush, feather, invert and reset

Every call goes through OpenRouter's Images API with the source images as
`input_references`, capped at what the chosen model accepts. Each studio picks a model **per
task** from its header — generate, generative fill, cut-out — out of GPT Image 2.5 Sunburst
(highest quality) and Flare (fast), Grok Imagine Quality and 2.0, and Nano Banana 2.1, Pro and
2. Defaults: Sunburst for generating, Nano Banana 2.1 for fills and cut-outs. Inputs are padded
to the nearest aspect ratio the chosen model supports so mattes stay aligned. The key is one
generic OpenRouter key, stored with Electron `safeStorage` and only ever sent to
openrouter.ai.

Studio data lives in `<project>/thumbnail_studio/` (the video or stream folder): `studio.json` (versions, layers, chat)
and `assets/` (attachments, generated images, masks). Unreferenced assets are pruned when the
studio opens. Undo history is per version and in memory only.

Text layers can use any font installed on the PC, discovered with Chromium's Local Font
Access API together with the weights each family really has (a requested weight snaps to the
nearest real face, so there is no synthetic bold). Seven display fonts are bundled for a
consistent look on any machine: Montserrat, Anton, Bebas Neue, Oswald, Archivo Black, Luckiest
Guy and Bangers. The picker is searchable and previews each family in its own face; Claude gets
the same list through `list_fonts`.

Dropdowns cap their height to the space left in the window and keep a margin from its edges,
so none can spill past the frame.

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

### Archiving

Finished projects eat disk long after they are useful. A video becomes an **archive
candidate** once all six steps are done and the *last* of those timestamps is older than
the configured age (default 30 days).

Archiving sends the project's `footage/` and `assets/` folders and its base video to the
**Recycle Bin**, then recreates the two folders empty. Everything else survives: the
database row, the thumbnail, the six step timestamps, the Premiere project and the log.
The card and detail page still open normally, marked `archived` with the date.

The bin is deliberate: a wrong archive is recoverable. It also means the disk space is not
actually returned until the bin is emptied, and the UI says so rather than claiming bytes
were freed.

Settings carries a switch (**off** by default — the operation is destructive) and the age in
days. When on, a sweep runs 15 seconds after launch and every 24 hours after. Settings
also shows how much a sweep would reclaim right now, and an **Archive now** button. A
single completed video can be archived by hand from its detail page.

---

## 3. Streams

Lighter than videos. Name, thumbnail, scheduled datetime, and a single
**Streamed / Not yet** state. No pipeline.

```
Streams/<Stream Name>/
  thumbnail.<ext>
  <dropped files land here directly>
```

Same thumbnail rules, including the Thumbnail Studio. No `footage/` or `assets/` split and no `.prproj` — streams carry
little enough that a flat folder is the right shape. Dropped files go straight into the
stream folder.

The scheduled time fires a native desktop notification. Missed reminders (app was closed)
surface once on next launch rather than being lost.

---

## 3b. Tools

A tab of small utilities. **Each tool pops out into its own always-on-top window**, so the
sound recorder, the screen recorder and the screenshot tool can sit in different places —
or on different monitors — while Premiere is in front.

**Audio recorder.** Captures Windows loopback — whatever the desktop is currently playing
— so a sound can be grabbed without hunting down a download. The source defaults to the
current Windows output and is selectable, since virtual cables and interfaces are common.
A level control (100% by default) applies before capture, and a live waveform confirms
signal is arriving.

Audio is captured as raw PCM and written as **WAV**, not WebM/Opus, because Premiere does
not reliably import the latter. A finished take can be previewed, named, and saved
straight into a chosen project's `assets/`.

**Screen recorder.** Captures a screen, a single window, or a box drawn over the desktop,
with desktop audio on the same track. **Draw box…** opens a transparent overlay on
every connected monitor; dragging picks the area, Esc cancels, and choosing a box also
selects that monitor as the source. Region capture composites through a canvas,
scaling by the monitor's real-pixels-to-DIP ratio so display scaling does not shift the
crop.

Sound uses the same source list as the sound recorder — desktop loopback by default, any
input device, or **Silent** — plus a **Mute** that works mid-recording by disabling the
track rather than dropping it. Frame rate is 24/30/60.

**Captured audio is always requested raw**: echo cancellation, noise suppression and
automatic gain off, stereo asked for explicitly. Left at its defaults Chromium treats
captured audio as a voice call and returns a processed mono downmix, which on desktop audio
is audible as a hollow, pumping copy of the original.

The container is chosen at runtime — MP4 when Chromium can mux it, WebM otherwise — and
the footer names which one you are about to get. Clips preview inline, then save into a
project's `assets/` like sound takes do.

Once a box is set, thin red **corner markers** identify it on the desktop until the box
is cleared. Closing the tool, a renderer crash or reload, or app shutdown removes the
guide directly from the main process, so it cannot keep the app running by itself.
The guide is click-through and never reaches the recording: the window is marked excluded
from screen capture, and its markers are drawn just *outside* the recorded rectangle,
so even if that exclusion fails they are not inside the crop.

**Screenshot.** The same framing as the screen recorder, for a single still: a screen, a
window, or a box drawn over the desktop. **Draw box…** opens the same overlay, worded for
capture, and choosing a box selects that monitor as the source. The crop scales by the
monitor's real-pixels-to-DIP ratio exactly as the recorder's does, so the saved image is at
the monitor's native resolution, not its scaled one.

**PNG** or **JPG**, and an optional **delay** (3, 5 or 10 seconds, counted down in the
footer) for shots that need a menu open or the app out of the way. The result previews
inline with its pixel dimensions and file size, then either **Copy** — to the Windows
clipboard, always as PNG, since that is the only image type Chromium will write — or a
name and a project, saving into that project's `assets/` like clips and sound takes do.

Unlike the recorder, the screenshot tool leaves no guide on the desktop: the shot is
instant, so there is nothing to outline between choosing the box and taking it.

The tool windows are frameless and always-on-top, so the way to keep one out of a capture
is to drag it onto a second monitor. The app does not hide itself while recording. The
region overlay is destroyed rather than closed the instant a box is committed, so its
outline never sits over the recording it was used to frame.

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
- **Move time…** gives minutes worked today to an earlier day that fell short of the goal
  (e.g. yesterday 28m + today 22m, goal 50m → yesterday 50m, today 0m). The dialog lists
  short days, defaults the amount to what closes the gap, and previews both totals before
  anything changes. Only today can be the source, it needs the timer stopped, and it is
  logged as `timer.move`.
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
| **Settings** | Grouped into Library (root folder, rescan), Projects (Premiere template, archiving), Daily goal, AI connections (Claude account, OpenRouter key — models are chosen in the studio) and App (updates) |

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
