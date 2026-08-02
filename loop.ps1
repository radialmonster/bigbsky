# loop.ps1 -- watchdog-driven autonomous opencode loop
#
# Replaces a blind `start /wait cmd /c "opencode run --auto < nextsessionprompt.md"`
# loop with watchdog and process-cleanup guards:
#   - idle watchdog: kill the session + its process tree after IdleKillMinutes
#     without output (prevents a silent child from hanging the loop forever)
#   - hard per-iteration cap (HardTimeoutMinutes)
#   - child-PID tracking + orphan reaping so dev servers (Vite, etc.) spawned by
#     the agent can't hold the stdout pipe open and block the loop forever
#   - pre-iteration orphan sweep (stale opencode/node for this repo)
#   - heartbeat status lines + run.log so a silent session is visible
#   - graceful stop: Q key or .loop-tmp/stop-after.flag
#   - single-instance mutex per repo
#
# Usage:
#   pwsh -NoProfile -ExecutionPolicy Bypass -File loop.ps1 [-DelayMinutes 10]
#        [-IdleKillMinutes 15] [-HardTimeoutMinutes 120] [-MaxIterations N]
#        [-ControlPort 4096]
#
# While a session is running, steer it from another terminal with:
#   .\steer-loop.ps1 "Your correction or new instruction"
# Or press S in the loop terminal, type the message, and press Enter.
#
# loop.bat in this directory is a thin wrapper around this file.

param(
  [int]$DelayMinutes      = 10,
  [int]$IdleKillMinutes   = 15,
  [int]$HardTimeoutMinutes = 120,
  [string]$PromptFile     = 'nextsessionprompt.md',
  [string]$LauncherCommand = 'opencode run --auto',
  [ValidateRange(0, 65535)]
  [int]$ControlPort       = 4096,  # 0 disables live steering
  [int]$MaxIterations     = 0,     # 0 = run until stopped
  [int]$SleepBetweenSec   = 60
)

# ============================================================================
# Globals / settings
# ============================================================================
$ErrorActionPreference   = 'Continue'
$Utf8NoBom               = [System.Text.UTF8Encoding]::new($false)
try {
  # opencode emits UTF-8. Process defaults on Windows can otherwise decode the
  # redirected bytes with an OEM code page, producing strings such as ΓåÆ.
  [Console]::InputEncoding  = $Utf8NoBom
  [Console]::OutputEncoding = $Utf8NoBom
  $global:OutputEncoding    = $Utf8NoBom
} catch {}
$bar                     = '=' * 80
$root                    = $PSScriptRoot
$promptPath              = Join-Path $root $PromptFile
$logPath                 = Join-Path $root 'run.log'
$tempDir                 = Join-Path $root '.loop-tmp'
$stopFlagPath            = Join-Path $tempDir 'stop-after.flag'
$lastKilledPath          = Join-Path $tempDir 'last-killed.txt'
$activeSessionPath       = Join-Path $tempDir 'active-session.json'
$HardTimeoutSec          = $HardTimeoutMinutes * 60
$IdleKillSec             = $IdleKillMinutes * 60
$NoOutputStatusSec       = 120    # heartbeat while agent is silent; does not kill
$HintIntervalSec         = 30     # keep the active-session key menu near the visible output
$ChildDrainTimeoutSec    = 5      # after cmd exits, give children time to flush before force-kill
$ChildScanIntervalSec    = 15     # WMI is slow; keep it off the hot output path as much as possible
$OrphanSweepPids         = @()    # pids swept last iteration (for logging only)
$LogMaxBytes             = 50MB
$LogKeepDays             = 14
$EffectiveLauncherCommand = $LauncherCommand

if ($ControlPort -gt 0) {
  if ($LauncherCommand -match '(?i)(?:^|\s)--attach(?:\s|=|$)') {
    throw '-ControlPort cannot be combined with a LauncherCommand that uses --attach.'
  }
  $portMatch = [regex]::Match($LauncherCommand, '(?i)(?:^|\s)--port(?:\s+|=)(\d+)')
  if ($portMatch.Success) {
    $launcherPort = [int]$portMatch.Groups[1].Value
    if ($launcherPort -ne $ControlPort) {
      throw "LauncherCommand uses port $launcherPort but -ControlPort is $ControlPort. Make them match or set -ControlPort 0."
    }
  } else {
    $EffectiveLauncherCommand = "$LauncherCommand --port $ControlPort"
  }
}

if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Path $tempDir -Force | Out-Null }

$script:logWriter = $null

function Open-LogWriter {
  if ($script:logWriter) { return }
  try {
    $stream = [System.IO.FileStream]::new(
      $logPath,
      [System.IO.FileMode]::Append,
      [System.IO.FileAccess]::Write,
      [System.IO.FileShare]::ReadWrite
    )
    $script:logWriter = [System.IO.StreamWriter]::new($stream, $Utf8NoBom, 4096, $false)
    $script:logWriter.AutoFlush = $true
  } catch {
    $script:logWriter = $null
  }
}

function Close-LogWriter {
  try { if ($script:logWriter) { $script:logWriter.Flush(); $script:logWriter.Dispose() } } catch {}
  $script:logWriter = $null
}

function Rotate-LogIfNeeded {
  try {
    if (-not (Test-Path $logPath)) { return }
    $info = Get-Item $logPath -ErrorAction SilentlyContinue
    if ($null -eq $info -or $info.Length -lt $LogMaxBytes) { return }
    Close-LogWriter
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
  # Remove complete ANSI CSI/OSC sequences. Removing only ESC leaves visible
  # fragments such as "[31;1m" in both the terminal and run.log.
  $normalized = $normalized -replace '\x1B\[[0-?]*[ -/]*[@-~]', ''
  $normalized = $normalized -replace '\x1B\][^\x07]*(?:\x07|\x1B\\)', ''
  $normalized = $normalized -replace '[\x00-\x08\x0B\x0C\x0E-\x19\x1B-\x1F]', ''
  return $normalized
}

function Get-LogStamp {
  return '[' + (Get-Date -Format 'HH:mm:ss.fff') + '] '
}

function Write-Both {
  param([string]$Text, [System.ConsoleColor]$Color = [System.ConsoleColor]::Gray)
  $Text = Normalize-LoopText $Text
  try { Write-Host $Text -ForegroundColor $Color } catch { Write-Host $Text }
  try { Open-LogWriter; $script:logWriter.WriteLine((Get-LogStamp) + $Text) } catch {}
}

function Append-Log {
  param([string]$Text, [switch]$NoNewline)
  $Text = Normalize-LoopText $Text
  try {
    Open-LogWriter
    if ($NoNewline) { $script:logWriter.Write($Text) }
    else            { $script:logWriter.WriteLine((Get-LogStamp) + $Text) }
  } catch {}
}

function Stop-ProcessTree {
  param([int]$RootPid)
  if ($RootPid -le 0) { return }
  try {
    # .NET's tree kill is both faster and more reliable than one WMI query per
    # descendant. Keep the recursive fallback for older runtimes.
    $rootProcess = [System.Diagnostics.Process]::GetProcessById($RootPid)
    $rootProcess.Kill($true)
    return
  } catch {}
  try {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$RootPid" -ErrorAction SilentlyContinue
    foreach ($c in $children) { Stop-ProcessTree -RootPid $c.ProcessId }
  } catch {}
  try { Stop-Process -Id $RootPid -Force -ErrorAction SilentlyContinue } catch {}
}

function Get-DescendantProcessIds {
  param([int]$RootPid)
  $seen = New-Object System.Collections.Generic.HashSet[int]
  try {
    # Single WMI snapshot + in-memory parent map, instead of a recursive WMI
    # query per parent (which stalled the read loop for seconds per cycle).
    $childrenOf = @{}
    foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
      $ppid = [int]$p.ParentProcessId
      $pid  = [int]$p.ProcessId
      if (-not $childrenOf.ContainsKey($ppid)) { $childrenOf[$ppid] = New-Object System.Collections.Generic.List[int] }
      $childrenOf[$ppid].Add($pid)
    }
    $queue = New-Object System.Collections.Generic.Queue[int]
    [void]$queue.Enqueue($RootPid)
    while ($queue.Count -gt 0) {
      $parentPid = $queue.Dequeue()
      if ($childrenOf.ContainsKey($parentPid)) {
        foreach ($childPid in $childrenOf[$parentPid]) {
          if ($seen.Add($childPid)) { [void]$queue.Enqueue($childPid) }
        }
      }
    }
  } catch {}
  return @($seen)
}

function Save-ActiveSession {
  param([System.Diagnostics.Process]$Process)
  try {
    $started = $Process.StartTime.ToUniversalTime()
    $state = [ordered]@{
      repo               = $root
      pid                = $Process.Id
      startedFileTimeUtc = $started.ToFileTimeUtc()
      startedUnixMs      = [DateTimeOffset]::new($started).ToUnixTimeMilliseconds()
      controlPort        = $ControlPort
      controlUrl         = if ($ControlPort -gt 0) { "http://127.0.0.1:$ControlPort" } else { $null }
    }
    $state | ConvertTo-Json | Set-Content -LiteralPath $activeSessionPath -Encoding UTF8
  } catch {
    Write-Both "[loop] could not save active-session state (non-fatal): $_" DarkYellow
  }
}

function Clear-ActiveSession {
  param([int]$ExpectedPid = 0)
  if (-not (Test-Path -LiteralPath $activeSessionPath)) { return }
  if ($ExpectedPid -gt 0) {
    try {
      $state = Get-Content -Raw -LiteralPath $activeSessionPath | ConvertFrom-Json
      if ([int]$state.pid -ne $ExpectedPid) { return }
    } catch {}
  }
  Remove-Item -LiteralPath $activeSessionPath -Force -ErrorAction SilentlyContinue
}

function Reap-TrackedSession {
  if (-not (Test-Path -LiteralPath $activeSessionPath)) { return }
  try {
    $state = Get-Content -Raw -LiteralPath $activeSessionPath | ConvertFrom-Json
    if ($state.repo -ne $root -or [int]$state.pid -le 0) {
      throw 'state does not identify this repository'
    }
    $trackedPid = [int]$state.pid
    $tracked = Get-Process -Id $trackedPid -ErrorAction SilentlyContinue
    if ($tracked) {
      $expectedFileTime = [int64]$state.startedFileTimeUtc
      $actualFileTime = [int64]$tracked.StartTime.ToFileTimeUtc()
      $startDeltaSec = [math]::Abs(($actualFileTime - $expectedFileTime) / 10000000.0)
      if ($expectedFileTime -le 0 -or $startDeltaSec -gt 2) {
        throw "PID $trackedPid was reused; creation time differs by $([math]::Round($startDeltaSec, 3))s"
      }
      Write-Both "[loop] reaping tracked session left by an interrupted wrapper: $($tracked.ProcessName) (PID $trackedPid)" Yellow
      Stop-ProcessTree -RootPid $trackedPid
    }
    Clear-ActiveSession -ExpectedPid $trackedPid
  } catch {
    Write-Both "[loop] tracked-session cleanup skipped: $_" Red
  }
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
$script:activeRootPid = 0
Register-EngineEvent PowerShell.Exiting -Action {
  try {
    if ($script:activeRootPid -gt 0) {
      [System.Diagnostics.Process]::GetProcessById($script:activeRootPid).Kill($true)
    }
  } catch {}
  try { if ($script:logWriter) { $script:logWriter.Flush(); $script:logWriter.Dispose() } } catch {}
  try {
    if ($script:activeRootPid -gt 0 -and (Test-Path -LiteralPath $activeSessionPath)) {
      Remove-Item -LiteralPath $activeSessionPath -Force -ErrorAction SilentlyContinue
    }
  } catch {}
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
      } elseif ($k.Key -eq [ConsoleKey]::S) {
        Write-Both '' Cyan
        if ($script:activeRootPid -le 0) {
          Write-Both '[loop] STEER unavailable -- no session is currently running.' Yellow
          continue
        }
        try {
          $steerText = (Read-Host '[loop] STEER message').Trim()
          if (-not $steerText) {
            Write-Both '[loop] STEER cancelled -- message was empty.' Yellow
            continue
          }
          $steerScript = Join-Path $root 'steer-loop.ps1'
          if (-not (Test-Path -LiteralPath $steerScript)) {
            Write-Both "[loop] STEER failed -- helper not found: $steerScript" Red
            continue
          }
          $pwsh = (Get-Command pwsh -ErrorAction Stop).Source
          & $pwsh -NoProfile -ExecutionPolicy Bypass -File $steerScript -Message $steerText
          if ($LASTEXITCODE -ne 0) {
            Write-Both "[loop] STEER helper failed (exit $LASTEXITCODE)." Red
          }
          Show-HintBannerThrottled -Force
        } catch {
          Write-Both "[loop] STEER failed: $_" Red
          Show-HintBannerThrottled -Force
        }
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
  if (-not $Force -and ($now - $script:lastHintAt).TotalSeconds -lt $HintIntervalSec) { return }
  $script:lastHintAt = $now
  if ($script:stopRequested) { return }
  try { Write-Host '' } catch {}
  Write-Host '  -- S = steer session  |  Q = stop after session  |  P = pause/resume  |  N = skip wait  |  Ctrl+C = abort --' -ForegroundColor DarkGray
  Append-Log -Text '  -- S = steer session  |  Q = stop after session  |  P = pause/resume  |  N = skip wait  |  Ctrl+C = abort --'
}

# ============================================================================
# Pre-iteration orphan sweep: kill stale opencode/node processes for this repo.
# Mirrors loop.ps1's port/node cleanup but scoped to this project root.
# ============================================================================
function Sweep-Orphans {
  $swept = @()
  $escapedRoot = [regex]::Escape($root)
  Reap-TrackedSession
  try {
    $candidates = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -match $escapedRoot }
    foreach ($c in $candidates) {
      $name = $c.Name
      # Skip our own process and cmd.exe wrappers; target stale agent/dev processes.
      if ($c.ProcessId -eq $PID) { continue }
      $isTrackedRuntime = $name -in @('opencode.exe', 'node.exe', 'npm.exe', 'npx.exe')
      $isLauncher = $name -eq 'cmd.exe' -and $c.CommandLine -match [regex]::Escape($promptPath)
      if ($isTrackedRuntime -or $isLauncher) {
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
Write-Both "[loop.ps1] starting at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" Magenta
Write-Both "[loop.ps1] repo:        $root" DarkGray
Write-Both "[loop.ps1] prompt:      $PromptFile" DarkGray
Write-Both "[loop.ps1] delay:       ${DelayMinutes}m between sessions" DarkGray
Write-Both "[loop.ps1] idle kill:   ${IdleKillMinutes}m without output" DarkGray
Write-Both "[loop.ps1] hard cap:    ${HardTimeoutMinutes}m per session" DarkGray
if ($ControlPort -gt 0) {
  Write-Both ('[loop.ps1] steering:    .\steer-loop.ps1 "message" (localhost:{0})' -f $ControlPort) DarkGray
} else {
  Write-Both '[loop.ps1] steering:    disabled (-ControlPort 0)' DarkGray
}
if ($MaxIterations -gt 0) { Write-Both "[loop.ps1] max iterations: $MaxIterations" DarkGray }
Write-Both "[loop.ps1] logging to:  $logPath" DarkGray
Write-Both ''
Write-Both '[loop.ps1] S steers the active session.  Ctrl+C aborts immediately.  Q ends after this session.' Yellow
Write-Both ('[loop.ps1] Or drop a sentinel file: ' + $stopFlagPath) DarkGray
Write-Both '             (touch it from another window to stop cleanly)' DarkGray
Write-Both ''

if (Test-Path $stopFlagPath) { Remove-Item $stopFlagPath -ErrorAction SilentlyContinue }

# ============================================================================
# Main loop
# ============================================================================
$iter = 0
$script:anySessionFailed = $false
Acquire-LoopLock
try {
while ($true) {
  $iter++
  $sessionFailed = $false
  $sessionStopRequested = $false
  $aborted = $false
  $abortReason = ''
  $sessionRootPid = 0
  $sessionCleaned = $false
  $proc = $null
  $stdout = $null
  $stderr = $null
  $pendingRead = $null
  $pendingErrRead = $null
  $knownChildPids = New-Object System.Collections.Generic.HashSet[int]
  try {
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
    # Include the absolute prompt path so a fallback WMI sweep can identify
    # this repo's launcher after an ungraceful wrapper exit.
    $psi.Arguments              = '/d /s /c "' + $EffectiveLauncherCommand + ' < "' + $promptPath + '""'
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.UseShellExecute        = $false
    $psi.CreateNoWindow         = $true
    $psi.WorkingDirectory       = $root
    try {
      $psi.StandardOutputEncoding = $Utf8NoBom
      $psi.StandardErrorEncoding  = $Utf8NoBom
    } catch {}

    Write-Both "[loop] invoking $EffectiveLauncherCommand (prompt: $PromptFile) ..." DarkGray

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $sessionRootPid = $proc.Id
    $script:activeRootPid = $sessionRootPid
    Save-ActiveSession -Process $proc
    $stdout = $proc.StandardOutput
    $stderr = $proc.StandardError

    $iterStart = Get-Date
    $exitDetectedAt = $null
    $exitCleanupAt = $null
    $exitCleanupDone = $false
    $lastChildScanAt = Get-Date
    $lastOutputAt = Get-Date
    $lastNoOutputStatusAt = Get-Date

    # 3) Read loop with idle watchdog + hard cap + orphan tracking.
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
      Write-Host ((Get-LogStamp) + $shown) -ForegroundColor $color
      Append-Log -Text $shown
    }

    while ($true) {
      $now = Get-Date

      # Poll console hotkeys during the active run. This is what makes S/Q/P/N
      # responsive while OpenCode is working rather than only between runs.
      [void](Test-StopRequested)
      Show-HintBannerThrottled

      # Hard cap.
      if (($now - $iterStart).TotalSeconds -ge $HardTimeoutSec) {
        $aborted = $true
        $abortReason = "hard cap ${HardTimeoutSec}s -- killing launcher + descendants"
        break
      }

      # Track child PIDs while alive so we can reap orphans after exit.
      if (-not $proc.HasExited -and ($now - $lastChildScanAt).TotalSeconds -ge $ChildScanIntervalSec) {
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
        $abortReason = "no output for ${IdleKillSec}s -- killing launcher + descendants"
        break
      }

      # Heartbeat while silent (does not kill).
      if (-not $proc.HasExited -and ($now - $lastOutputAt).TotalSeconds -ge $NoOutputStatusSec -and ($now - $lastNoOutputStatusAt).TotalSeconds -ge $NoOutputStatusSec) {
        $silentFor = [int]($now - $lastOutputAt).TotalSeconds
        Write-Both "[loop] waiting: no launcher output for ${silentFor}s; process still alive (watchdog kills at ${IdleKillSec}s silent)." DarkYellow
        $lastNoOutputStatusAt = $now
      }

      if ($proc.HasExited) {
        if ($null -eq $exitDetectedAt) {
          $exitDetectedAt = $now
        }
        $streamsClosed = $stdoutClosed -and $stderrClosed
        $drainExpired = ($now - $exitDetectedAt).TotalSeconds -ge $ChildDrainTimeoutSec
        if (($streamsClosed -or $drainExpired) -and -not $exitCleanupDone) {
          # Do the slow final WMI snapshot only after buffered output is
          # drained (or the drain deadline expires), never before it.
          try {
            foreach ($childPid in @(Get-DescendantProcessIds -RootPid $sessionRootPid)) {
              [void]$knownChildPids.Add([int]$childPid)
            }
          } catch {}
          foreach ($childPid in @($knownChildPids)) {
            try {
              $still = Get-Process -Id $childPid -ErrorAction SilentlyContinue
              if ($still) {
                Write-Both "[loop] launcher exited; reaping orphan child: $($still.ProcessName) (PID $childPid)" DarkYellow
                Stop-ProcessTree -RootPid $childPid
              }
            } catch {}
          }
          $exitCleanupDone = $true
          $exitCleanupAt = Get-Date
        }
        if ($streamsClosed -or ($exitCleanupDone -and ((Get-Date) - $exitCleanupAt).TotalSeconds -ge $ChildDrainTimeoutSec)) {
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
      if ($null -ne $pendingRead) { $finished = $pendingRead.Wait(100) }
      else { Start-Sleep -Milliseconds 100 }
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
    }
    try { $stdout.Dispose() } catch {}
    try { $stderr.Dispose() } catch {}
    try { $proc.Dispose() } catch {}
    Clear-ActiveSession -ExpectedPid $sessionRootPid
    $script:activeRootPid = 0
    $sessionCleaned = $true

    # 5) SESSION COMPLETE banner.
    $endStamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $extra = if ($aborted) { '  WATCHDOG-KILLED' } else { '' }
    Write-Both ''
    Write-Both ''
    Write-Both $bar Green
    Write-Both " SESSION COMPLETE  #$iter   $endStamp   (launcher exit=$exitCode$extra)" Green

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
    if (-not $sessionCleaned -and $sessionRootPid -gt 0) {
      Write-Both "[loop] cleaning process tree after interrupted iteration: PID $sessionRootPid" DarkYellow
      Stop-ProcessTree -RootPid $sessionRootPid
      foreach ($childPid in @($knownChildPids)) { Stop-ProcessTree -RootPid $childPid }
      Clear-ActiveSession -ExpectedPid $sessionRootPid
      $script:activeRootPid = 0
    }
    try { if ($pendingRead) { $pendingRead.Dispose() } } catch {}
    try { if ($pendingErrRead) { $pendingErrRead.Dispose() } } catch {}
    try { if ($stdout) { $stdout.Dispose() } } catch {}
    try { if ($stderr) { $stderr.Dispose() } } catch {}
    try { if ($proc) { $proc.Dispose() } } catch {}
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
} finally {
  if ($script:activeRootPid -gt 0) {
    Stop-ProcessTree -RootPid $script:activeRootPid
    Clear-ActiveSession -ExpectedPid $script:activeRootPid
    $script:activeRootPid = 0
  }
  Release-LoopLock
}

if ($MaxIterations -gt 0 -and $script:anySessionFailed) {
  Write-Both ''
  Write-Both '[loop.ps1] exited after failed bounded session.' Red
  exit 1
}
Write-Both ''
Write-Both '[loop.ps1] exited cleanly.' Magenta
Close-LogWriter
