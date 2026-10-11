[CmdletBinding()]
param(
  [string]$OutputDirectory = "",
  [switch]$SkipChecks
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$OutputDirectory = if ($OutputDirectory) {
  $OutputDirectory
} else {
  Join-Path $projectRoot ".deploy-artifacts"
}
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

if (-not $SkipChecks) {
  Push-Location $projectRoot
  try {
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw "Tests failed." }
    & npm.cmd run lint
    if ($LASTEXITCODE -ne 0) { throw "Lint failed." }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Production build failed." }
  }
  finally {
    Pop-Location
  }
}

$releaseId = Get-Date -Format "yyyyMMddHHmmss"
$archiveName = "fire-game-release-$releaseId.tar.gz"
$archivePath = Join-Path $outputRoot $archiveName
$includePaths = @(
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "postcss.config.mjs",
  "eslint.config.mjs",
  "next-env.d.ts",
  "README.md",
  "deploy",
  "docs",
  "public",
  "scripts",
  "src"
)

Push-Location $projectRoot
try {
  & tar.exe -czf $archivePath @includePaths
  if ($LASTEXITCODE -ne 0) { throw "Unable to create release archive." }
}
finally {
  Pop-Location
}

$entries = @(& tar.exe -tzf $archivePath)
$requiredEntries = @(
  "package.json",
  "package-lock.json",
  "deploy/server-bootstrap.sh",
  "deploy/server-install.sh",
  "deploy/server-update.sh",
  "deploy/server-health.sh",
  "deploy/fire-game.service",
  "deploy/nginx-fire-game.conf",
  "public/art/hanabi-table-desktop.webp",
  "public/art/hanabi-table-mobile.webp",
  "public/art/hanabi-card-back.webp",
  "src/components/hanabi-app.tsx",
  "src/components/particle-effects.tsx"
)

foreach ($requiredEntry in $requiredEntries) {
  if ($entries -notcontains $requiredEntry) {
    throw "Release archive is missing required entry: $requiredEntry"
  }
}
if ($entries -match "(^|/)node_modules(/|$)" -or $entries -match "(^|/)\.next(/|$)") {
  throw "Release archive unexpectedly contains a dependency or build cache."
}

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath
$checksumPath = "$archivePath.sha256"
"$($hash.Hash.ToLowerInvariant())  $archiveName" |
  Set-Content -LiteralPath $checksumPath -Encoding ascii

Write-Host "Release: $releaseId"
Write-Host "Archive: $archivePath"
Write-Host "SHA256: $($hash.Hash.ToLowerInvariant())"
Write-Output $archivePath
