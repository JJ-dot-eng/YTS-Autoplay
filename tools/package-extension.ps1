$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$ManifestPath = Join-Path $RepoRoot "manifest.json"
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$DistDir = Join-Path $RepoRoot "dist"
$StageDir = Join-Path $DistDir "package"
$ZipPath = Join-Path $DistDir ("yts-autoplay-v{0}.zip" -f $Manifest.version)

function Assert-InRepo {
  param([string] $Path)

  $rootFullPath = [System.IO.Path]::GetFullPath($RepoRoot)
  $targetFullPath = [System.IO.Path]::GetFullPath($Path)

  if (-not $targetFullPath.StartsWith($rootFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "작업 대상이 저장소 밖입니다: $targetFullPath"
  }

  return $targetFullPath
}

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

if (Test-Path -LiteralPath $StageDir) {
  Remove-Item -LiteralPath (Assert-InRepo $StageDir) -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "icons") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "_locales") | Out-Null

$packageFiles = @("manifest.json", "background.js", "content.js", "popup.html", "popup.css", "popup.js")
foreach ($file in $packageFiles) {
  Copy-Item -LiteralPath (Join-Path $RepoRoot $file) -Destination (Join-Path $StageDir $file)
}

$iconPaths = $Manifest.icons.PSObject.Properties.Value
foreach ($iconPath in $iconPaths) {
  $source = Join-Path $RepoRoot $iconPath
  $destination = Join-Path $StageDir $iconPath
  $destinationDir = Split-Path -Parent $destination

  New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination
}

$localesSourceDir = Join-Path $RepoRoot "_locales"
$localesStageDir = Join-Path $StageDir "_locales"

Get-ChildItem -LiteralPath $localesSourceDir -Directory | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $localesStageDir -Recurse
}

if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath (Assert-InRepo $ZipPath) -Force
}

Compress-Archive -Path (Join-Path $StageDir "*") -DestinationPath $ZipPath -Force
Remove-Item -LiteralPath (Assert-InRepo $StageDir) -Recurse -Force

Write-Output "Created $ZipPath"
