# steer-loop.ps1 -- queue a user message into the active loop session

[CmdletBinding()]
param(
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$Message,

  [string]$StatePath = (Join-Path $PSScriptRoot '.loop-tmp\active-session.json'),

  [ValidateRange(1, 60)]
  [int]$StartupWaitSec = 10
)

$ErrorActionPreference = 'Stop'

function Fail-Steer {
  param([string]$Text)
  Write-Host "[steer] $Text" -ForegroundColor Red
  exit 1
}

$text = ($Message -join ' ').Trim()
if (-not $text) {
  $text = (Read-Host 'Message for the active loop session').Trim()
}
if (-not $text) { Fail-Steer 'message is empty.' }

if (-not (Test-Path -LiteralPath $StatePath)) {
  Fail-Steer "no active loop session was found ($StatePath)."
}

try {
  $state = Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json
} catch {
  Fail-Steer "could not read active loop state: $_"
}

if (-not $state.controlUrl -or [int]$state.controlPort -le 0) {
  Fail-Steer 'the active loop was started without live steering. Restart it with the updated loop.ps1.'
}

$active = Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue
if (-not $active) { Fail-Steer "the recorded launcher process (PID $($state.pid)) is no longer running." }
try {
  $actualFileTime = $active.StartTime.ToFileTimeUtc()
  $deltaSec = [math]::Abs(($actualFileTime - [int64]$state.startedFileTimeUtc) / 10000000.0)
  if ($deltaSec -gt 2) { Fail-Steer 'the recorded launcher PID has been reused; refusing to target it.' }
} catch {
  Fail-Steer "could not validate the active launcher process: $_"
}

$baseUrl = ([string]$state.controlUrl).TrimEnd('/')
$directory = [uri]::EscapeDataString([string]$state.repo)
$deadline = (Get-Date).AddSeconds($StartupWaitSec)
$health = $null
do {
  try {
    $health = Invoke-RestMethod -Uri "$baseUrl/global/health" -TimeoutSec 2
  } catch {
    if ((Get-Date) -ge $deadline) {
      Fail-Steer "OpenCode's control server at $baseUrl did not become ready within ${StartupWaitSec}s."
    }
    Start-Sleep -Milliseconds 250
  }
} while (-not $health)

try {
  $sessions = @(Invoke-RestMethod -Uri "$baseUrl/session?directory=$directory" -TimeoutSec 5)
  $statuses = Invoke-RestMethod -Uri "$baseUrl/session/status?directory=$directory" -TimeoutSec 5
} catch {
  Fail-Steer "could not query the active OpenCode session: $_"
}

$busyIds = @(
  $statuses.PSObject.Properties |
    Where-Object { $_.Value.type -eq 'busy' } |
    ForEach-Object { $_.Name }
)

$startedUnixMs = if ($state.startedUnixMs) { [int64]$state.startedUnixMs } else { 0 }
$candidates = @(
  $sessions | Where-Object {
    $_.id -in $busyIds -and
    $_.directory -eq $state.repo -and
    -not $_.parentID -and
    ($startedUnixMs -le 0 -or [int64]$_.time.created -ge ($startedUnixMs - 10000))
  } | Sort-Object { [int64]$_.time.updated } -Descending
)

if ($candidates.Count -eq 0) {
  Fail-Steer 'no busy top-level session belongs to the active loop iteration (it may be between sessions).'
}
if ($candidates.Count -gt 1) {
  Fail-Steer "more than one active top-level session matched; refusing to guess: $($candidates.id -join ', ')"
}

$session = $candidates[0]
$body = @{ parts = @(@{ type = 'text'; text = $text }) } | ConvertTo-Json -Depth 5
$sessionId = [uri]::EscapeDataString([string]$session.id)

try {
  Invoke-WebRequest `
    -Uri "$baseUrl/session/$sessionId/prompt_async?directory=$directory" `
    -Method Post `
    -ContentType 'application/json; charset=utf-8' `
    -Body $body `
    -TimeoutSec 10 | Out-Null
} catch {
  Fail-Steer "OpenCode rejected the message: $_"
}

Write-Host "[steer] queued for session $($session.id): $text" -ForegroundColor Green
