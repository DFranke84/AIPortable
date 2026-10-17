# AIPortable - Setup in detail

A fresh copy of AIPortable is just the app's code, its editable lists in `data\` and the setup scripts.
Everything else - the app's runtime, Ollama, Kiwix, voice input, the map tool, models and maps - is downloaded
by **one double-click**. For what the app does and how it fits with the other downloads, see
[README.md](README.md).

## What you need

- **Windows 10/11, 64-bit.**
- **Internet access** for the one-time setup. Not needed afterwards, except to download more models, maps or
  archives.
- **Disk space:** about 3 GB for the app and its tools, plus the models (2 - 20 GB each) and maps (40 MB to
  26 GB each) you pick.

## Step 1 - Put the folder where you want it

Put the whole `AIPortable` folder where it should live: a folder on any drive, or a USB drive. If you also use
the Research library, put both in one parent folder, side by side (see README). Chats, models, maps and
documents are all stored inside the app folder under `data\`, so it stays self-contained and movable. Avoid
OneDrive-synced folders.

## Step 2 - Double-click `Setup-Windows.bat`

It asks two questions first, then runs on its own:

1. **Which chat model to download.** It detects your graphics card's memory and shows the matching model list
   (4K / 8K / 12K / 24K / 32K). Type a number - the first *General* model is a good choice - or press Enter to
   skip.
2. **Which offline map regions to download** (from `data\maps-catalog.json`): from small areas (under 100 MB)
   up to whole continents. Type numbers, or press Enter to skip.

Then it installs, without admin rights and without changing anything outside this folder:

| What | Where | Size |
|---|---|---|
| Node.js (portable, only used for installing) | `runtime\node` | ~30 MB |
| Electron and the app's other parts | `node_modules` | ~300 MB |
| Ollama (runs the AI models) | `resources\ollama\win` | ~1.5 GB |
| Kiwix (Wikipedia viewer and archive search in chat) | `resources\kiwix\win` | ~15 MB |
| Voice input (whisper.cpp + English model) | `resources\whisper\win` | ~150 MB |
| Map download tool (pmtiles) | `resources\maps\tools` | ~18 MB |
| Search model `nomic-embed-text` (for searching your documents) | `data\models` | 274 MB |
| The chat model and maps you picked | `data\models`, `data\maps` | your choice |

At the end it checks that everything is in place and offers to start the app.

It is safe to run again any time - it skips whatever is already there, so a second run just fills in anything
missing.

**Optional flags** (add them after the file name in a command prompt), e.g.
`Setup-Windows.bat -Model qwen2.5:3b -Maps world`:

| Flag | Effect |
|---|---|
| `-Model name` / `-SkipModels` | Download this chat model without asking / no models at all |
| `-Maps a,b` / `-SkipMaps` | Download these map regions without asking / no maps |
| `-NoVoice` | Leave out voice input |
| `-SkipOllama` | Use a system-wide Ollama instead of the portable copy |
| `-UseWinget` | Install Node.js system-wide with winget instead of the portable copy |
| `-NoLaunch` | Don't offer to start the app at the end |

## Step 3 - Start the app

Double-click **`AIPortable.vbs`** (no console window), or **`Start-AIPortable-With-Console.bat`** to see the
log.

## First steps in the app

1. Pick the model in the drop-down at the top and press **Load model**, then ask something.
2. Add a few of your own documents in 🛠️ Tools/Settings → Library, then turn on 📚 in the chat.
3. If you use the Research library: accept the **Sync now** offer (or Tools/Settings → Library → *Sync Research
   Library*).
4. Optional: download a Wikipedia archive (Tools/Settings → Wikipedia) and a map region (Tools/Settings → Maps).

## Later: more models, maps and archives

- **Models:** Tools/Settings → Models.
- **Maps:** Tools/Settings → Maps → *Download maps* - the same list as setup. To add a region of your own, add
  an entry to `data\maps-catalog.json`:

  ```json
  "my-area": { "name": "My area", "group": "Local", "bbox": "-115.4,47.6,-113.2,49.05", "size": "40 MB",
               "description": "Full street detail for my area." }
  ```

  `bbox` is min longitude, min latitude, max longitude, max latitude - draw a box on
  https://boundingbox.klokantech.com/ and copy the "CSV" value. Or run `resources\maps\DOWNLOAD-MAPS.ps1`.
- **Wikipedia and other .zim archives:** Tools/Settings → Wikipedia (download list), or point Tools/Settings →
  Library → *ZIM archive folders* at folders you already have. More archives: https://library.kiwix.org.

## Troubleshooting

- **"Setup isn't finished yet" when starting the app** - run `Setup-Windows.bat` (again); it fills in whatever
  is missing.
- **Antivirus quarantines `ollama.exe`** - a known false alarm with Ollama's Windows build. Setup downloads it
  from the official `github.com/ollama/ollama` releases; add an exclusion if needed.
- **npm fails on a native module** - install "Desktop development with C++" from the Visual Studio Build Tools,
  then run setup again.
- **Model downloads are slow or fill a USB drive** - Tools/Settings → Models → *Choose folder on this PC* moves
  model storage to a faster local drive.
- **Another Ollama is already running** (its tray app or a service) - quit it and start AIPortable again so it
  can run its own copy. Otherwise models go to that other Ollama's folder, not `data\models` (Tools/Settings →
  System shows which one is in use).
- **A map region fails to download** - Protomaps keeps only about a week of daily world builds online; setup
  and the app try the last three days automatically. Try again later if all three fail.

## macOS / Linux

The setup script is Windows-only. Elsewhere: `npm install`, install Ollama from https://ollama.com/download
(or place portable builds as described in the `PLACE_BINARY_HERE.txt` files under `resources\`), then
`npm start`.

---

## For the technically minded

### How it is built

An Electron app. `src\main\main.js` runs the window and wires the services together; `src\main\preload.js` is
the only bridge to the page (`contextIsolation` on, `nodeIntegration` off); `src\main\db.js` holds the SQLite
set-up (chats, messages, library documents, full-text index, embeddings). Services in `src\main\services\`:
`ollama.js` / `lmstudio.js` (chat backends), `modelCatalog.js` (model lists and downloads), `library.js` +
`chunking.js` (your documents), `researchSync.js` (indexes the Research library in place), `zimSearch.js`
(archive search for 🗃️), `mapDownloader.js`, `mobileServer.js`, `voiceInput.js`. The page is
`src\renderer\index.html` / `renderer.js` / `styles.css`.

**Portable paths.** Everything at runtime lives in `data\` beside the app; the drive letter is resolved at
start-up, never stored. When the app starts Ollama itself it sets `OLLAMA_MODELS` to `data\models` (or the
per-PC folder chosen in Tools/Settings → Models); an Ollama that was already running keeps its own folder.
Per-PC choices are kept in the Windows user profile (`%APPDATA%\local-ai-starter\host-settings.json`).

**A fully self-contained build.** `npm run pack:win` produces `dist\win-unpacked\LocalAI.exe` with everything
it needs (no Node.js on the target PC); `AIPortable.vbs` prefers it when present. Build on the OS you target -
the compiled `better-sqlite3` module in `node_modules` only works on the platform it was built on.

### Searching your documents

Documents are split into chunks of ~500 - 800 characters (whole paragraphs, with a short overlap) and indexed
twice: keyword (SQLite FTS5) and meaning (`nomic-embed-text` embeddings, compared by cosine similarity). The two
rankings are blended (reciprocal-rank fusion); with 📚 on, the best chunks, grouped by document, are added to
that one message only - they are not stored in the chat. Semantic search compares against every chunk, which
is fine for a personal library; scanned PDFs without a text layer are never found.

### Archive search (🗃️)

`zimSearch.js` runs a second `kiwix-serve` on 127.0.0.1:8099 with every selected archive and uses each archive's
own full-text index (archives without one are searched by title). *Quick*: the model turns the question into
keywords, one search runs, and the best paragraphs of the top 4 articles become context. *Thorough* (models
with tool calling): the model searches and opens articles itself through two tools, up to 4 rounds and 5
articles. The choice is saved per chat.

### The editable lists in `data\`

- **Model lists** - `4K-models-catalog.json` … `32K-models-catalog.json`, one per graphics-card memory size:

  ```json
  {
    "categories": { "General": 1, "Reasoning": 2, "Vision": 3 },
    "models": {
      "qwen2.5:3b": { "name": "Core", "size": "1.9 GB", "category": "General",
                      "description": "Best knowledge-per-parameter at this size" }
    }
  }
  ```

  The key must be the exact name `ollama pull` expects. Category numbers set the sort order (lower first).
  Files are re-read every time the Models tab opens; a syntax error shows as a warning under that file.
- **Maps** - `maps-catalog.json` (shape shown above).
- **Wikipedia / archives** - `wikipedia-catalog.json`: each entry has `name`, `category`, `size`,
  `articleCount`, `description` and the download `url`. Kiwix's catalog
  (`https://library.kiwix.org/catalog/v2/entries?lang=eng&q=<search>`) lists the address and size of everything
  it hosts.

### Security notes

- The page never gets direct Node access - only what `preload.js` exposes; a Content-Security-Policy limits
  scripts to the app itself.
- The Wikipedia viewer's `<webview>` runs in its own isolated process without the app's bridge.
- **Mobile sync** has no password and accepts any device on the network - fine on a trusted home network, never
  expose it beyond your router.
- Kiwix and the archive search listen on 127.0.0.1 only.
