[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$HostName,
  [int]$Port = 47742,
  [string]$UserName = "root",
  [ValidateSet("Install", "Update")]
  [string]$Mode = "Update",
  [string]$ArchivePath = "",
  [switch]$SkipLocalChecks
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Get-Command scp.exe -ErrorAction SilentlyContinue) -or
    -not (Get-Command ssh.exe -ErrorAction SilentlyContinue)) {
  throw "Windows OpenSSH client is required (scp.exe and ssh.exe)."
}

if (-not $ArchivePath) {
  $buildArguments = @{}
  if ($SkipLocalChecks) { $buildArguments.SkipChecks = $true }
  $buildOutput = @(& (Join-Path $PSScriptRoot "build-release.ps1") @buildArguments)
  $ArchivePath = [string]$buildOutput[-1]
}

$archive = Get-Item -LiteralPath $ArchivePath
if ($archive.Name -notmatch '^fire-game-release-(\d{14})\.tar\.gz$') {
  throw "Archive name must be fire-game-release-YYYYMMDDHHMMSS.tar.gz."
}
$releaseId = $Matches[1]
$archiveSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive.FullName).Hash.ToLowerInvariant()
$remoteArchive = "/tmp/$($archive.Name)"
$localScript = if ($Mode -eq "Install") {
  Join-Path $PSScriptRoot "server-bootstrap.sh"
} else {
  Join-Path $PSScriptRoot "server-update.sh"
}
$remoteScript = "/tmp/$([System.IO.Path]::GetFileName($localScript))"
$destination = "${UserName}@${HostName}:/tmp/"

Write-Host "Uploading release $releaseId to ${UserName}@${HostName}:$Port ..."
& scp.exe -P $Port -- $archive.FullName $localScript $destination
if ($LASTEXITCODE -ne 0) { throw "Upload failed." }

$remoteCommand = "printf '%s  %s\n' '$archiveSha256' '$remoteArchive' | sha256sum -c - && bash '$remoteScript' '$remoteArchive' '$releaseId'; status=`$?; rm -f -- '$remoteArchive' '$remoteScript'; exit `$status"
& ssh.exe -p $Port -- "${UserName}@${HostName}" $remoteCommand
if ($LASTEXITCODE -ne 0) { throw "Remote deployment failed." }

& ssh.exe -p $Port -- "${UserName}@${HostName}" "bash /opt/fire-game/current/deploy/server-health.sh"
if ($LASTEXITCODE -ne 0) { throw "Deployment completed, but the health check failed." }

Write-Host "Deployment complete: release=$releaseId mode=$Mode"
