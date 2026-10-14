<#
  setup.ps1 — one-time environment setup for AIPortable.

  Run this once after copying the AIPortable2 folder to wherever you want it
  to live (a fixed folder, a USB drive, etc). It gets a brand-new machine
  from "just the source code" to "ready to launch" by:

    1. Checking for Node.js (installing it via winget if missing and winget
       is available).
    2. Running `npm install` — pulls in Electron + all dependencies, and
       (via the existing postinstall hook) copies the MapLibre/pmtiles
       browser bundles into src/renderer/vendor/ and rebuilds better-sqlite3
       against Electron's bundled Node.
    3. Downloading a portable copy of Ollama for Windows straight from
       Ollama's GitHub releases and unpacking it into resources/ollama/win/
       so the app can find and run it itself — no system-wide Ollama
       install, no admin rights, nothing added to PATH.

  It does NOT download any chat model weights, map tiles, or voice models —
  those are fetched on demand from inside the app (Tools -> Models) or via
  the optional placeholder scripts under resources/maps and resources/whisper.
  The one exception is 'nomic-embed-text' (~274 MB) — unlike a chat model,
  which is a matter of taste, the Reference Library's semantic search just
  doesn't work without an embedding model, so this one gets pulled
  automatically as part of setup rather than left for you to notice later.

  Usage (from a normal PowerShell prompt):
    cd scripts
    .\setup.ps1

  Or just right-click this file -> "Run with PowerShell".

  Flags:
    -SkipOllama   Skip the portable Ollama download (use this if you'd
                  rather install Ollama system-wide yourself from
                  https://ollama.com/download).
#>

param(
  [switch]$SkipOllama
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Write-Ok($msg) {
  Write-Host "    OK: $msg" -ForegroundColor Green
}

function Write-Warn2($msg) {
  Write-Host "    NOTE: $msg" -ForegroundColor Yellow
}

# Resolve the project root (one level up from this scripts/ folder), and run
# everything from there so it works no matter what directory you launched
# PowerShell from.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Write-Host "AIPortable setup running in: $root"

# ---------------------------------------------------------------------------
# 1. Node.js
# ---------------------------------------------------------------------------
Write-Step "Checking for Node.js"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Warn2 "Node.js was not found on PATH."
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Host "    Attempting to install Node.js LTS via winget..."
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    Write-Warn2 "Node.js was just installed. Close this window and re-run setup.ps1 in a NEW PowerShell window so PATH picks it up."
    exit 0
  } else {
    Write-Host ""
    Write-Host "Please install Node.js 22.12 or newer manually, then re-run this script:" -ForegroundColor Red
    Write-Host "    https://nodejs.org/  (choose the LTS installer)"
    exit 1
  }
} else {
  $nodeVersion = (node -v).TrimStart('v')
  $major = [int]($nodeVersion.Split('.')[0])
  $minor = [int]($nodeVersion.Split('.')[1])
  # Electron 44 / better-sqlite3 13 need Node 22.12+ to install.
  if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 12)) {
    Write-Host ""
    Write-Host "Found Node.js v$nodeVersion, but AIPortable needs 22.12 or newer." -ForegroundColor Red
    Write-Host "Install a newer version from https://nodejs.org/ and re-run this script."
    exit 1
  }
  Write-Ok "Node.js v$nodeVersion"
}

# ---------------------------------------------------------------------------
# 2. npm install (electron, native deps, vendor map assets)
# ---------------------------------------------------------------------------
Write-Step "Installing app dependencies (npm install) - this needs internet access and can take a few minutes"

npm install
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "npm install failed - see the error above. Common fixes:" -ForegroundColor Red
  Write-Host "  - Make sure you have internet access"
  Write-Host "  - Make sure you have a C++ build toolchain if a native-module rebuild step failed"
  Write-Host "    (Visual Studio Build Tools with 'Desktop development with C++')"
  exit 1
}
# Newer npm versions can skip package install scripts, which is where
# Electron downloads its runtime - so run that step explicitly. It's a no-op
# if the runtime is already in place.
node node_modules\electron\install.js
if ($LASTEXITCODE -ne 0 -or -not (Test-Path 'node_modules\electron\dist\electron.exe')) {
  Write-Host ""
  Write-Host "Downloading the Electron runtime failed - check your internet connection and re-run." -ForegroundColor Red
  exit 1
}
Write-Ok "Dependencies installed, Electron ready, better-sqlite3 ready for Electron"

# ---------------------------------------------------------------------------
# 3. Portable Ollama (Windows)
# ---------------------------------------------------------------------------
if ($SkipOllama) {
  Write-Step "Skipping Ollama download (-SkipOllama passed)"
  Write-Warn2 "Install Ollama yourself from https://ollama.com/download, or place a portable build at resources\ollama\win\ollama.exe (see resources\ollama\win\PLACE_BINARY_HERE.txt)."
} else {
  Write-Step "Setting up portable Ollama (Windows)"

  $ollamaDir = Join-Path $root "resources\ollama\win"
  $ollamaExe = Join-Path $ollamaDir "ollama.exe"

  if (Test-Path $ollamaExe) {
    Write-Ok "Portable Ollama already present at $ollamaExe - skipping download"
  } else {
    New-Item -ItemType Directory -Force -Path $ollamaDir | Out-Null

    Write-Host "    Looking up the latest Ollama release..."
    $apiUrl = "https://api.github.com/repos/ollama/ollama/releases/latest"
    try {
      $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ 'User-Agent' = 'AIPortable-setup' }
    } catch {
      Write-Host ""
      Write-Host "Could not reach GitHub to look up the latest Ollama release." -ForegroundColor Red
      Write-Host "Check your internet connection and re-run this script, or download manually:"
      Write-Host "    https://github.com/ollama/ollama/releases/latest  -> ollama-windows-amd64.zip"
      Write-Host "Then extract it into: $ollamaDir"
      exit 1
    }

    $asset = $release.assets | Where-Object { $_.name -eq 'ollama-windows-amd64.zip' } | Select-Object -First 1
    if (-not $asset) {
      Write-Host ""
      Write-Host "Couldn't find ollama-windows-amd64.zip in the latest release ($($release.tag_name))." -ForegroundColor Red
      Write-Host "Download it manually from https://github.com/ollama/ollama/releases/latest"
      Write-Host "and extract it into: $ollamaDir"
      exit 1
    }

    Write-Host "    Downloading Ollama $($release.tag_name) ($([math]::Round($asset.size / 1MB, 0)) MB)..."
    $zipPath = Join-Path $env:TEMP "ollama-windows-amd64.zip"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UseBasicParsing

    Write-Host "    Extracting..."
    Expand-Archive -Path $zipPath -DestinationPath $ollamaDir -Force
    Remove-Item $zipPath -Force

    if (Test-Path $ollamaExe) {
      Write-Ok "Portable Ollama $($release.tag_name) installed at $ollamaDir"
    } else {
      Write-Host ""
      Write-Host "Extraction finished but ollama.exe wasn't where it was expected ($ollamaExe)." -ForegroundColor Red
      Write-Host "Check the contents of $ollamaDir - you may need to move files up one level."
      exit 1
    }
  }
}

# ---------------------------------------------------------------------------
# 4. Runtime data folders
# ---------------------------------------------------------------------------
Write-Step "Making sure runtime data folders exist"
foreach ($folder in @('data\models', 'data\library', 'data\maps')) {
  $p = Join-Path $root $folder
  New-Item -ItemType Directory -Force -Path $p | Out-Null
}
Write-Ok "data\models, data\library, data\maps ready (all start empty)"

# ---------------------------------------------------------------------------
# 5. Auto-pull nomic-embed-text
# ---------------------------------------------------------------------------
# Unlike chat models (which are a matter of taste, pulled later from Tools ->
# Models), this one isn't optional in practice: the Reference Library's
# semantic search silently does nothing without it (keyword search still
# works, but that's a degraded experience, not the intended one), and it's
# tiny (~274 MB) — small enough to just always grab up front rather than
# waiting for someone to notice search feels weak and go dig for why.
Write-Step "Pulling nomic-embed-text (powers Reference Library semantic search)"

$ollamaCmd = $null
if (-not $SkipOllama -and (Test-Path $ollamaExe)) {
  $ollamaCmd = $ollamaExe
} else {
  $systemOllama = Get-Command ollama -ErrorAction SilentlyContinue
  if ($systemOllama) { $ollamaCmd = $systemOllama.Source }
}

if (-not $ollamaCmd) {
  Write-Warn2 "No Ollama binary available (Ollama step was skipped or none found) - pull 'nomic-embed-text:latest' yourself later from Tools -> Models once Ollama is set up."
} else {
  # Match main.js's ensureOllamaRunning(): models land in the portable
  # data\models folder, not the user-profile default, so this pull travels
  # with the app rather than being tied to this one PC.
  $env:OLLAMA_MODELS = Join-Path $root "data\models"
  Write-Host "    Starting a temporary Ollama server to pull the model..."
  $serverProc = Start-Process -FilePath $ollamaCmd -ArgumentList "serve" -WindowStyle Hidden -PassThru
  try {
    $ready = $false
    for ($i = 0; $i -lt 20; $i++) {
      Start-Sleep -Seconds 1
      try {
        Invoke-WebRequest -Uri "http://127.0.0.1:11434" -UseBasicParsing -TimeoutSec 2 | Out-Null
        $ready = $true
        break
      } catch { }
    }
    if (-not $ready) {
      Write-Warn2 "Ollama server didn't come up in time - pull 'nomic-embed-text:latest' yourself later from Tools -> Models in the app."
    } else {
      & $ollamaCmd pull nomic-embed-text:latest
      if ($LASTEXITCODE -eq 0) {
        Write-Ok "nomic-embed-text:latest pulled"
      } else {
        Write-Warn2 "Pulling nomic-embed-text:latest failed - you can pull it later from Tools -> Models in the app."
      }
    }
  } finally {
    if ($serverProc -and -not $serverProc.HasExited) {
      Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
    }
  }
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Step "Setup complete"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Launch the app: double-click AIPortable.vbs (or Start-AIPortable-With-Console.bat)"
Write-Host "  2. Open Tools -> Models and pull a chat model (e.g. qwen2.5:3b or llama3.2:1b)"
Write-Host "     ('nomic-embed-text' for Library semantic search was already pulled above.)"
Write-Host "  3. (Optional) Offline maps: see resources\maps\DOWNLOAD-MAPS.ps1"
Write-Host "  4. (Optional) Voice input: see resources\whisper\win\PLACE_BINARY_HERE.txt"
Write-Host ""
Write-Host "See SETUP.md in the project root for the full walkthrough." -ForegroundColor Cyan
