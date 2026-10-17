# Local AI Starter

An Electron app that talks to a local [Ollama](https://ollama.com) instance, built as a
clean, re-creatable port of the subsystems in a DracherAI-style local-AI-assistant app —
minus the USB licensing/DRM layer, obfuscation, and forced fullscreen/frameless window,
which were left out on purpose (see the note at the bottom).

## What's included

```
src/
  main/
    main.js                 # window, app lifecycle, IPC handlers — wires all services together
    preload.js               # the only bridge between renderer and Node (contextIsolation on)
    db.js                    # SQLite setup: chats, messages, library docs, FTS, embeddings
    services/
      ollama.js               # OllamaManager — chat streaming, model list, embeddings, abort
      modelCatalog.js          # ModelDownloader — curated model catalog + pull progress
      mobileServer.js          # MobileServer — LAN HTTP server so a phone can chat with the app
      voiceInput.js            # VoiceInput — spawns whisper.cpp server, transcribes audio
      library.js                # Library — document upload + keyword (FTS5) + semantic search
  renderer/
    index.html / styles.css / renderer.js   # chat UI + a Tools panel (Models / Library / Mobile / System)
```

## Feature parity — what ported over, and what didn't

| Original subsystem | Status | Notes |
|---|---|---|
| `OllamaManager` (chat, models) | ✅ ported | `services/ollama.js` |
| `ModelDownloader` (catalog + pull progress) | ✅ ported, extended | `services/modelCatalog.js` — the catalog is split across `data/<tier>-models-catalog.json` (one plain JSON file per GPU VRAM tier: 4K/8K/12K/24K/32K), re-read on every refresh; edit any tier's file directly to add/remove/reclassify entries, see "Model catalog" below |
| `MobileServer` (LAN chat sync) | ✅ ported | `services/mobileServer.js` — same SSE streaming approach, served from `/`, not stored/synced beyond the live session |
| `VoiceInput` (whisper.cpp) | ✅ ported | `services/voiceInput.js` — needs a bundled whisper.cpp server binary + model to actually work (see below); degrades cleanly to "unavailable" without one |
| Library / RAG search | ✅ ported, extended | `services/library.js` — SQLite FTS5 + Ollama-embedding cosine search, combined via reciprocal-rank fusion. Accepts `.txt`/`.md` **and now `.pdf`/`.docx`/`.doc`** (text extraction via `pdfjs-dist`, `mammoth`, and — since `.doc` covers two unrelated real-world formats, genuine binary Word *and* RTF saved with a `.doc` extension — `word-extractor`/`rtf-parser` depending on which one a given file's header actually is). **Wired into chat**: the 📚 toggle in the composer retrieves matching library content and injects it as context before each send — see "Library context in chat" below. |
| Offline map viewer | ✅ ported | `services in main.js` (`maptiles://` protocol) + MapLibre GL/pmtiles.js in the renderer — see "Maps tab" below |
| Chat export | ✅ ported | `chat:export` — saves a chat to a `.txt` file via a native save dialog |
| System info panel | ✅ ported | CPU/RAM/platform, simplified (no disk-free/GPU-name probing) |
| Clipboard write | ✅ ported | exposed via `window.localAI.clipboardWrite` if you want a "copy message" button |
| Custom window minimize/maximize/close + frameless chrome | ❌ not ported (deliberately) | this app uses the OS's normal window frame — see note below |
| `LicenseManager` (USB dongle DRM, heartbeat lock) | ❌ not ported | this was a licensing-enforcement mechanism for a specific commercial product, not something to re-create for a personal project |
| `javascript-obfuscator` build step | ❌ not ported | there's no reason to obfuscate your own code from yourself |
| Auto-updater (`.internal/updates/*.zip` hot-swap) | ❌ not ported | update mechanics are specific to how you plan to distribute the app; `electron-builder` has its own auto-update story if/when you need one |

## Prerequisites

1. **Node.js** 22.12+ and npm.
2. **Ollama** — a portable copy is already bundled at `resources/ollama/win/ollama.exe`
   (the official `ollama-windows-amd64.zip`, checksum-verified against GitHub's
   release), so **nothing needs to be installed system-wide on Windows** — the app
   finds and runs that binary itself (`findBundledOllama()` in `main.js`), falling
   back to a system-installed `ollama` on PATH only if the bundled one is missing.
   macOS/Linux don't have a bundled binary yet — see "Bundling everything" below to
   add one, or just install Ollama normally on those platforms for now.
3. At least one chat model and (optionally) one embedding-capable model pulled —
   easiest from inside the app itself (Tools → Models), or from a terminal once
   the app (or a portable `ollama serve`) is running:
   ```bash
   ollama pull llama3.2:1b
   ollama pull nomic-embed-text   # only needed for library semantic search
   ```
   Library search works with keyword (FTS) matching alone if you skip the embedding model —
   semantic search just silently contributes nothing to the ranking.

## Run it

```bash
npm install
npm start
```

## Running portably (USB drive / a fixed folder like `E:\AIPortable`)

This app is built to run entirely out of its own folder — no install step, no
writing to your OS user profile. Everything it needs at runtime (chat history,
uploaded library docs, imported map files, **and pulled model weights**) lives
in a `data/` folder created right next to the app itself, not in
`AppData`/`Library`/`.config`. Copy the whole folder to a USB drive, plug it
into a different machine, and it picks up exactly where it left off —
including if the drive gets a different letter (`D:\` here, `E:\` there),
which the app resolves at startup rather than hardcoding.

Model weights land in `data/models` because the app sets `OLLAMA_MODELS` to
that folder when *it* launches the Ollama process (see `ensureOllamaRunning()`
in `main.js`). That only works for the instance the app starts itself —
**if Ollama is already running when the app opens** (its own tray app, a
system service, one you started from a terminal), that instance answers
first, keeps using wherever it's already configured to store models (usually
`~/.ollama/models`), and the app has no way to redirect it. The System tab
shows which case you're in and a warning if models currently aren't landing
in the portable folder; quit the standalone Ollama instance and relaunch this
app to have it take over and manage Ollama itself.

### Two ways to run it portably

**Mode A — run from source (what you get after `npm install`).**
This is the simplest path and what `AIPortable.vbs`/`Start-AIPortable.bat`
default to. The whole project folder — including `node_modules` — is the
portable unit. Needs Node.js installed on whatever machine you run it from
(Electron itself is bundled inside `node_modules`, so you don't need it
separately, but the folder does need to have been through `npm install`).

**Mode B — a packaged, fully self-contained build.**
Run one of:
```bash
npm run pack:win     # produces dist\win-unpacked\LocalAI.exe + everything it needs
npm run pack:mac
npm run pack:linux
```
on the OS you're targeting (packaging for Windows only reliably works when
run *on* Windows — see the cross-platform note below). The resulting
`dist/<platform>-unpacked/` folder is a complete, self-contained app: no
Node.js, no npm, nothing needs to be installed on the machine you run it on.
This is the better target for "hand this USB drive to someone else."

### Setting up `E:\AIPortable`

1. Copy this entire project folder to `E:\AIPortable` (or the USB drive).
2. Open a command prompt *in that folder* (`cd /d E:\AIPortable`) and run
   `npm install` once — this needs internet access, and it also
   automatically rebuilds `better-sqlite3`'s native module against
   Electron's bundled Node.js (not your system Node — Electron ships its own,
   with a different ABI; `npm install`'s postinstall step handles this via
   `electron-builder install-app-deps`, so you don't need to do it by hand).
3. Double-click `AIPortable.vbs` (silent, no console window) or
   `Start-AIPortable.bat` (shows a console, if you'd rather see what's
   running) to launch.
4. Optionally, run `npm run pack:win` afterward to also produce a
   fully self-contained `dist\win-unpacked\` build — both launcher scripts
   automatically prefer that if it exists, falling back to source mode
   otherwise.

### Bundling everything so no separate installs are needed on the target machine

`resources/ollama/win/` already has a full portable Ollama (v0.34.0) checked
into this copy of the project — `ollama.exe` plus its `lib/ollama/` runner
DLLs (CPU backends for several x86 microarchitectures, plus CUDA and Vulkan
GPU acceleration). It's ~2 GB unpacked, which is why "copy the whole folder"
is a multi-GB operation, but it's also why a machine that has never touched
Ollama before can run this app immediately — no installer, no admin rights,
nothing added to PATH or the registry. For mac/Linux, or to refresh the
Windows copy to a newer Ollama release, fill in the matching folder the same
way:

```
resources/
  ollama/win/ollama.exe + lib/     # already present — v0.34.0, from
                                    # github.com/ollama/ollama/releases
  ollama/mac/ollama
  ollama/linux/ollama
  whisper/win/whisper-server.exe   # optional — voice input
  whisper/win/model.bin
```
The mac/Linux folders still have a `PLACE_BINARY_HERE.txt` explaining exactly
what goes there and where to get it (same idea: download that platform's zip/
tgz from the GitHub releases page and extract it in whole, not just the
binary, since the runner DLLs/shared libs need to sit alongside it). `whisper/`
is unchanged. Maps (`.pmtiles` files) live in `data/maps/` instead, alongside
your other portable data — see the Maps tab section below — since they're
large per-user downloads rather than something to bundle into every build. `extraResources` in `package.json`'s `build` config
copies all of `resources/` into a packaged build automatically — nothing else
to configure.

### Things worth knowing before you rely on this

- **Native modules are platform/architecture-specific.** `node_modules`
  built by running `npm install` on a Windows x64 machine will not work if
  that same folder is later run on macOS, Linux, or Windows on ARM — the
  compiled `better-sqlite3` binary won't load. If you need the same USB
  drive to work across different operating systems, build **Mode B**
  packages separately on each target OS (`pack:win` on Windows, `pack:mac`
  on macOS, `pack:linux` on Linux) rather than relying on one shared
  `node_modules` folder.
- **Packaging for Windows generally needs to happen on Windows** (or Linux
  with Wine set up, which isn't configured here) — `electron-builder` can
  cross-compile in some configurations, but the reliable path is building on
  the OS you're targeting. This project's tooling doesn't attempt Wine-based
  cross-building.
- **`data/` is where your state lives.** If you're duplicating the app
  folder rather than moving it, decide up front whether you want the copy to
  share history with the original or start fresh — copy `data/` along with
  everything else to bring history with you, or delete it in the copy to
  start clean (it's recreated empty on first launch either way).
- **This was built and reviewed without being run end-to-end** in the
  environment that assembled it (no ability to install native npm packages
  there — see the note in the last reply in this build's conversation for
  specifics on what was and wasn't verified). The path-resolution logic
  itself was tested directly (dev mode, packaged mode, and a simulated
  drive-letter change all resolve `data/`/`resources/` correctly), but the
  full install → launch → chat flow needs a real first run on your machine
  to confirm.

## Using the new features

- **Models tab** (Tools → Models): pull any catalog model with progress; installed models
  are marked. The catalog is split by GPU VRAM tier (4K/8K/12K/24K/32K) — pick which
  tier(s) apply to your card, not code — see "Model catalog" below.
- **Library tab**: upload `.txt`/`.md`/`.pdf`/`.docx`/`.doc` files, then search —
  results blend keyword and semantic matching. PDF text is extracted with
  `pdfjs-dist` (scanned/image-only PDFs will upload but come back with no
  searchable text — you'll get a heads-up when that happens); `.docx` goes
  through `mammoth`. `.doc` is trickier than it looks: the extension covers
  two unrelated formats in the wild — genuine pre-2007 binary Word (an OLE
  compound document) and plain RTF saved with a `.doc` extension (common;
  WordPad and some "export as .doc" flows actually write RTF). The app
  sniffs the real format from the file's header rather than trusting the
  extension, and hands it to `word-extractor` or `rtf-parser` accordingly.

### Library context in chat

Click the 📚 button in the composer (next to the mic) to turn on library-backed
context. When it's on, every message you send:

1. Runs `library.search()` against your uploaded docs (keyword + semantic, same
   ranking as the Library tab's manual search)
2. Takes the top 3 matches, pulls up to ~1,200 characters of each from the
   already-extracted text, and prepends them as a system message to that one
   API call to Ollama
3. Shows "Using: *title, title*" above the reply so you can see what it drew from

This context is **not** saved to chat history — only your actual message and the
model's reply are stored, so it doesn't bloat storage or get "stale" on later
turns; it's rebuilt fresh from your current library every time you send with the
toggle on. If nothing in your library matches well, no context gets injected and
the model just answers normally.

### ZIM archives in chat

Click the 🗃️ button in the composer to pick which `.zim` archives (Wikipedia,
MedlinePlus, StackExchange sites, …) the AI searches before answering. Archives
are listed from the Wikipedia download folder, the Research library's
`_sources\zim` folder, and the folder of the viewer's current file. Nothing is
copied or embedded: `services/zimSearch.js` runs a second `kiwix-serve`
(127.0.0.1:8099, every archive at once) and uses each archive's own full-text
index. Archives without one are searched by article title only.

- **Quick** (default, any model): the chat model turns the question into
  "main topic | keywords", one search runs, and the best paragraphs of the top
  4 articles are added as context.
- **Thorough** (tool-calling models — Ollama `tools` capability, LM Studio
  `trained_for_tool_use`): the model searches and opens articles itself via two
  tools (`search_zims`, `open_article`), searching again with other words when
  results are poor, for up to 4 rounds and 5 articles. The real answer is then
  streamed from what it opened. Other models fall back to Quick.

The steps taken show above the reply, and each source opens in the Wikipedia
viewer. The choice is saved per chat (`chats.zim_settings`) and as the default
for new chats.

### Chunking

Documents are split into ~500–800 character chunks before indexing — not one
vector per whole document. `services/chunking.js` packs whole paragraphs together
up to a target size, splits any paragraph that's already oversized on sentence
boundaries, and stitches a short overlap from each chunk onto the front of the
next one so a fact sitting right at a chunk boundary doesn't get orphaned.

Both keyword (FTS5) and semantic (embedding) search now operate at the chunk
level — each chunk is its own row in `library_chunks` / `library_chunks_fts` /
`library_chunk_embeddings`, independently searchable. `buildContext()` groups
matching chunks back by their parent document (ordered by position in the doc)
before injecting them into chat, so you still get "Using: *Employee Handbook*"
rather than "Using: *Employee Handbook, part 4*, *Employee Handbook, part 4*".

Docs uploaded before this existed get chunked automatically on next app start
(`library.backfillChunks()` runs once at startup, re-chunking straight from the
already-extracted text — no need to re-upload anything).

Known limitations, worth knowing before you rely on this:
- **No re-ranking beyond RRF** — the fusion is a simple positional blend, not a
  learned re-ranker. Fine for a personal library, not tuned for precision at scale.
- **Silent on extraction failures** — a doc with no extracted text (e.g. a
  scanned PDF) just won't ever surface in search or context; nothing errors,
  it just never matches.
- **Brute-force chunk scan** — semantic search compares the query against every
  chunk's vector on every search. Fine up to a few thousand chunks; you'd want
  a real vector index (sqlite-vec, or an external vector DB) well past that.
- **Chunk boundaries aren't semantically aware** — splitting is paragraph/sentence
  based, not topic-based, so a chunk can still span two loosely related ideas if
  they happen to sit in the same paragraph.

- **Mobile sync tab**: click Start, then open the printed `http://<lan-ip>:4600` URL on
  your phone (same Wi-Fi network). It's unauthenticated on your LAN by design, matching
  the original — add a pairing code or token in `mobileServer.js` before trusting this
  on a shared network.
- **Voice input** (mic button in the composer): needs a whisper.cpp server binary +
  model bundled at `resources/whisper/<platform>/whisper-server[.exe]` and
  `resources/whisper/<platform>/model.bin`. Prebuilt binaries and models:
  https://github.com/ggml-org/whisper.cpp — grab a `ggml-base.en.bin`-style model and
  build/download the `whisper-server` example for your platform. Without it, the mic
  button just tells you it's unavailable rather than failing silently.
- **Export**: the ↓ button in the top bar saves the open chat as a `.txt` file.
- **Attachments** (📁 button in the composer, or just drop a file onto it):
  attach an image, PDF, Word doc, or text file to a single message. Each one
  shows as a removable chip in a labeled "Attached:" band above the composer —
  a thumbnail for images, a type icon (📄 PDF, 📝 Word, 📃 text) for everything
  else — click its × to drop it before sending. Images are sent to the model's
  vision input (only for models Ollama reports as multimodal, e.g. `llava`,
  `moondream`, `qwen2.5vl` — the app checks via `/api/show` and blocks the send
  with a message if the current model can't see images); PDFs/Word/text files
  have their text extracted and folded into your message instead, so they work
  with any model. Unlike the Library tab, these aren't saved or searchable
  later — they're for this one message only.
- **Stop generation**: the Send button turns into a red Stop button the moment a
  reply starts streaming — click it to cut the model off mid-response. Whatever
  was already streamed is kept (marked "⏹ Stopped") and saved to the chat rather
  than discarded; if nothing had streamed back yet, the empty reply bubble is
  removed instead of leaving a blank one behind.
- **Model load indicator**: the small dot next to the status text reflects whether
  the selected model is actually resident in Ollama's memory right now (via
  `/api/ps`), not just installed — grey means it'll need to load on your next
  message (which can take a while for larger models), green means it's already
  warm. While a reply is generating, a bouncing-dots placeholder fills the message
  bubble until the first token streams back, covering that same load time.
- **Exit** (button under the chat list): gracefully shuts the app down — asks
  Ollama to unload every loaded model (freeing its RAM/VRAM) before stopping the
  Ollama process and closing the app, rather than just killing everything outright.
  Closing the window (or Alt+F4/Cmd+Q) does the same graceful shutdown.
- **Model storage location** (Tools → Models): models default to the portable
  `data/models` folder, but running off a USB stick makes every pull/inference
  slower than the host PC's own drive. This panel lets you point Ollama at a
  folder on the host machine instead ("Choose folder on this PC…"), or switch
  back ("Use portable folder") — switching restarts the app's managed Ollama
  process so the change takes effect immediately, no app restart needed. That
  choice is remembered **per machine** (stored in the OS user-data folder, not
  in `data/`), so plugging the same drive into a different PC starts back at
  the portable default rather than carrying over a path that PC doesn't have.
  Two **Sync** buttons copy already-downloaded models between the portable and
  PC folders in either direction (merge-copy — skips files already identical
  at the destination), so you can, e.g., pull once on a fast PC and sync the
  result onto the portable drive for use elsewhere, or vice versa.
- **Model catalog** (Tools → Models): the pull-able list is split across five
  plain JSON files, one per GPU VRAM tier — `data/4K-models-catalog.json`,
  `8K-`, `12K-`, `24K-`, `32K-models-catalog.json` — each curated with models
  sized to fit comfortably in that much VRAM. The old single
  `data/models-catalog.json` this app used before tiers existed has been
  removed.

  A **GPU size** row of buttons at the top of the Models tab lets you pick
  which tier(s) apply to your card — select just one, or several to mix sizes
  together. Whatever's selected is combined into one list: categories merge,
  and models are sorted by category weight and then by size within each
  category, so entries from different tiers interleave naturally rather than
  showing as separate blocks. The choice is remembered **per machine** (in the
  OS user-data folder, same as the model storage location setting below) since
  VRAM is a property of this PC's GPU, not something that should follow the
  portable drive to a different computer. With no choice made yet, every tier
  is selected by default. Below the picker, each selected tier's file gets its
  own path + 📂 (open in Explorer/Finder) row — the app re-reads every
  selected tier's file every time the Models tab (or the main model dropdown)
  refreshes, no restart needed to see edits.

  Shape of a single tier's file (all five share it):
  ```json
  {
    "categories": {
      "General": 1,
      "Reasoning": 2,
      "Vision": 3
    },
    "models": {
      "qwen2.5:3b": {
        "name": "Core",
        "size": "1.9 GB",
        "category": "General",
        "description": "Best knowledge-per-parameter at this size"
      }
    }
  }
  ```
  A model's key **must** be the exact name/tag `ollama pull <key>` expects
  (check `ollama list` if unsure — namespace/model:tag, case-sensitive); `name`,
  `size`, and `description` are just display text. `category` both groups
  entries under a heading in the Models tab and prefixes them in the main chat
  dropdown (`General — qwen2.5:3b`); `categories` gives each one a sort
  **weight** — lower shows first, in both the Models tab and the dropdown. A
  category left out of `categories` (or a model with no `category` at all,
  e.g. an embedding model pulled outside the catalog) sorts after every
  weighted one. Ties — equal weight, or no weight — fall back to alphabetical,
  applied locally within just the tied group: first by category name, then by
  model id. Add, remove, re-tag, or re-weight entries freely — installed-status
  detection (`ollama:list-models` against `/api/tags`) works off the live
  Ollama connection, not these files, so it stays accurate regardless of
  what's in the catalog. A JSON syntax error in one tier's file shows as a
  warning under that tier's path (its models are left out of the combined
  list until it's fixed) rather than breaking the whole tab. A catalog file
  written before category weights existed (the old flat
  `{ "model:tag": {...} }` shape, no `categories`/`models` wrapper) is
  migrated in memory automatically the first time it's read — categories keep
  whatever names were already in use and get sequential weights matching
  their original display order, so nothing is lost or reordered by upgrading.

  If the exact same model tag is curated into two different selected tiers
  (rare, but happens when a smaller/larger model is deliberately reused across
  tiers), the larger tier's name/category/description wins in the combined
  list — it's still the same one downloadable model either way, just shown
  under one entry instead of two.
- **Layout**: the chat sidebar and the main chat pane are both header/scrolling-
  middle/fixed-footer layouts — the chat list scrolls on its own while Tools/Exit
  stay put at the bottom of the sidebar, and the top bar (status + model picker)
  stays put while only the messages scroll. A "↑ Top" button floats over the
  bottom of the message view once you've scrolled down a bit, for jumping back
  to the start of a long conversation.
- **Dialogs**: every alert/confirm in the app is a themed in-page modal
  (`showAppAlert`/`showAppConfirm` in `renderer.js`), not the native
  `alert()`/`confirm()` — Electron can't reposition those (they land wherever
  the OS defaults to, not necessarily over this window), so anything the app
  needs to tell you is guaranteed centered in the app's own window instead.
  Enter accepts, Escape dismisses.

### Maps tab

Renders vector maps from `.pmtiles` archives using MapLibre GL JS + the `pmtiles`
library (byte-range reads — only the tiles you're looking at get fetched/loaded,
not the whole archive).

- **Import local .pmtiles…**: copies a `.pmtiles` file you choose into the app's
  userData folder. Once imported, it's served by a custom `maptiles://` protocol
  registered in `main.js` (with proper `Range` header support, the same pattern
  the original app used for its own asset/PDF protocol handlers) — fully offline,
  no network involved.
- **Getting your own `.pmtiles` file**: download a region extract from
  https://protomaps.com/downloads (pick a city/state/country — file sizes range
  from tens of MB to a few GB depending on area and zoom levels), or build one
  yourself with the `pmtiles` CLI (https://docs.protomaps.com/pmtiles/cli):
  ```bash
  pmtiles extract https://build.protomaps.com/<date>.pmtiles my-area.pmtiles \
    --bbox=<minLon>,<minLat>,<maxLon>,<maxLat>
  ```
  Then use "Import local .pmtiles…" in the Maps tab.

**Requires `npm install` to have populated `src/renderer/vendor/`** with the
MapLibre GL and pmtiles browser bundles (done automatically via the `postinstall`
script — see `scripts/copy-vendor.js`). If those files are missing for any reason,
the Maps tab shows an "unavailable" message instead of failing — rerun
`npm install` to fix it.

### Wikipedia

Browses a local Wikipedia (or any other) `.zim` archive fully offline, with
images and full-text search — independent of chat and the Library tab. This is
a standalone viewer, not something the AI reads from; nothing you browse here
is fed into chat unless you separately import it via the Library tab.

Split across two places, same pattern as the Library feature (Tools tab for
management, a dedicated sidebar view for actually using it):

- **🌍 Wikipedia** (sidebar button, next to 🌐 Translate): the full-size
  viewer — swaps the main window's content the same way 📖 Reference Library
  and 🌐 Translate do, rather than living cramped inside the Tools side-panel.
  Click it again (or the ← back button) to return to chat.
- **Tools → Wikipedia**: management — storage location, the catalog of
  downloadable archives, and the list of what's already downloaded or
  imported. Nothing to browse here, just what to have available.

- **How it works**: the app bundles `kiwix-serve` (from
  [kiwix-tools](https://github.com/kiwix/kiwix-tools)) and manages it as a
  second local process, the same way it manages Ollama — spawned on demand,
  polled until ready, and stopped on quit. Whichever `.zim` is currently
  "active" is loaded straight into an embedded `<webview>` (in the 🌍
  Wikipedia view) pointed at kiwix-serve's own viewer and search UI (Xapian
  full-text search, already built into the ZIM file — no custom search code
  needed).
- **Catalog downloads** (Tools → Wikipedia → Catalog): a curated list of
  ready-to-download archives — general reference, medical, practical/
  self-reliance, travel, language, and Q&A — pulled straight from kiwix's
  official mirrors with a progress bar, no browser needed. The list comes
  from `data/wikipedia-catalog.json`, a plain JSON file in the same spirit as
  the Models tab's tier catalogs: hand-editable to add, remove, or re-tag
  entries, and re-read live with no restart. Shape of an entry:
  ```json
  {
    "zims": {
      "wikem_en_all_nopic.zim": {
        "name": "WikEM — Emergency Medicine",
        "category": "Medical",
        "size": "347 MB",
        "articleCount": 107952,
        "description": "...",
        "url": "https://lb.download.kiwix.org/zim/other/wikem_en_all_nopic_2026-07.zim"
      }
    }
  }
  ```
  Find more archives to add at https://library.kiwix.org — its catalog API
  (`https://library.kiwix.org/catalog/v2/entries?lang=eng&q=<search>`) lists
  the direct download URL and size for everything it hosts.
- **Text-only vs. with images**: most ZIMs come in a `nopic` (text-only) and a
  `maxi` (full images) flavor of the same content — the catalog lists both
  where they exist (e.g. two Wikipedia-Simple-English entries, one ~990 MB
  text-only and one ~3.5 GB with images), so pick per-title based on how much
  the pictures matter to you vs. the extra disk/download size. A few sources
  (iFixit, Appropedia) only ever ship one combined version that already
  includes images; Wiktionary, being a dictionary, effectively has none.
- **Download storage location**: downloaded archives default to the portable
  `data/wikipedia` folder, but running off a USB stick makes a 50 GB Wikipedia
  download slower than the host PC's own drive. Same "Choose folder on this
  PC…" / "Use portable folder" pattern as the Models tab's storage setting,
  remembered **per machine** — unlike the model-folder switch, this one never
  needs a server restart, since it only changes where new downloads land and
  where the "Downloaded" list is scanned from, not what's currently loaded in
  the viewer.
- **Loading an archive**: the "Downloaded" list (Tools → Wikipedia) shows
  every `.zim` in the active storage folder — click **Load** on one to point
  kiwix-serve at it, then open **🌍 Wikipedia** to browse it. **Import a .zim
  from elsewhere…** does the same for a file you already have outside that
  folder (e.g. a huge archive kept on a separate drive) — its path is
  remembered **per machine** rather than being copied in, since these files
  run from under a gigabyte to 100+ GB, far larger than anything else this
  app copies into `data/`.

**Requires a `kiwix-serve` binary in `resources/kiwix/<platform>/`** — already
bundled for Windows; macOS/Linux need a binary placed there manually (see
`resources/kiwix/mac/PLACE_BINARY_HERE.txt` /
`resources/kiwix/linux/PLACE_BINARY_HERE.txt`) from
https://download.kiwix.org/release/kiwix-tools/. Without it, the Wikipedia tab
shows an "unavailable" message instead of failing.

## On the window chrome

This starter intentionally keeps the **normal OS window frame** — no `frame: false`,
no `fullscreen: true`, no custom minimize/maximize/close buttons wired through IPC.
That was the one piece of the original app's UI I didn't carry over on request; it's a
few lines to add back in `main.js`'s `createWindow()` if you want a fully custom
titlebar later, but you'd also need to build the HTML/CSS buttons and wire them to
`ipcMain.handle('window-minimize', ...)`-style handlers yourself — happy to help with
that separately if you want it.

## Security notes worth keeping

- `contextIsolation: true`, `nodeIntegration: false` — the renderer never gets direct
  Node access, only what's explicitly exposed in `preload.js`.
- A `Content-Security-Policy` meta tag restricts scripts to same-origin.
- The mobile sync server has CORS wide open and no auth, matching the original — fine
  on a trusted home network, not something to expose past your router.
- IPC handlers in `main.js` are the *only* privileged surface; keep new capabilities
  there deliberate and narrow.
- The Wikipedia tab's `<webview>` (rendering locally-served ZIM content) runs in its
  own process/security context, isolated from the main renderer's CSP and preload
  bridge — it has no access to `window.localAI` or Node.
