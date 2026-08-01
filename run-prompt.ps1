# run-prompt.ps1 -- watchdog-driven autonomous opencode loop
#
# Replaces the blind `start /wait cmd /c "opencode run --auto < nextsessionprompt.md"`
# loop with the same guards proven in N:\Projects\agent-dev-loop\loop.ps1:
#   - idle watchdog: kill the session + its process tree after IdleKillMinutes
#     without output (fixes the recurring bigbsky-style dead hang)
#   - hard per-iteration cap (HardTimeoutMinutes)
#   - child-PID tracking + orphan reaping so dev servers (Vite, etc.) spawned by
#     the agent can't hold the stdout pipe open and block the loop forever
#   - pre-iteration orphan sweep (stale opencode/node for this repo)
#   - heartbeat status lines + run.log so a silent session is visible
#   - graceful stop: Q key or .loop-tmp/stop-after.flag
#   - single-instance mutex per repo
#
# Usage:
#   pwsh -NoProfile -ExecutionPolicy Bypass -File run-prompt.ps1 [-DelayMinutes 10]
#        [-IdleKillMinutes 15] [-HardTimeoutMinutes 120] [-MaxIterations N]
#
# run-prompt.bat in this directory is a thin wrapper around this file.

param(
  [int]$DelayMinutes      = 10,
  [int]$IdleKillMinutes   = 15,
  [int]$HardTimeoutMinutes = 120,
  [string]$PromptFile     = 'nextsessionprompt.md',
  [string]$LauncherCommand = 'opencode run --auto',
  [int]$MaxIterations     = 0,     # 0 = run until stopped
  [int]$SleepBetweenSec   = 60
)

# ============================================================================
# Globals / settings
# ============================================================================
$ErrorActionPreference   = 'Continue'
$bar                     = '=' * 80
$root                    = $PSScriptRoot
$promptPath              = Join-Path $root $PromptFile
$logPath                 = Join-Path $root 'run.log'
$tempDir                 = Join-Path $root '.loop-tmp'
$stopFlagPath            = Join-Path $tempDir 'stop-after.flag'
$lastKilledPath          = Join-Path $tempDir 'last-killed.txt'
$HardTimeoutSec          = $HardTimeoutMinutes * 60
$IdleKillSec             = $IdleKillMinutes * 60
$NoOutputStatusSec       = 120    # heartbeat while agent is silent; does not kill
$ChildDrainTimeoutSec    = 5      # after cmd exits, give children time to flush before force-kill
$OrphanSweepPids         = @()    # pids swept last iteration (for logging only)
$LogMaxBytes             = 50MB
$LogKeepDays             = 14

if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Path $tempDir -Force | Out-Null }

function Rotate-LogIfNeeded {
  try {
    if (-not (Test-Path $logPath)) { return }
    $info = Get-Item $logPath -ErrorAction SilentlyContinue
    if ($null -eq $info -or $info.Length -lt $LogMaxBytes) { return }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $rotated = "$logPath.$stamp"
    if (Test-Path $rotated) { $rotated = "$logPath.$stamp-$([guid]::NewGuid().ToString('N').Substring(0,6))" }
    Move-Item -Path $logPath -Destination $rotated -Force -ErrorAction SilentlyContinue
    $cutoff = (Get-Date).AddDays(-$LogKeepDays)
    Get-ChildItem -Path (Split-Path $logPath -Parent) -Filter ((Split-Path $logPath -Leaf) + '.*') -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -lt $cutoff } |
      ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
  } catch {}
}

Rotate-LogIfNeeded

# ============================================================================
# Helpers
# ============================================================================
function Normalize-LoopText {
  param([AllowNull()][string]$Text)
  if ($null -eq $Text) { return '' }
  $normalized = $Text
  $normalized = $normalized.Replace([string][char]0x001A, ' - ')
  $normalized = $normalized.Replace([string][char]0x2426, ' - ')
  $normalized = $normalized -replace '[\x00-\x08\x0B\x0C\x0E-\x19\x1B-\x1F]', ''
  return $normalized
}

function Write-Both {
  param([string]$Text, [System.ConsoleColor]$Color = [System.ConsoleColor]::Gray)
  $Text = Normalize-LoopText $Text
  try { Write-Host $Text -ForegroundColor $Color } catch { Write-Host $Text }
  try { Add-Content -Path $logPath -Value $Text -Encoding UTF8 -ErrorAction SilentlyContinue } catch {}
}

function Append-Log {
  param([string]$Text, [switch]$NoNewline)
  $Text = Normalize-LoopText $Text
  try {
    if ($NoNewline) { Add-Content -Path $logPath -Value $Text -NoNewline -Encoding UTF8 -ErrorAction SilentlyContinue }
    else            { Add-Content -Path $logPath -Value $Text                -Encoding UTF8 -ErrorAction SilentlyContinue }
  } catch {}
}

function Stop-ProcessTree {
  param([int]$RootPid)
  try {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$RootPid" -ErrorAction SilentlyContinue
    foreach ($c in $children) { Stop-ProcessTree -RootPid $c.ProcessId }
  } catch {}
  try { Stop-Process -Id $RootPid -Force -ErrorAction SilentlyContinue } catch {}
}

function Get-DescendantProcessIds {
  param([int]$RootPid)
  $seen = New-Object System.Collections.Generic.HashSet[int]
  $queue = New-Object System.Collections.Generic.Queue[int]
  [void]$queue.Enqueue($RootPid)
  while ($queue.Count -gt 0) {
    $parentPid = $queue.Dequeue()
    try {
      $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$parentPid" -ErrorAction SilentlyContinue
      foreach ($child in @($children)) {
        $childPid = [int]$child.ProcessId
        if ($seen.Add($childPid)) {
          [void]$queue.Enqueue($childPid)
        }
      }
    } catch {}
  }
  return @($seen)
}

# ============================================================================
# Single-instance guard (per repo path)
# ============================================================================
$repoHashBytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant()))
$repoHash = ([BitConverter]::ToString($repoHashBytes)).Replace('-', '').Substring(0, 16)
$mutexName = "Global\RunPromptLoop_$repoHash"
try {
  $script:loopMutex = New-Object System.Threading.Mutex($false, $mutexName)
} catch {
  $mutexName = "Local\RunPromptLoop_$repoHash"
  $script:loopMutex = New-Object System.Threading.Mutex($false, $mutexName)
}
$script:loopMutexHeld = $false
Register-EngineEvent PowerShell.Exiting -Action {
  try {
    if ($script:loopMutexHeld -and $script:loopMutex) { $script:loopMutex.ReleaseMutex() }
    if ($script:loopMutex) { $script:loopMutex.Dispose() }
  } catch {}
} | Out-Null

function Acquire-LoopLock {
  while (-not $script:loopMutexHeld) {
    try {
      $script:loopMutexHeld = $script:loopMutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
      $script:loopMutexHeld = $true
    }
    if (-not $script:loopMutexHeld) {
      Write-Both "[loop] another loop instance is active for $root; waiting 30s before retry..." Yellow
      for ($i = 30; $i -ge 1; $i--) {
        Start-Sleep -Seconds 1
        [void](Test-StopRequested)
        if ($script:stopRequested) { return }
      }
    }
  }
  Write-Both "[loop] loop lock acquired for repo: $root" DarkGray
}

function Release-LoopLock {
  if (-not $script:loopMutexHeld) { return }
  try {
    $script:loopMutex.ReleaseMutex()
    $script:loopMutexHeld = $false
    Write-Both '[loop] loop lock released.' DarkGray
  } catch {}
}

# ============================================================================
# Stop-request helpers
# ============================================================================
$script:stopRequested = $false
$script:pauseRequested = $false
$script:skipSleepRequested = $false
$script:lastHintAt = [DateTime]::MinValue

function Test-StopRequested {
  if ($script:stopRequested) { return $true }
  if (Test-Path $stopFlagPath) {
    $script:stopRequested = $true
    Write-Both '' Yellow
    Write-Both '[loop] STOP REQUESTED via stop-after.flag -- finishing this session, then exiting.' Yellow
    return $true
  }
  try {
    while ([Console]::KeyAvailable) {
      $k = [Console]::ReadKey($true)
      if ($k.Key -eq [ConsoleKey]::Q) {
        $script:stopRequested = $true
        Write-Both '' Yellow
        Write-Both '[loop] STOP REQUESTED via Q -- finishing this session, then exiting.' Yellow
        return $true
      } elseif ($k.Key -eq [ConsoleKey]::P) {
        $script:pauseRequested = -not $script:pauseRequested
        Write-Both '' Yellow
        if ($script:pauseRequested) {
          Write-Both '[loop] PAUSE REQUESTED via P -- will pause after this session.' Yellow
        } else {
          Write-Both '[loop] PAUSE CLEARED via P -- loop will continue normally.' Yellow
        }
      } elseif ($k.Key -eq [ConsoleKey]::N) {
        $script:skipSleepRequested = $true
        Write-Both '' Yellow
        Write-Both '[loop] SKIP-WAIT REQUESTED via N -- next session check will start immediately.' Yellow
      }
    }
  } catch {}
  return $false
}

function Wait-WhilePaused {
  while ($script:pauseRequested -and -not $script:stopRequested) {
    try {
      Write-Host -NoNewline "`r  paused. press P to resume, Q to stop after pause, Ctrl+C abort.        "
    } catch {}
    Start-Sleep -Milliseconds 200
    [void](Test-StopRequested)
  }
  try { Write-Host '' } catch {}
}

function Show-HintBannerThrottled {
  param([switch]$Force)
  $now = Get-Date
  if (-not $Force -and ($now - $script:lastHintAt).TotalSeconds -lt 30) { return }
  $script:lastHintAt = $now
  if ($script:stopRequested) { return }
  try { Write-Host '' } catch {}
  Write-Host '  -- Ctrl+C = abort now  |  Q = stop after this session  |  P = pause/resume  |  N = skip wait now --' -ForegroundColor DarkGray
  Append-Log -Text '  -- Ctrl+C = abort now  |  Q = stop after this session  |  P = pause/resume  |  N = skip wait now --'
}

# ============================================================================
# Pre-iteration orphan sweep: kill stale opencode/node processes for this repo.
# Mirrors loop.ps1's port/node cleanup but scoped to this project root.
# ============================================================================
function Sweep-Orphans {
  $swept = @()
  $escapedRoot = [regex]::Escape($root)
  try {
    $candidates = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -match $escapedRoot }
    foreach ($c in $candidates) {
      $name = $c.Name
      # Skip our own process and cmd.exe wrappers; target stale agent/dev processes.
      if ($c.ProcessId -eq $PID) { continue }
      if ($name -in @('opencode.exe', 'node.exe', 'npm.exe', 'npx.exe')) {
        $swept += "`"$($c.Name)`" PID $($c.ProcessId)"
        Stop-ProcessTree -RootPid $c.ProcessId
      }
    }
  } catch {
    Write-Both "[loop] orphan sweep error (non-fatal): $_" Red
  }
  if ($swept.Count -gt 0) {
    Write-Both "[loop] orphan sweep killed: $($swept -join '; ')" Yellow
  } else {
    Write-Both "[loop] orphan sweep: clean." DarkGray
  }
  $script:OrphanSweepPids = $swept
}

# ============================================================================
# Boot beacon
# ============================================================================
if (-not (Test-Path $promptPath)) {
  Write-Host "[loop] FATAL: prompt file not found: '$promptPath'" -ForegroundColor Red
  exit 1
}

Write-Both ''
Write-Both "[run-prompt.ps1] starting at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" Magenta
Write-Both "[run-prompt.ps1] repo:        $root" DarkGray
Write-Both "[run-prompt.ps1] prompt:      $PromptFile" DarkGray
Write-Both "[run-prompt.ps1] delay:       ${DelayMinutes}m between sessions" DarkGray
Write-Both "[run-prompt.ps1] idle kill:   ${IdleKillMinutes}m without output" DarkGray
Write-Both "[run-prompt.ps1] hard cap:    ${HardTimeoutMinutes}m per session" DarkGray
if ($MaxIterations -gt 0) { Write-Both "[run-prompt.ps1] max iterations: $MaxIterations" DarkGray }
Write-Both "[run-prompt.ps1] logging to:  $logPath" DarkGray
Write-Both ''
Write-Both '[run-prompt.ps1] Ctrl+C aborts immediately.  Q ends after this session.' Yellow
Write-Both ('[run-prompt.ps1] Or drop a sentinel file: ' + $stopFlagPath) DarkGray
Write-Both '             (touch it from another window to stop cleanly)' DarkGray
Write-Both ''

if (Test-Path $stopFlagPath) { Remove-Item $stopFlagPath -ErrorAction SilentlyContinue }

# ============================================================================
# Main loop
# ============================================================================
$iter = 0
$script:anySessionFailed = $false
while ($true) {
  $iter++
  $sessionFailed = $false
  $sessionStopRequested = $false
  $aborted = $false
  $abortReason = ''
  try {
    Acquire-LoopLock
    if ($script:stopRequested) {
      $sessionStopRequested = $true
      continue
    }

    # 0) Pre-iteration self-heal.
    if (Test-Path $lastKilledPath) {
      $sentinel = Get-Content -Raw -Path $lastKilledPath -ErrorAction SilentlyContinue
      Write-Both '' Red
      Write-Both '[loop] PRIOR ITERATION WAS WATCHDOG-KILLED:' Red
      foreach ($line in ($sentinel -split "`r?`n")) {
        if ($line) { Write-Both "         $line" Red }
      }
      Remove-Item $lastKilledPath -ErrorAction SilentlyContinue
    }
    Rotate-LogIfNeeded
    Sweep-Orphans

    # 1) SESSION START banner.
    $startStamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Both ''
    Write-Both $bar Cyan
    Write-Both " SESSION START   #$iter   $startStamp" Cyan
    Write-Both $bar Cyan
    Write-Both ''
    Show-HintBannerThrottled -Force

    # 2) Spawn opencode exactly like the old bat did.
    $psi                        = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName               = (Get-Command cmd.exe).Source
    $psi.Arguments              = '/d /c "' + $LauncherCommand + ' < "' + $PromptFile + '"'
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.UseShellExecute        = $false
    $psi.CreateNoWindow         = $true
    $psi.WorkingDirectory       = $root

    Write-Both "[loop] invoking $LauncherCommand (prompt: $PromptFile) ..." DarkGray

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $stdout = $proc.StandardOutput
    $stderr = $proc.StandardError

    $iterStart = Get-Date
    $exitDetectedAt = $null
    $knownChildPids = New-Object System.Collections.Generic.HashSet[int]
    $lastChildScanAt = [DateTime]::MinValue
    $lastOutputAt = Get-Date
    $lastNoOutputStatusAt = Get-Date

    # 3) Read loop with idle watchdog + hard cap + orphan tracking.
    $pendingRead = $null
    $pendingErrRead = $null
    $stdoutClosed = $false
    $stderrClosed = $false
    $truncateLine = {
      param([string]$Text, [int]$Max = 240)
      $Text = Normalize-LoopText $Text
      if ($null -eq $Text) { return '' }
      if ($Text.Length -le $Max) { return $Text }
      return $Text.Substring(0, $Max) + '...'
    }
    $emitLine = {
      param($line, [string]$Source = 'stdout')
      if ($null -eq $line -or $line -eq '') { return }
      $shown = & $truncateLine "$line" 240
      $trim = $shown.Trim()
      if ($trim -eq '') { return }
      $color = if ($Source -eq 'stderr') { [System.ConsoleColor]::DarkGray } else { [System.ConsoleColor]::Gray }
      Write-Host $shown -ForegroundColor $color
      Append-Log -Text $shown
    }

    while ($true) {
      $now = Get-Date

      # Hard cap.
      if (($now - $iterStart).TotalSeconds -ge $HardTimeoutSec) {
        $aborted = $true
        $abortReason = "hard cap ${HardTimeoutSec}s -- killing opencode + descendants"
        break
      }

      # Track child PIDs while alive so we can reap orphans after exit.
      if (-not $proc.HasExited -and ($now - $lastChildScanAt).TotalSeconds -ge 2) {
        $lastChildScanAt = $now
        try {
          foreach ($childPid in @(Get-DescendantProcessIds -RootPid $proc.Id)) {
            [void]$knownChildPids.Add([int]$childPid)
          }
        } catch {}
      }

      # Idle watchdog: kill if no output for IdleKillSec.
      if (-not $proc.HasExited -and ($now - $lastOutputAt).TotalSeconds -ge $IdleKillSec) {
        $aborted = $true
        $abortReason = "no output for ${IdleKillSec}s -- killing opencode + descendants"
        break
      }

      # Heartbeat while silent (does not kill).
      if (-not $proc.HasExited -and ($now - $lastOutputAt).TotalSeconds -ge $NoOutputStatusSec -and ($now - $lastNoOutputStatusAt).TotalSeconds -ge $NoOutputStatusSec) {
        $silentFor = [int]($now - $lastOutputAt).TotalSeconds
        Write-Both "[loop] waiting: no opencode output for ${silentFor}s; process still alive (watchdog kills at ${IdleKillSec}s silent)." DarkYellow
        $lastNoOutputStatusAt = $now
      }

      if ($proc.HasExited) {
        if ($null -eq $exitDetectedAt) {
          $exitDetectedAt = $now
          foreach ($childPid in @($knownChildPids)) {
            try {
              $still = Get-Process -Id $childPid -ErrorAction SilentlyContinue
              if ($still) {
                Write-Both "[loop] opencode exited; reaping orphan child: $($still.ProcessName) (PID $childPid)" DarkYellow
                Stop-ProcessTree -RootPid $childPid
              }
            } catch {}
          }
        }
        if (($now - $exitDetectedAt).TotalSeconds -ge $ChildDrainTimeoutSec) {
          try {
            $rest = $stdout.ReadToEnd()
            if ($rest) {
              foreach ($l in ($rest -split "`r?`n")) { & $emitLine $l 'stdout' }
            }
            $errRest = $stderr.ReadToEnd()
            if ($errRest) {
              foreach ($l in ($errRest -split "`r?`n")) { & $emitLine $l 'stderr' }
            }
          } catch {}
          break
        }
      }

      if (-not $stdoutClosed -and $null -eq $pendingRead) {
        try { $pendingRead = $stdout.ReadLineAsync() } catch {
          $stdoutClosed = $true
        }
      }
      if (-not $stderrClosed -and $null -eq $pendingErrRead) {
        try { $pendingErrRead = $stderr.ReadLineAsync() } catch {
          $stderrClosed = $true
        }
      }

      $finished = $false
      if ($null -ne $pendingRead) { $finished = $pendingRead.Wait(1000) }
      else { Start-Sleep -Seconds 1 }
      if ($finished -and $null -ne $pendingRead) {
        $line = $pendingRead.Result
        try { $pendingRead.Dispose() } catch {}
        $pendingRead = $null
        if ($null -eq $line) {
          $stdoutClosed = $true
        } else {
          $lastOutputAt = Get-Date
          $lastNoOutputStatusAt = $lastOutputAt
          & $emitLine $line 'stdout'
        }
      }

      if ($null -ne $pendingErrRead -and $pendingErrRead.IsCompleted) {
        $line = $pendingErrRead.Result
        try { $pendingErrRead.Dispose() } catch {}
        $pendingErrRead = $null
        if ($null -ne $line) {
          $lastOutputAt = Get-Date
          $lastNoOutputStatusAt = $lastOutputAt
          & $emitLine $line 'stderr'
        } else {
          $stderrClosed = $true
        }
      }
    }

    # 4) Post-session cleanup.
    if ($aborted) {
      Write-Both ''
      Write-Both "[loop] WATCHDOG: $abortReason" Red
      Stop-ProcessTree -RootPid $proc.Id
      try { $proc.WaitForExit(5000) | Out-Null } catch {}
      $sentinelTxt = @(
        "watchdog-killed: yes",
        "iteration: $iter",
        "killed_at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
        "reason: $abortReason"
      ) -join "`n"
      try { Set-Content -Path $lastKilledPath -Value $sentinelTxt -Encoding UTF8 } catch {}
    } else {
      try { $proc.WaitForExit(5000) | Out-Null } catch {}
    }

    try { if ($pendingRead) { $pendingRead.Dispose() } } catch {}
    try { if ($pendingErrRead) { $pendingErrRead.Dispose() } } catch {}

    $exitCode = if ($proc.HasExited) { $proc.ExitCode } else { 'killed' }
    if ($exitCode -ne 0) {
      $sessionFailed = $true
      $script:anySessionFailed = $true
      try {
        if (-not $proc.HasExited) {
          Write-Both "[loop] child process has not exited after stream drain; skipping blocking stderr ReadToEnd." Red
          throw 'child process did not exit cleanly'
        }
        $err = $proc.StandardError.ReadToEnd()
        if ($err) {
          Write-Both '[loop] STDERR:' Red
          $i = 0
          foreach ($line in ($err -split "`r?`n")) {
            if (-not $line) { continue }
            if ($i -lt 8) { Write-Both "         $line" Red }
            $i++
          }
        }
      } catch {}
    }
    try { $stdout.Dispose() } catch {}
    try { $stderr.Dispose() } catch {}
    try { $proc.Dispose() } catch {}

    # 5) SESSION COMPLETE banner.
    $endStamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $extra = if ($aborted) { '  WATCHDOG-KILLED' } else { '' }
    Write-Both ''
    Write-Both ''
    Write-Both $bar Green
    Write-Both " SESSION COMPLETE  #$iter   $endStamp   (opencode exit=$exitCode$extra)" Green

    [void](Test-StopRequested)
    if ($script:stopRequested) {
      Write-Both ' STOP REQUESTED -- exiting loop.  No new iteration will start.' Yellow
      Write-Both $bar Green
      if (Test-Path $stopFlagPath) { Remove-Item $stopFlagPath -ErrorAction SilentlyContinue }
      $sessionStopRequested = $true
    }

  } catch {
    $sessionFailed = $true
    $script:anySessionFailed = $true
    Write-Both '' Red
    Write-Both "[loop] iteration #$iter raised: $_" Red
  } finally {
    Release-LoopLock
  }

  if ($sessionStopRequested) { break }

  if ($MaxIterations -gt 0 -and $iter -ge $MaxIterations) {
    Write-Both "[loop] max iterations reached ($iter/$MaxIterations) -- exiting loop. No new iteration will start." Yellow
    break
  }

  if ($sessionFailed) {
    Write-Both '[loop] session failed; continuing to next iteration in 30s.' Yellow
    Start-Sleep -Seconds 30
    continue
  }

  if ($script:pauseRequested) {
    Write-Both '[loop] pause active; waiting for P to resume before next session.' Yellow
    Wait-WhilePaused
  }
  if ($script:stopRequested) {
    Write-Both '[loop] stop requested while paused -- exiting.' Yellow
    if (Test-Path $stopFlagPath) { Remove-Item $stopFlagPath -ErrorAction SilentlyContinue }
    break
  }

  $script:skipSleepRequested = $false
  Write-Both " Sleeping ${DelayMinutes} minute(s) between sessions.  N = start next now | P = pause/resume | Q = stop after sleep | Ctrl+C abort." Green
  Write-Both $bar Green

  $delayTotal = $DelayMinutes * 60
  for ($i = $delayTotal; $i -ge 1; $i--) {
    try {
      Write-Host -NoNewline ("`r  next iteration in {0,3}s...   [N start now | P pause/resume | Q stop after current | Ctrl+C abort]" -f $i)
    } catch {}
    Start-Sleep -Seconds 1
    [void](Test-StopRequested)
    if ($script:skipSleepRequested) { break }
    if ($script:pauseRequested) {
      Write-Both ''
      Write-Both '[loop] pause requested during countdown.' Yellow
      Wait-WhilePaused
    }
    if ($script:stopRequested) { break }
  }
  Write-Host ''
  if ($script:stopRequested) {
    Write-Both '[loop] stop requested during countdown -- exiting.' Yellow
    if (Test-Path $stopFlagPath) { Remove-Item $stopFlagPath -ErrorAction SilentlyContinue }
    break
  }
  if ($script:skipSleepRequested) {
    Write-Both '[loop] countdown skipped; starting next session now.' Green
    $script:skipSleepRequested = $false
  }
}

if ($MaxIterations -gt 0 -and $script:anySessionFailed) {
  Write-Both ''
  Write-Both '[run-prompt.ps1] exited after failed bounded session.' Red
  exit 1
}
Write-Both ''
Write-Both '[run-prompt.ps1] exited cleanly.' Magenta
