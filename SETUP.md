# AIPortable — First-Time Setup

This is a **bare-basics copy** of AIPortable: source code, folder structure,
and setup scripts only. It deliberately does **not** include:

- Any downloaded model weights (`data/models` starts empty)
- Any offline map tiles (`resources/maps` and `data/maps` start empty)
- A local Ollama install (downloaded fresh by the setup script below)
- Any chat history or uploaded library documents

Everything above is either fetched by the setup script, downloaded from
inside the app itself on demand, or filled in by you later. Follow the steps
below in order to get a brand-new machine from "just this folder" to
"chatting with a local model."

## What you'll end up with

An Electron desktop app that talks to a local Ollama instance for AI chat —
fully offline once set up, no account, no cloud calls, no license key. See
[README.md](README.md) for the full feature list (Library/RAG search, offline
maps, voice input, mobile sync, etc).

## Prerequisites

- **Windows 10/11, 64-bit.** (macOS/Linux can run this too, but the
  automated `setup.ps1` script below is Windows-only — see the note at the
  bottom for other platforms.)
- **Internet access** for the one-time setup step below. Not needed again
  afterward except when you choose to pull a new model.
- **A few GB of free disk space** for the app itself and Ollama, plus
  however much you'll use for models you choose to download later (a small
  chat model is ~1-2 GB; bigger ones can be 10+ GB each).
- Not required in advance, but useful to know: if a native-module rebuild
  step ever fails during setup, installing "Desktop development with C++"
  from the Visual Studio Build Tools fixes it. Most machines won't need
  this.

## Step 1 — Put the folder where you want it

Copy this entire `AIPortable2` folder to wherever you want the app to live
permanently — a fixed folder like `E:\AIPortable`, or a USB/portable drive.
Everything the app needs at runtime (chat history, downloaded models,
imported maps, uploaded library docs) is stored inside this same folder
under `data\`, not scattered into your Windows user profile — so the whole
thing stays self-contained and movable.

## Step 2 — Run the setup script

Open the folder, go into `scripts`, and either:

- Right-click **`setup.ps1`** → **Run with PowerShell**, or
- Open a terminal in the project root and run:

```bash
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

This one script does everything needed to get the environment ready:

1. **Checks for Node.js** (22.12+). If it's missing and `winget` is available,
   it installs Node.js LTS automatically — you'll need to close and re-open
   your terminal afterward and run the script again so the newly-installed
   `node` is picked up on PATH. If `winget` isn't available, it prints a
   link to https://nodejs.org/ and stops so you can install it by hand.
2. **Runs `npm install`**, which pulls in Electron and every other
   dependency, copies the MapLibre/pmtiles map-viewer assets into
   `src/renderer/vendor/`, and rebuilds the `better-sqlite3` native module
   against Electron's bundled Node (this all happens automatically via
   existing `postinstall` wiring — nothing to do by hand). This step needs
   internet access and can take a few minutes.
3. **Downloads a portable copy of Ollama for Windows** directly from
   Ollama's GitHub releases and unpacks it into `resources\ollama\win\`.
   This means Ollama does **not** need to be installed system-wide — no
   admin rights, nothing added to PATH or the registry. The app finds and
   runs this bundled copy itself. (If you'd rather install Ollama the
   normal way instead, run the script with `-SkipOllama` and grab it from
   https://ollama.com/download.)
4. **Creates the empty runtime folders** (`data\models`, `data\library`,
   `data\maps`) if they don't already exist.

If anything fails partway through, the script prints what went wrong and how
to fix it — re-run it after fixing the issue; it's safe to run more than
once (it skips anything already done, e.g. it won't re-download Ollama if
it's already there).

## Step 3 — Launch the app

Double-click **`AIPortable.vbs`** (starts silently, no console window), or
**`Start-AIPortable-With-Console.bat`** if you'd rather see a console with
any log output.

The app window should open to an empty chat with no models installed yet —
that's expected.

## Step 4 — Get your first model

Open **Tools → Models** inside the app:

1. Pick the GPU size tier(s) that match your graphics card at the top of the
   tab (unsure? leave all selected — it just changes which curated list you
   see, not what you can run).
2. Click any model to pull it. A small chat model like `qwen2.5:3b` or
   `llama3.2:1b` is a good first pick — a couple of GB, fast to download,
   fast to respond.
3. Optionally also pull **`nomic-embed-text`** — this enables semantic
   (meaning-based) search in the Library tab, on top of plain keyword
   search which works without it.

Once a model finishes downloading, pick it from the model dropdown at the
top of the chat and start talking to it.

(You can also do this from a terminal instead of the UI, if you prefer —
with the app or a portable `ollama serve` running: `ollama pull qwen2.5:3b`.)

## Step 5 (optional) — Offline maps

The Maps tab works with zero setup (it'll just show "no map loaded" until
you add one). To add offline map tiles:

- See **[resources/maps/DOWNLOAD-MAPS.ps1](resources/maps/DOWNLOAD-MAPS.ps1)**
  — a placeholder script with the exact commands and links for downloading
  or extracting `.pmtiles` region files. Fill in the regions you want and
  run it, or just follow the instructions in it to grab a file manually from
  https://protomaps.com/downloads.
- A portable copy of the `pmtiles` CLI (needed for extracting a custom
  region yourself, i.e. Option B in that script) is already bundled as a zip
  at `resources\maps\tools\go-pmtiles_1.31.2_Windows_x86_64.zip`. Extract
  `pmtiles.exe` from it into `resources\maps\tools\pmtiles.exe` before
  running `DOWNLOAD-MAPS.ps1` — either do this by hand (right-click the zip
  → "Extract All..." → extract straight into `resources\maps\tools\`, not
  into a new subfolder), or just run `DOWNLOAD-MAPS.ps1` itself, which
  extracts it automatically the first time if `pmtiles.exe` isn't there yet.
- Once you have a `.pmtiles` file, use **Maps tab → "Import local
  .pmtiles..."** inside the app to load it (it gets copied into the app's
  data folder and served fully offline from then on).

## Step 6 (optional) — Voice input

The mic button works with zero setup too (it just tells you it's
unavailable). To enable it, you need a whisper.cpp server build — see
**[resources/whisper/win/PLACE_BINARY_HERE.txt](resources/whisper/win/PLACE_BINARY_HERE.txt)**
for exactly what to download and where it goes.

## Troubleshooting

- **"Setup isn't finished yet" popup when launching the app** — you haven't
  run `scripts\setup.ps1` (or it didn't finish `npm install` successfully).
  Go back to Step 2.
- **Antivirus flags `ollama.exe` or quarantines it** — this is a known false
  positive some antivirus vendors have had with Ollama's Windows build (it's
  an unsigned, LLM-inference binary that behaves unusually to some
  heuristics). Verify you got it from the official
  `github.com/ollama/ollama/releases` page (which `setup.ps1` does
  automatically) and add an exclusion if needed.
- **`npm install` fails on a native module** — install "Desktop development
  with C++" via the Visual Studio Build Tools, then re-run `setup.ps1`.
- **Model pulls are slow / disk fills up fast** — you're likely running off
  a USB drive. Tools → Models has a "Choose folder on this PC..." option to
  point Ollama's model storage at a faster local drive instead of the
  portable folder; see the "Model storage location" section in
  [README.md](README.md).
- **A different app already has Ollama running** — the System tab will warn
  you if a pre-existing Ollama instance answered first (its own tray app, a
  system service). Quit that instance and relaunch AIPortable so it can
  start and manage its own bundled copy instead.

## macOS / Linux

`setup.ps1` is Windows-only. On macOS or Linux:

```bash
npm install
```

then install Ollama normally for your platform from https://ollama.com/download
(or see the `PLACE_BINARY_HERE.txt` placeholders under `resources/ollama/mac`
and `resources/ollama/linux` if you want a fully portable, nothing-to-install
build instead — same idea as the Windows one, just done by hand). Launch with:

```bash
npm start
```

## What's next

Once you're up and running, see [README.md](README.md) for the full feature
walkthrough — Library/RAG document search, chat export, mobile sync, model
catalog customization, and more.
