<#
  DOWNLOAD-MAPS.ps1 -- (re)download/extract the offline map (.pmtiles) files
  this copy of the app already has in data\maps\, or add new ones.

  The app ships with NO map tiles by design (they're multi-GB per region).
  This script is idempotent -- it skips any region whose file already exists
  in data\maps\ -- so it doubles as both the original download script and a
  safe "refresh/re-verify everything" tool you can re-run any time.

  A portable copy of the pmtiles CLI (go-pmtiles v1.31.2, Windows x86_64) is
  already bundled in this folder as a zip:

      resources\maps\tools\go-pmtiles_1.31.2_Windows_x86_64.zip

  ---------------------------------------------------------------------------
  ONE-TIME SETUP -- extract the pmtiles CLI so the commands below can find it
  ---------------------------------------------------------------------------
  You need pmtiles.exe sitting at:

      resources\maps\tools\pmtiles.exe

  To get it there:
    1. Open resources\maps\tools\ in File Explorer.
    2. Right-click go-pmtiles_1.31.2_Windows_x86_64.zip -> "Extract All..."
       (or double-click it if you have 7-Zip/similar installed).
    3. The zip contains pmtiles.exe, LICENSE, and README.md at its top level
       -- extract them directly into resources\maps\tools\ (not into a new
       subfolder), so you end up with resources\maps\tools\pmtiles.exe.
    4. You can delete the extracted LICENSE/README.md if you like, or leave
       them -- only pmtiles.exe is actually used.

  This script also does that extraction for you automatically the first
  time it's run (see the "auto-extract" block below) -- the manual steps
  above are just there in case you'd rather do it by hand, or the
  auto-extract step fails for some reason (e.g. Windows blocking a file
  downloaded from the internet -- right-click the zip -> Properties ->
  "Unblock" if so).

  ---------------------------------------------------------------------------
  Two ways to get a .pmtiles file for a region
  ---------------------------------------------------------------------------

  OPTION A -- download a pre-built extract (easiest, no CLI needed)
    1. Go to https://protomaps.com/downloads
    2. Pick a city/state/country/continent -- sizes range from tens of MB
       (a city) to a few GB (a continent).
    3. Save the downloaded .pmtiles file into ..\..\data\maps\ (all maps --
       the ones you download yourself and the ones that came with this
       copy of the app -- live there; the app's Maps tab -> "Import local
       .pmtiles..." does the same copy for you if you'd rather use the UI).

  OPTION B -- extract a custom bounding box yourself with the bundled CLI
    Once resources\maps\tools\pmtiles.exe exists (see setup above), extract
    just the area you want from Protomaps' daily global build straight into
    data\maps\ (this is byte-range extraction over HTTP -- it does NOT
    download the full ~120GB planet file first):

        .\tools\pmtiles.exe extract https://build.protomaps.com/<date>.pmtiles ..\..\data\maps\<output>.pmtiles --bbox=<minLon>,<minLat>,<maxLon>,<maxLat>

    Find <date> (a build snapshot, e.g. 20260911) at
    https://maps.protomaps.com/builds/ -- Protomaps only keeps roughly the
    last week of daily builds online, so an old date will eventually 404;
    $BuildDate below defaults to today and falls back automatically.
    Find a bounding box for your own custom area at
    https://boundingbox.klokantech.com/

  ---------------------------------------------------------------------------
  YOUR COMMANDS -- one block per region below. Each is idempotent (skips if
  the file already exists) and uses the shared $BuildDate. Add your own
  region by copying a block and giving it a new bbox.
  ---------------------------------------------------------------------------
#>

# --- auto-extract: unpacks the bundled pmtiles CLI zip on first run -------
$toolsDir = Join-Path $PSScriptRoot 'tools'
$exePath  = Join-Path $toolsDir 'pmtiles.exe'
$zipPath  = Join-Path $toolsDir 'go-pmtiles_1.31.2_Windows_x86_64.zip'

if (-not (Test-Path $exePath)) {
  if (Test-Path $zipPath) {
    Write-Host "Extracting pmtiles CLI from $zipPath ..."
    Expand-Archive -Path $zipPath -DestinationPath $toolsDir -Force
    if (Test-Path $exePath) {
      Write-Host "Ready: $exePath"
    } else {
      Write-Warning "Extraction finished but pmtiles.exe wasn't found in $toolsDir - check the zip contents."
    }
  } else {
    Write-Warning "Neither pmtiles.exe nor the bundled zip were found in $toolsDir."
    Write-Warning "Download go-pmtiles for Windows from https://github.com/protomaps/go-pmtiles/releases and place pmtiles.exe there."
  }
}
# ---------------------------------------------------------------------------

$mapsDir = Join-Path $PSScriptRoot '..\..\data\maps'
New-Item -ItemType Directory -Force -Path $mapsDir | Out-Null

# Which planet snapshot to extract from. Defaults to today; if that day's
# build isn't published yet (Protomaps' daily build can lag a few hours),
# each Invoke-Extract call below falls back to yesterday automatically.
$BuildDate = Get-Date -Format 'yyyyMMdd'

function Invoke-Extract {
  param(
    [string]$Name,
    [string]$Bbox,
    [string]$ExtraArgs = ''
  )
  $dest = Join-Path $mapsDir "$Name.pmtiles"
  if (Test-Path $dest) {
    Write-Host "[skip] $Name.pmtiles already exists in data\maps\"
    return
  }
  $dates = @($BuildDate, (Get-Date).AddDays(-1).ToString('yyyyMMdd'))
  foreach ($d in $dates) {
    $source = "https://build.protomaps.com/$d.pmtiles"
    Write-Host "[extract] $Name.pmtiles  (build $d, bbox=$Bbox)"
    $argList = @('extract', $source, $dest, "--bbox=$Bbox")
    if ($ExtraArgs) { $argList += $ExtraArgs.Split(' ') }
    & $exePath @argList
    if (Test-Path $dest) { return }
    Write-Warning "Build $d didn't work for $Name -- trying an older date."
  }
  Write-Warning "Could not extract $Name.pmtiles -- check the date range at https://maps.protomaps.com/builds/ and re-run with a manually-set `$BuildDate."
}

Invoke-Extract -Name 'usa'            -Bbox '-125,24,-66,50'                                  -ExtraArgs '--maxzoom=15'
Invoke-Extract -Name 'alaska'         -Bbox '-169.365234,53.067627,-138.251953,71.965388'
Invoke-Extract -Name 'canada-west'    -Bbox '-140.800781,48.341646,-100.195313,70.050596'
Invoke-Extract -Name 'japan'          -Bbox '125.793457,30.183122,148.842773,45.996962'
Invoke-Extract -Name 'nordics'        -Bbox '4,57.5,31.5,71.5'
Invoke-Extract -Name 'iceland'        -Bbox '-25.334473,62.935235,-12.304688,66.835165'
Invoke-Extract -Name 'western-europe' -Bbox '-10,35,19,55.5'
Invoke-Extract -Name 'uk'             -Bbox '-8.6,49.8,1.8,60.9'
Invoke-Extract -Name 'australia'      -Bbox '112,-44,154,-9'
# Invoke-Extract -Name 'canada-east' -Bbox '-101.953125,40.847060,-51.943359,68.431513'

# world -- this one isn't a bbox extract at all: it's the whole planet at a
# low max zoom (no --bbox = every tile up to --maxzoom, globally). --maxzoom=6
# world.pmtiles; raise it for more detail (bigger file) or lower it for less.
$worldDest = Join-Path $mapsDir 'world.pmtiles'
if (Test-Path $worldDest) {
  Write-Host '[skip] world.pmtiles already exists in data\maps\'
} else {
  $source = "https://build.protomaps.com/$BuildDate.pmtiles"
  Write-Host "[extract] world.pmtiles  (build $BuildDate, whole planet, maxzoom=6)"
  & $exePath extract $source $worldDest --maxzoom=6
}

