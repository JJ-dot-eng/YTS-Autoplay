[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string] $ZipPath
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$ManifestPath = Join-Path $RepoRoot "manifest.json"
$ManifestText = [System.IO.File]::ReadAllText($ManifestPath, [System.Text.Encoding]::UTF8)
$Manifest = $ManifestText | ConvertFrom-Json

function Get-PathInsideRepo {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path,

    [Parameter(Mandatory = $true)]
    [string] $Description
  )

  $rootFullPath = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd([char[]] @("\", "/"))
  $targetFullPath = [System.IO.Path]::GetFullPath($Path)
  $rootPrefix = $rootFullPath + [System.IO.Path]::DirectorySeparatorChar
  $isRepoRoot = $targetFullPath.Equals($rootFullPath, [System.StringComparison]::OrdinalIgnoreCase)
  $isRepoChild = $targetFullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)

  if (-not ($isRepoRoot -or $isRepoChild)) {
    throw "$Description is outside the repository: $targetFullPath"
  }

  return $targetFullPath
}

function Convert-ToEntryPath {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path
  )

  $slashPath = $Path.Replace("\", "/")
  if ($slashPath.StartsWith("/", [System.StringComparison]::Ordinal) -or $slashPath -match "^[A-Za-z]:") {
    throw "Archive entry uses an absolute path: $Path"
  }

  $segments = New-Object System.Collections.Generic.List[string]
  foreach ($segment in $slashPath.Split([char] "/")) {
    if ([string]::IsNullOrEmpty($segment) -or $segment -eq ".") {
      continue
    }

    if ($segment -eq "..") {
      throw "Archive entry escapes its root: $Path"
    }

    $segments.Add($segment) | Out-Null
  }

  if ($segments.Count -eq 0) {
    throw "Archive entry has an empty path: $Path"
  }

  return [string]::Join("/", $segments.ToArray())
}

function Convert-ToCaseSensitiveKey {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Value
  )

  return [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Value))
}

function Get-RepoRelativeEntryPath {
  param(
    [Parameter(Mandatory = $true)]
    [string] $FullPath
  )

  $rootFullPath = $RepoRoot.TrimEnd([char[]] @("\", "/"))
  $rootPrefix = $rootFullPath + [System.IO.Path]::DirectorySeparatorChar
  if (-not $FullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Expected package file is not a repository child: $FullPath"
  }

  return Convert-ToEntryPath $FullPath.Substring($rootPrefix.Length)
}

$ExpectedFiles = @{}

function Add-ExpectedFile {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path,

    [Parameter(Mandatory = $true)]
    [string] $Description
  )

  if ([System.IO.Path]::IsPathRooted($Path)) {
    $candidatePath = $Path
  }
  else {
    $candidatePath = Join-Path $RepoRoot $Path
  }

  $fullPath = Get-PathInsideRepo -Path $candidatePath -Description $Description
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "$Description does not exist: $fullPath"
  }

  $entryPath = Get-RepoRelativeEntryPath $fullPath
  $key = Convert-ToCaseSensitiveKey $entryPath
  if ($ExpectedFiles.ContainsKey($key)) {
    if ($ExpectedFiles[$key].SourcePath -cne $fullPath) {
      throw "Expected package path is ambiguous: $entryPath"
    }

    return
  }

  $ExpectedFiles[$key] = [PSCustomObject] @{
    EntryPath = $entryPath
    SourcePath = $fullPath
  }
}

function Get-HtmlAttributeValue {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Attributes,

    [Parameter(Mandatory = $true)]
    [string] $Name
  )

  $attributePattern = '(?is)(?:^|\s)' + [System.Text.RegularExpressions.Regex]::Escape($Name) +
    '\s*=\s*(?:"(?<double>[^"]*)"|''(?<single>[^'']*)'')'
  $attributeMatch = [System.Text.RegularExpressions.Regex]::Match($Attributes, $attributePattern)
  if (-not $attributeMatch.Success) {
    return $null
  }

  if ($attributeMatch.Groups["double"].Success) {
    return $attributeMatch.Groups["double"].Value
  }

  return $attributeMatch.Groups["single"].Value
}

function Get-ReferencePathPart {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Reference
  )

  $delimiterIndex = $Reference.IndexOfAny([char[]] @("?", "#"))
  if ($delimiterIndex -ge 0) {
    return $Reference.Substring(0, $delimiterIndex)
  }

  return $Reference
}

function Add-LocalPopupAsset {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Reference,

    [Parameter(Mandatory = $true)]
    [string] $PopupFullPath
  )

  $trimmedReference = $Reference.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmedReference)) {
    return
  }

  if ($trimmedReference -match '^(?:[A-Za-z][A-Za-z0-9+.-]*:|//|#)') {
    return
  }

  $pathPart = Get-ReferencePathPart $trimmedReference
  if ([string]::IsNullOrWhiteSpace($pathPart)) {
    return
  }

  $decodedPath = [System.Uri]::UnescapeDataString($pathPart).Replace("/", "\")
  if ($decodedPath.StartsWith("\", [System.StringComparison]::Ordinal)) {
    $assetPath = Join-Path $RepoRoot $decodedPath.TrimStart([char[]] @("\", "/"))
  }
  else {
    $assetPath = Join-Path (Split-Path -Parent $PopupFullPath) $decodedPath
  }

  Add-ExpectedFile -Path $assetPath -Description "Popup asset '$Reference'"
}

function Get-FileSha256 {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path
  )

  $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $hashBytes = $sha256.ComputeHash($stream)
    }
    finally {
      $sha256.Dispose()
    }
  }
  finally {
    $stream.Dispose()
  }

  return [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLowerInvariant()
}

function Get-EntrySha256 {
  param(
    [Parameter(Mandatory = $true)]
    [System.IO.Compression.ZipArchiveEntry] $Entry
  )

  $stream = $Entry.Open()
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $hashBytes = $sha256.ComputeHash($stream)
    }
    finally {
      $sha256.Dispose()
    }
  }
  finally {
    $stream.Dispose()
  }

  return [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLowerInvariant()
}

Add-ExpectedFile -Path "manifest.json" -Description "Manifest"

if ($Manifest.background -and -not [string]::IsNullOrWhiteSpace([string] $Manifest.background.service_worker)) {
  Add-ExpectedFile -Path ([string] $Manifest.background.service_worker) -Description "Background service worker"
}

foreach ($contentScript in @($Manifest.content_scripts)) {
  foreach ($scriptPath in @($contentScript.js)) {
    if (-not [string]::IsNullOrWhiteSpace([string] $scriptPath)) {
      Add-ExpectedFile -Path ([string] $scriptPath) -Description "Content script"
    }
  }
}

if ($Manifest.icons) {
  foreach ($iconProperty in $Manifest.icons.PSObject.Properties) {
    if (-not [string]::IsNullOrWhiteSpace([string] $iconProperty.Value)) {
      Add-ExpectedFile -Path ([string] $iconProperty.Value) -Description "Manifest icon"
    }
  }
}

if ($Manifest.action -and $Manifest.action.default_icon) {
  foreach ($iconProperty in $Manifest.action.default_icon.PSObject.Properties) {
    if (-not [string]::IsNullOrWhiteSpace([string] $iconProperty.Value)) {
      Add-ExpectedFile -Path ([string] $iconProperty.Value) -Description "Action icon"
    }
  }
}

$popupPath = $null
if ($Manifest.action -and -not [string]::IsNullOrWhiteSpace([string] $Manifest.action.default_popup)) {
  $popupPath = [string] $Manifest.action.default_popup
  Add-ExpectedFile -Path $popupPath -Description "Action popup"

  $popupFullPath = Get-PathInsideRepo -Path (Join-Path $RepoRoot $popupPath) -Description "Action popup"
  $popupHtml = [System.IO.File]::ReadAllText($popupFullPath, [System.Text.Encoding]::UTF8)

  foreach ($linkMatch in [System.Text.RegularExpressions.Regex]::Matches($popupHtml, '(?is)<link\b(?<attributes>[^>]*)>')) {
    $attributes = $linkMatch.Groups["attributes"].Value
    $href = Get-HtmlAttributeValue -Attributes $attributes -Name "href"
    if ($null -eq $href) {
      continue
    }

    $rel = Get-HtmlAttributeValue -Attributes $attributes -Name "rel"
    $hrefPath = Get-ReferencePathPart $href
    $isStyleSheet = $rel -and (@($rel -split '\s+') -icontains "stylesheet")
    $isCssFile = [System.IO.Path]::GetExtension($hrefPath).Equals(".css", [System.StringComparison]::OrdinalIgnoreCase)
    if ($isStyleSheet -or $isCssFile) {
      Add-LocalPopupAsset -Reference $href -PopupFullPath $popupFullPath
    }
  }

  foreach ($scriptMatch in [System.Text.RegularExpressions.Regex]::Matches($popupHtml, '(?is)<script\b(?<attributes>[^>]*)>')) {
    $attributes = $scriptMatch.Groups["attributes"].Value
    $src = Get-HtmlAttributeValue -Attributes $attributes -Name "src"
    if ($null -ne $src) {
      Add-LocalPopupAsset -Reference $src -PopupFullPath $popupFullPath
    }
  }
}

$localesPath = Join-Path $RepoRoot "_locales"
if (Test-Path -LiteralPath $localesPath -PathType Container) {
  foreach ($localeFile in Get-ChildItem -LiteralPath $localesPath -Recurse -Force -File) {
    Add-ExpectedFile -Path $localeFile.FullName -Description "Locale file"
  }
}

if ([string]::IsNullOrWhiteSpace($ZipPath)) {
  $ZipPath = Join-Path "dist" ("yts-autoplay-v{0}.zip" -f $Manifest.version)
}

if ([System.IO.Path]::IsPathRooted($ZipPath)) {
  $zipCandidate = $ZipPath
}
else {
  $zipCandidate = Join-Path $RepoRoot $ZipPath
}

$zipFullPath = Get-PathInsideRepo -Path $zipCandidate -Description "ZIP package"
if (-not (Test-Path -LiteralPath $zipFullPath -PathType Leaf)) {
  throw "ZIP package does not exist: $zipFullPath"
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($zipFullPath)
try {
  $ArchiveEntries = @{}
  foreach ($entry in $archive.Entries) {
    $entryPath = Convert-ToEntryPath $entry.FullName
    $key = Convert-ToCaseSensitiveKey $entryPath
    if ($ArchiveEntries.ContainsKey($key)) {
      throw "ZIP contains a duplicate normalized entry: $entryPath"
    }

    $ArchiveEntries[$key] = [PSCustomObject] @{
      EntryPath = $entryPath
      Entry = $entry
    }
  }

  $missingEntries = New-Object System.Collections.Generic.List[string]
  foreach ($expectedRecord in $ExpectedFiles.Values) {
    $key = Convert-ToCaseSensitiveKey $expectedRecord.EntryPath
    if (-not $ArchiveEntries.ContainsKey($key)) {
      $missingEntries.Add($expectedRecord.EntryPath) | Out-Null
    }
  }

  $unexpectedEntries = New-Object System.Collections.Generic.List[string]
  foreach ($archiveRecord in $ArchiveEntries.Values) {
    $key = Convert-ToCaseSensitiveKey $archiveRecord.EntryPath
    if (-not $ExpectedFiles.ContainsKey($key)) {
      $unexpectedEntries.Add($archiveRecord.EntryPath) | Out-Null
    }
  }

  if ($missingEntries.Count -gt 0 -or $unexpectedEntries.Count -gt 0) {
    $details = New-Object System.Collections.Generic.List[string]
    if ($missingEntries.Count -gt 0) {
      $details.Add("missing: " + [string]::Join(", ", @($missingEntries | Sort-Object))) | Out-Null
    }
    if ($unexpectedEntries.Count -gt 0) {
      $details.Add("unexpected: " + [string]::Join(", ", @($unexpectedEntries | Sort-Object))) | Out-Null
    }

    throw "ZIP file list does not match the manifest-derived package list ($([string]::Join('; ', $details.ToArray())))"
  }

  foreach ($expectedRecord in @($ExpectedFiles.Values | Sort-Object EntryPath)) {
    $key = Convert-ToCaseSensitiveKey $expectedRecord.EntryPath
    $sourceHash = Get-FileSha256 $expectedRecord.SourcePath
    $entryHash = Get-EntrySha256 $ArchiveEntries[$key].Entry
    if ($sourceHash -cne $entryHash) {
      throw "ZIP content differs from the repository source: $($expectedRecord.EntryPath)"
    }
  }

  $manifestKey = Convert-ToCaseSensitiveKey "manifest.json"
  $manifestEntryStream = $ArchiveEntries[$manifestKey].Entry.Open()
  try {
    $manifestReader = New-Object System.IO.StreamReader($manifestEntryStream, [System.Text.Encoding]::UTF8, $true)
    try {
      $packagedManifestText = $manifestReader.ReadToEnd()
    }
    finally {
      $manifestReader.Dispose()
    }
  }
  finally {
    $manifestEntryStream.Dispose()
  }

  $packagedManifest = $packagedManifestText | ConvertFrom-Json
  if ([string] $packagedManifest.version -cne [string] $Manifest.version) {
    throw "ZIP manifest version '$($packagedManifest.version)' does not match repository version '$($Manifest.version)'"
  }
}
finally {
  $archive.Dispose()
}

Write-Output ("Package verification OK: {0} ({1} files, version {2})" -f $zipFullPath, $ExpectedFiles.Count, $Manifest.version)
