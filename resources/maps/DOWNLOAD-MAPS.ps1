<#
  DOWNLOAD-MAPS.ps1 - download offline map regions into data\maps\.

  The regions offered come from data\maps-catalog.json - the same list as the
  app's Tools -> Maps -> Download maps. Add your own region there (a name and
  a bounding box from https://boundingbox.klokantech.com/).

  Each region is cut out of Protomaps' daily world build with the pmtiles
  tool: only the tiles inside the region are fetched, never the whole planet.
  Regions already in data\maps\ are skipped, so this is safe to re-run.

  Usage:
    Right-click -> Run with PowerShell     (shows the list, you pick)
    DOWNLOAD-MAPS.ps1 -Regions montana,world
    DOWNLOAD-MAPS.ps1 -PickOnly            (just asks; prints the chosen keys -
                                            used by the setup script)
#>
param(
  [string[]]$Regions = @(),
  [switch]$PickOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$root     = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$toolsDir = Join-Path $PSScriptRoot 'tools'
$exePath  = Join-Path $toolsDir 'pmtiles.exe'
$mapsDir  = Join-Path $root 'data\maps'
$catalogPath = Join-Path $root 'data\maps-catalog.json'
$PmtilesVersion = '1.31.2'

if (-not (Test-Path $catalogPath)) { Write-Host "Map catalog not found: $catalogPath" -ForegroundColor Red; exit 1 }
$catalog = Get-Content $catalogPath -Raw | ConvertFrom-Json

# Regions in catalog order, grouped by the catalog's group weights.
$weights = @{}
if ($catalog.groups) { $catalog.groups.PSObject.Properties | ForEach-Object { $weights[$_.Name] = [int]$_.Value } }
$i = 0
$all = @($catalog.regions.PSObject.Properties | ForEach-Object {
  $g = if ($_.Value.group) { $_.Value.group } else { 'Other' }
  $w = if ($weights.ContainsKey($g)) { $weights[$g] } else { 99 }
  [pscustomobject]@{ Key = $_.Name; Name = $_.Value.name; Group = $g; Size = $_.Value.size; Bbox = $_.Value.bbox; MaxZoom = $_.Value.maxzoom; W = $w; Order = $i++ }
} | Sort-Object W, Order)

function Show-Menu {
  Write-Host ""
  Write-Host "    Offline maps - pick the regions to download (they're saved in data\maps):"
  $lastGroup = ''
  for ($n = 0; $n -lt $all.Count; $n++) {
    $r = $all[$n]
    if ($r.Group -ne $lastGroup) { Write-Host ""; Write-Host "    $($r.Group)" -ForegroundColor Cyan; $lastGroup = $r.Group }
    $have = if (Test-Path (Join-Path $mapsDir "$($r.Key).pmtiles")) { '  (already downloaded)' } else { '' }
    Write-Host ("    {0,2}) {1,-48} {2,8}{3}" -f ($n + 1), $r.Name, $r.Size, $have)
  }
  Write-Host ""
  $answer = Read-Host "    Type the number(s) of the regions you want (e.g. 2 or 1,15), or press Enter to skip maps"
  $picked = @()
  foreach ($tok in ($answer -split '[,\s]+' | Where-Object { $_ })) {
    $n = 0
    if ([int]::TryParse($tok, [ref]$n) -and $n -ge 1 -and $n -le $all.Count) { $picked += $all[$n - 1].Key }
    else { Write-Host "    Ignored '$tok' - not a number from the list." -ForegroundColor Yellow }
  }
  return $picked
}

if ($PickOnly) { return (Show-Menu) }
if (-not $Regions.Count) { $Regions = @(Show-Menu) }
if (-not $Regions.Count) { Write-Host "    No map regions picked."; return }

# --- the pmtiles tool: bundled zip first, else download it ------------------
if (-not (Test-Path $exePath)) {
  New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
  $zip = Get-ChildItem -Path $toolsDir -Filter 'go-pmtiles_*_Windows_x86_64.zip' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $zip) {
    $url = "https://github.com/protomaps/go-pmtiles/releases/download/v$PmtilesVersion/go-pmtiles_${PmtilesVersion}_Windows_x86_64.zip"
    Write-Host "    Downloading the pmtiles map tool: $url"
    $zipPath = Join-Path $toolsDir "go-pmtiles_${PmtilesVersion}_Windows_x86_64.zip"
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
    $zip = Get-Item $zipPath
  }
  Expand-Archive -Path $zip.FullName -DestinationPath $toolsDir -Force
  if (-not (Test-Path $exePath)) { Write-Host "    pmtiles.exe wasn't found after unpacking $($zip.Name)." -ForegroundColor Red; exit 1 }
}

# --- download ----------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $mapsDir | Out-Null
$source = if ($catalog.source) { $catalog.source } else { 'https://build.protomaps.com/{date}.pmtiles' }
# Today's build can lag a few hours behind; Protomaps keeps about a week online.
$dates = 0..2 | ForEach-Object { (Get-Date).ToUniversalTime().AddDays(-$_).ToString('yyyyMMdd') }

$failed = 0
foreach ($key in $Regions) {
  $r = $all | Where-Object { $_.Key -eq $key } | Select-Object -First 1
  if (-not $r) { Write-Host "    Unknown region '$key' - not in the map catalog." -ForegroundColor Yellow; $failed++; continue }
  $dest = Join-Path $mapsDir "$key.pmtiles"
  if (Test-Path $dest) { Write-Host "    [skip] $($r.Name) - already in data\maps"; continue }
  $part = "$dest.part"
  $done = $false
  foreach ($d in $dates) {
    Remove-Item $part -Force -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "    Downloading $($r.Name) ($($r.Size), map build $d)..." -ForegroundColor Cyan
    $argList = @('extract', $source.Replace('{date}', $d), $part)
    if ($r.Bbox) { $argList += "--bbox=$($r.Bbox)" }
    if ($null -ne $r.MaxZoom) { $argList += "--maxzoom=$($r.MaxZoom)" }
    & $exePath @argList
    if ($LASTEXITCODE -eq 0 -and (Test-Path $part)) { Move-Item $part $dest -Force; $done = $true; break }
    Write-Host "    That build didn't work - trying the day before." -ForegroundColor Yellow
  }
  Remove-Item $part -Force -ErrorAction SilentlyContinue
  if ($done) { Write-Host "    OK: $($r.Name) saved as data\maps\$key.pmtiles" -ForegroundColor Green }
  else { Write-Host "    Could not download $($r.Name) - try again later, or from Tools -> Maps in the app." -ForegroundColor Red; $failed++ }
}
if ($failed) { exit 1 }
