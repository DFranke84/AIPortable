# AIPortable — First-Time Setup

A fresh copy of AIPortable is just the source code, the catalogs in `data\`
and the setup scripts. Everything else — Node.js, Electron, Ollama, Kiwix,
voice input, the map tool, models and maps — is downloaded by **one
double-click**.

## Prerequisites

- **Windows 10/11, 64-bit.**
- **Internet access** for the one-time setup. Not needed afterwards, except
  to download more models or maps.
- **Disk space:** about 3 GB for the app and its tools, plus whatever models
  (2–20 GB each) and maps (38 MB – 26 GB each) you pick.

## Step 1 — Put the folder where you want it

Copy the whole `AIPortable` folder to where it should live — a fixed folder
like `E:\AIPortable`, or a USB drive. Chats, models, maps and library
documents are all stored inside it under `data\`, so it stays self-contained
and movable.

## Step 2 — Double-click `Setup-Windows.bat`

It asks two questions first, then runs on its own:

1. **Which chat model to download.** It detects your graphics card's memory
   and shows the matching model catalog (4K/8K/12K/24K/32K). Type a number —
   the first *General* model is a good choice — or press Enter to skip.
2. **Which offline map regions to download** (from `data\maps-catalog.json`):
   from the Flathead Valley (38 MB) or Montana (383 MB) up to whole
   continents. Type numbers, or press Enter to skip.

Then it installs, without admin rights and without changing anything outside
this folder:

| What | Where | Size |
|---|---|---|
| Node.js (portable, only used for installing) | `runtime\node` | ~30 MB |
| Electron and the app's other dependencies | `node_modules` | ~300 MB |
| Ollama (runs the AI models) | `resources\ollama\win` | ~1.5 GB |
| Kiwix (Wikipedia viewer and ZIM search in chat) | `resources\kiwix\win` | ~15 MB |
| Voice input (whisper.cpp + English model) | `resources\whisper\win` | ~150 MB |
| Map download tool (pmtiles) | `resources\maps\tools` | ~18 MB |
| Search model `nomic-embed-text` (Library search) | `data\models` | 274 MB |
| The chat model and maps you picked | `data\models`, `data\maps` | your choice |

At the end it checks everything is in place and offers to start the app.

It's safe to run again any time — it skips whatever is already there, so a
second run just fills in anything missing.

**Optional flags** (add them after the file name in a command prompt), e.g.
`Setup-Windows.bat -Model qwen2.5:3b -Maps montana,world`:

| Flag | Effect |
|---|---|
| `-Model name` / `-SkipModels` | Download this chat model without asking / no models at all |
| `-Maps a,b` / `-SkipMaps` | Download these map regions without asking / no maps |
| `-NoVoice` | Leave out voice input |
| `-SkipOllama` | Use a system-wide Ollama instead of the portable copy |
| `-UseWinget` | Install Node.js system-wide with winget instead of the portable copy |
| `-NoLaunch` | Don't offer to start the app at the end |

## Step 3 — Start the app

Double-click **`AIPortable.vbs`** (no console window), or
**`Start-AIPortable-With-Console.bat`** to see the log.

## Later: more models, maps and archives

- **Models:** Tools → Models.
- **Maps:** Tools → Maps → *Download maps* — the same catalog as setup. To add
  a region of your own, add an entry to `data\maps-catalog.json` (a name and a
  bounding box from https://boundingbox.klokantech.com/). Or run
  `resources\maps\DOWNLOAD-MAPS.ps1`.
- **Wikipedia and other .zim archives:** Tools → Wikipedia (catalog
  downloads), or point Tools → Library → *ZIM archive folders* at folders you
  already have.

## Troubleshooting

- **"Setup isn't finished yet" when starting the app** — run
  `Setup-Windows.bat` (again); it fills in whatever is missing.
- **Antivirus quarantines `ollama.exe`** — a known false positive with
  Ollama's Windows build. Setup downloads it from the official
  `github.com/ollama/ollama` releases; add an exclusion if needed.
- **npm fails on a native module** — install "Desktop development with C++"
  from the Visual Studio Build Tools, then run setup again.
- **Model downloads are slow or fill a USB drive** — Tools → Models → *Choose
  folder on this PC* moves model storage to a faster local drive.
- **Another Ollama is already running** (its tray app or a service) — quit it
  and start AIPortable again so it can run its own copy; setup also warns
  that models would go to that other instance's folder.
- **A map region fails to download** — Protomaps keeps only about a week of
  daily world builds online; setup and the app try the last three days
  automatically. Try again later if all three fail.

## macOS / Linux

The setup script is Windows-only. Elsewhere: `npm install`, install Ollama
from https://ollama.com/download (or place portable builds as described in
the `PLACE_BINARY_HERE.txt` files under `resources\`), then `npm start`.
