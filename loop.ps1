# loop.ps1 -- autonomous-session driver for Bigbsky
#
# One script for all providers (Codex CLI, native Anthropic,
# DeepSeek-via-Anthropic-API, Ollama-launched). Presets live in $Presets at
# the top of this file -- adding a new model/provider = one new entry.
#
# Two startup menus (preset, prompt file) when run with no args. Last
# choice is remembered in .loop-tmp/last-choice.json and offered as the
# Enter-default next time.
#
# Graceful stop: press Q in the loop window OR drop a sentinel file at
# .loop-tmp/stop-after.flag (use stop-loop.bat). The current session
# finishes; no new iteration starts. Ctrl+C still aborts immediately.
# Use -MaxIterations N to run exactly N sessions and then stop cleanly
# between sessions.
#
# Why timeouts: Claude's Bash tool can start background processes
# (e.g., `pnpm dev`). Those children inherit claude's stdout handle.
# On Windows the pipe stays open until every inheritor closes it, so
# even after claude exits its main work the parent's stdout doesn't
# reach EOF and PowerShell's pipeline blocks forever. We solve it by
# killing claude + all descendants when:
#   - total iteration runtime exceeds HardTimeoutSec, OR
#   - claude emits its final 'result' event but doesn't exit within
#     PostResultGraceSec.

param(
  [string]$Preset     = '',
  [string]$PromptFile = '',
  [string]$Model      = '',  # ollama presets only: override preset's default model
  [int]$MaxIterations = 0,   # 0 = run until stopped
  [int]$SleepBetweenSec = 60 # countdown after each session
)

# ============================================================================
# PRESETS -- edit this list to add/change models. One line per entry.
# ============================================================================
# Provider values:
#   anthropic   -- spawn `claude -p`, prompt via stdin, default env
#   deepseek    -- spawn `claude -p`, prompt via stdin, DeepSeek env vars
#                  injected per child process. Requires $env:DEEPSEEK_API_KEY.
#   ollama      -- spawn `ollama launch claude --model <m> --yes -- -p "<prompt>"`,
#                  prompt via argv, English-only guard prepended.
#   codex       -- spawn `codex exec`, prompt via stdin.
#
# AutoStash:    -- removed. The loop must never move user notes or in-progress
#                  edits into git stash; that made files appear to lose data.
#                  If a run dies, leave the working tree visible.
# AutoPull:     -- intentionally disabled for this script; pulls are never run
#                  automatically. Use `git-pull.bat` manually before starting
#                  a new loop session if you want remote updates first.
$Presets = @(
  @{ Key = 'codex-yolo';                  Name = 'Codex CLI / OpenAI gpt-5.5 medium';        Provider = 'codex'; AutoPull = $false }
  @{ Key = 'codex-spark';                 Name = 'Codex CLI / OpenAI gpt-5.3-codex spark';  Provider = 'codex'; Model = 'gpt-5.3-codex-spark'; AutoPull = $false }
  @{ Key = 'anthropic-opus';              Name = 'Claude Code / Anthropic / claude-opus-4-7 1M';        Provider = 'anthropic'; AutoPull = $false
     Env = @{ ANTHROPIC_MODEL = 'claude-opus-4-7' }
  }
  @{ Key = 'anthropic-sonnet';            Name = 'Claude Code / Anthropic / claude-sonnet-4-6';          Provider = 'anthropic'; AutoPull = $false
     Env = @{ ANTHROPIC_MODEL = 'claude-sonnet-4-6' }
  }
  @{ Key = 'deepseek-api';                Name = 'Claude Code / DeepSeek API deepseek-v4-pro 1M';       Provider = 'deepseek';  AutoPull = $false
     Env = @{
       ANTHROPIC_BASE_URL              = 'https://api.deepseek.com/anthropic'
       ANTHROPIC_MODEL                 = 'deepseek-v4-pro[1m]'
       ANTHROPIC_DEFAULT_OPUS_MODEL    = 'deepseek-v4-pro[1m]'
       ANTHROPIC_DEFAULT_SONNET_MODEL  = 'deepseek-v4-pro[1m]'
       ANTHROPIC_DEFAULT_HAIKU_MODEL   = 'deepseek-v4-flash'
       CLAUDE_CODE_SUBAGENT_MODEL      = 'deepseek-v4-flash'
       CLAUDE_CODE_EFFORT_LEVEL        = 'max'
     }
  }
  @{ Key = 'ollama-deepseek-v4-pro-cloud';   Name = 'Ollama Cloud / DeepSeek deepseek-v4-pro:cloud';   Provider = 'ollama'; Model = 'deepseek-v4-pro:cloud';   AutoPull = $false }
  @{ Key = 'ollama-deepseek-v4-flash-cloud'; Name = 'Ollama Cloud / DeepSeek deepseek-v4-flash:cloud'; Provider = 'ollama'; Model = 'deepseek-v4-flash:cloud'; AutoPull = $false }
  @{ Key = 'ollama-gemma4-31b-cloud';        Name = 'Ollama Cloud / Google gemma4:31b-cloud';          Provider = 'ollama'; Model = 'gemma4:31b-cloud';        AutoPull = $false }
  @{ Key = 'ollama-glm';                     Name = 'Ollama Cloud / Zhipu GLM glm-5.1:cloud';          Provider = 'ollama'; Model = 'glm-5.1:cloud';           AutoPull = $false }
  @{ Key = 'ollama-kimi';                    Name = 'Ollama Cloud / Moonshot Kimi kimi-k2.6:cloud';    Provider = 'ollama'; Model = 'kimi-k2.6:cloud';         AutoPull = $false }
)

# ============================================================================
# Globals / settings
# ============================================================================
$ErrorActionPreference   = 'Continue'
$bar                     = '=' * 80
$logPath                 = Join-Path $PSScriptRoot 'loop.log'
$HardTimeoutSec          = 7200   # 2 hr safety cap per iteration
$NoOutputStatusSec       = 120    # status-only heartbeat while agent is silent; does not kill
$ShowCodexStderr         = $false # Codex plain text mirrors full transcript on stderr; show filtered progress unless enabled
$ChildDrainTimeoutSec    = 5      # after claude exits, give children this long to flush before forcing kill
$PostResultGraceSec      = 30     # after result event, wait this long for clean exit before requesting graceful close
$PostResultCloseWaitSec  = 10     # after graceful-close request, wait this long before force-kill
$HintEverySec            = 30     # min seconds between in-session hint banners
$tempDir                 = Join-Path $PSScriptRoot '.loop-tmp'
$stopFlagPath            = Join-Path $tempDir 'stop-after.flag'
$lastChoicePath          = Join-Path $tempDir 'last-choice.json'
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Path $tempDir -Force | Out-Null }

$githubCliDir = 'C:\Program Files\GitHub CLI'
if ((Test-Path (Join-Path $githubCliDir 'gh.exe')) -and
    (($env:Path -split ';') -notcontains $githubCliDir)) {
  $env:Path = "$githubCliDir;$env:Path"
}

# Single-instance guard (per repo path): prevents two loop.ps1 runners from
# competing and killing each other's child processes for the full script run.
# If another instance is active, wait in 30s intervals until the lock becomes
# available.
$repoHashBytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($PSScriptRoot.ToLowerInvariant()))
$repoHash = ([BitConverter]::ToString($repoHashBytes)).Replace('-', '').Substring(0, 16)
$mutexName = "Global\BigbskyLoop_$repoHash"
try {
  $script:loopMutex = New-Object System.Threading.Mutex($false, $mutexName)
} catch {
  # Constrained environments (some scheduled tasks, services, containers)
  # lack SeCreateGlobalPrivilege. Fall back to a session-local mutex so the
  # loop still has single-instance protection within the current session.
  $mutexName = "Local\BigbskyLoop_$repoHash"
  $script:loopMutex = New-Object System.Threading.Mutex($false, $mutexName)
}
$script:loopMutexHeld = $false
Register-EngineEvent PowerShell.Exiting -Action {
  try {
    if ($script:loopMutexHeld -and $script:loopMutex) { $script:loopMutex.ReleaseMutex() }
    if ($script:loopMutex) { $script:loopMutex.Dispose() }
  } catch {}
} | Out-Null

# ============================================================================
# Helpers
# ============================================================================
function Quote-Arg {
  param([string]$Value)
  if ($null -eq $Value) { return '""' }
  return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function Normalize-LoopText {
  param([AllowNull()][string]$Text)
  if ($null -eq $Text) { return '' }
  $normalized = $Text
  # Some CLIs emit ASCII SUB (0x1A), which renders as the visible "SUB"
  # symbol in newer terminals. Treat it as a separator instead of mojibake.
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

function Test-InfraBlockText {
  param([AllowNull()][string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  return $Text -match '(?i)(model is at capacity|selected model is at capacity|rate limit|rate-limit|usage limit|usage cap|hit your limit|quota exceeded|insufficient quota|try a different model|provider capacity|temporarily unavailable|overloaded)'
}

function Mark-InfraBlockedFromLoop {
  param([string]$Reason)
  $scriptPath = Join-Path $PSScriptRoot 'scripts\github-loop\mark-infra-blocked.ps1'
  if (!(Test-Path $scriptPath)) {
    Write-Both "[loop] infra-block detected but marker script is missing: $scriptPath" Red
    return
  }
  try {
    Write-Both "[loop] infra-block detected; releasing any active GitHub claim." Yellow
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $scriptPath -Reason $Reason
  } catch {
    Write-Both "[loop] infra-block marker failed: $_" Red
  }
}

function Retry-InfraBlockedIssues {
  $scriptPath = Join-Path $PSScriptRoot 'scripts\github-loop\retry-infra-blocked.ps1'
  if (!(Test-Path $scriptPath)) { return }
  $cooldown = 30
  if ($env:BIGBSKY_INFRA_RETRY_MINUTES -match '^\d+$') {
    $cooldown = [int]$env:BIGBSKY_INFRA_RETRY_MINUTES
  }
  try {
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $scriptPath -CooldownMinutes $cooldown
  } catch {
    Write-Both "[loop] infra-block retry sweep failed (non-fatal): $_" Yellow
  }
}

function Stop-ProcessTree {
  param([int]$RootPid)
  try {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$RootPid" -ErrorAction SilentlyContinue
    foreach ($c in $children) { Stop-ProcessTree -RootPid $c.ProcessId }
  } catch {}
  try { Stop-Process -Id $RootPid -Force -ErrorAction SilentlyContinue } catch {}
}

function Request-GracefulExit {
  param([System.Diagnostics.Process]$Process, [string]$Name = 'process')
  if ($null -eq $Process) { return $false }
  if ($Process.HasExited) { return $true }
  $requested = $false
  try {
    # Ensure stdin is closed in case the child is still waiting for input EOF.
    $Process.StandardInput.Close()
    $requested = $true
  } catch {}
  try {
    # If a main window exists, ask it to close before forcing termination.
    if ($Process.MainWindowHandle -ne 0) {
      if ($Process.CloseMainWindow()) { $requested = $true }
    }
  } catch {}
  if ($requested) {
    Write-Both "[loop] requested graceful $Name shutdown after result event." DarkGray
  }
  return $requested
}

function Resolve-LauncherCommand {
  param([string]$Name)
  if ($Name -eq 'codex' -and ($PSVersionTable.PSVersion -lt '6.0' -or $IsWindows)) {
    $cmd = Get-Command 'codex.cmd' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd }
  }
  return Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Acquire-LoopLock {
  while (-not $script:loopMutexHeld) {
    try {
      $script:loopMutexHeld = $script:loopMutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
      $script:loopMutexHeld = $true
    }

    if (-not $script:loopMutexHeld) {
      Write-Both "[loop] another loop instance is active for this repo; waiting 30s before retry..." Yellow
      for ($i = 30; $i -ge 1; $i--) {
        Start-Sleep -Seconds 1
        [void](Test-StopRequested)
        if ($script:pauseRequested -and -not $script:stopRequested) {
          Write-Both '[loop] pause requested while waiting for lock.' Yellow
          Wait-WhilePaused
        }
        if ($script:stopRequested) { return }
      }
    }
  }
  Write-Both "[loop] loop lock acquired for repo: $PSScriptRoot" DarkGray
}

function Release-LoopLock {
  if (-not $script:loopMutexHeld) { return }
  try {
    $script:loopMutex.ReleaseMutex()
    $script:loopMutexHeld = $false
    Write-Both '[loop] loop lock released.' DarkGray
  } catch {}
}

# Migration-rescue stub. The repairforge variant of this template had a
# Prisma/Postgres rescue here that ran a `docker exec ... psql` probe and
# replayed stuck migrations via `pnpm --filter '@bigbsky/api' exec prisma
# migrate resolve`. Bigbsky is a frontend-only SvelteKit app on Cloudflare
# Pages with no database of its own, so the rescue is a no-op. Keeping the
# function so the existing call sites in this script stay valid.
function Rescue-PrismaMigrations { }

# ============================================================================
# Last-choice persistence
# ============================================================================
function Load-LastChoice {
  try {
    if (Test-Path $lastChoicePath) {
      return (Get-Content -Raw -Path $lastChoicePath | ConvertFrom-Json -ErrorAction Stop)
    }
  } catch {}
  return $null
}
function Save-LastChoice {
  param([string]$PresetKey, [string]$PromptFileName)
  try {
    @{ preset = $PresetKey; promptFile = $PromptFileName } |
      ConvertTo-Json | Set-Content -Path $lastChoicePath -Encoding UTF8
  } catch {}
}

# ============================================================================
# Startup menus
# ============================================================================
function Show-PresetMenu {
  param($LastKey)
  Write-Host ''
  Write-Host $bar -ForegroundColor Cyan
  Write-Host '  Bigbsky autonomous loop' -ForegroundColor Cyan
  Write-Host $bar -ForegroundColor Cyan
  Write-Host ''
  Write-Host 'Pick a model preset:' -ForegroundColor White
  Write-Host ''
  $defaultIdx = 1
  for ($i = 0; $i -lt $Presets.Count; $i++) {
    $p = $Presets[$i]
    $marker = if ($p.Key -eq $LastKey) { '  [last used]' } else { '' }
    if ($p.Key -eq $LastKey) { $defaultIdx = $i + 1 }
    $color = if ($p.Key -eq $LastKey) { 'Yellow' } else { 'Gray' }
    Write-Host ("  {0,2}) {1}{2}" -f ($i + 1), $p.Name, $marker) -ForegroundColor $color
  }
  Write-Host ''
  Write-Host '   q) quit' -ForegroundColor DarkGray
  Write-Host ''
  while ($true) {
    $resp = Read-Host ("Choice [{0}]" -f $defaultIdx)
    if ([string]::IsNullOrWhiteSpace($resp)) { return $Presets[$defaultIdx - 1] }
    if ($resp -match '^[qQ]$') { Write-Host 'Quitting.' -ForegroundColor DarkGray; exit 0 }
    $n = 0
    if ([int]::TryParse($resp, [ref]$n) -and $n -ge 1 -and $n -le $Presets.Count) {
      return $Presets[$n - 1]
    }
    Write-Host '  invalid choice; try again.' -ForegroundColor Red
  }
}

function Show-PromptMenu {
  param($LastFile)
  $files = @(Get-ChildItem -Path $PSScriptRoot -Filter 'prompt*.txt' -File -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending)
  if ($files.Count -eq 0) {
    Write-Host 'No prompt*.txt files found in repo root.' -ForegroundColor Red
    exit 1
  }
  Write-Host ''
  Write-Host 'Pick a prompt file:' -ForegroundColor White
  Write-Host ''
  $defaultIdx = 1
  for ($i = 0; $i -lt $files.Count; $i++) {
    $f = $files[$i]
    $marker = if ($f.Name -eq $LastFile) { '  [last used]' } else { '' }
    if ($f.Name -eq $LastFile) { $defaultIdx = $i + 1 }
    $color = if ($f.Name -eq $LastFile) { 'Yellow' } else { 'Gray' }
    $mtime = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm')
    Write-Host ("  {0,2}) {1,-30}  (modified {2}){3}" -f ($i + 1), $f.Name, $mtime, $marker) -ForegroundColor $color
  }
  Write-Host ''
  Write-Host '   q) quit' -ForegroundColor DarkGray
  Write-Host ''
  while ($true) {
    $resp = Read-Host ("Choice [{0}]" -f $defaultIdx)
    if ([string]::IsNullOrWhiteSpace($resp)) { return $files[$defaultIdx - 1].Name }
    if ($resp -match '^[qQ]$') { Write-Host 'Quitting.' -ForegroundColor DarkGray; exit 0 }
    $n = 0
    if ([int]::TryParse($resp, [ref]$n) -and $n -ge 1 -and $n -le $files.Count) {
      return $files[$n - 1].Name
    }
    Write-Host '  invalid choice; try again.' -ForegroundColor Red
  }
}

function Ask-SleepBetweenSeconds {
  param([int]$DefaultSeconds = 60)
  while ($true) {
    $resp = Read-Host ("Seconds to wait between loops [{0}]" -f $DefaultSeconds)
    if ([string]::IsNullOrWhiteSpace($resp)) { return $DefaultSeconds }
    $n = 0
    if ([int]::TryParse($resp, [ref]$n) -and $n -ge 1) {
      return $n
    }
    Write-Host '  invalid value; enter a whole number >= 1.' -ForegroundColor Red
  }
}

# ============================================================================
# Resolve preset + prompt file (menus or args)
# ============================================================================
$last = Load-LastChoice

# Preset
$selectedPreset = $null
if ($Preset) {
  $selectedPreset = $Presets | Where-Object { $_.Key -eq $Preset } | Select-Object -First 1
  if (-not $selectedPreset) {
    Write-Host "Unknown preset key: '$Preset'. Known keys: $(@($Presets | ForEach-Object { $_.Key }) -join ', ')" -ForegroundColor Red
    exit 1
  }
} else {
  $lastPresetKey = if ($last) { $last.preset } else { '' }
  $selectedPreset = Show-PresetMenu -LastKey $lastPresetKey
}

# Prompt file
$selectedPrompt = $null
if ($PromptFile) {
  if (-not (Test-Path (Join-Path $PSScriptRoot $PromptFile))) {
    Write-Host "Prompt file not found: $PromptFile" -ForegroundColor Red
    exit 1
  }
  $selectedPrompt = $PromptFile
} else {
  $lastPromptFile = if ($last) { $last.promptFile } else { '' }
  $selectedPrompt = Show-PromptMenu -LastFile $lastPromptFile
}

if ([string]::IsNullOrWhiteSpace($Preset) -and [string]::IsNullOrWhiteSpace($PromptFile)) {
  $SleepBetweenSec = Ask-SleepBetweenSeconds -DefaultSeconds $SleepBetweenSec
}

Save-LastChoice -PresetKey $selectedPreset.Key -PromptFileName $selectedPrompt

# Resolve selected prompt path once; content is intentionally re-read from
# disk at the start of every iteration so prompt edits take effect immediately.
$promptPath = Join-Path $PSScriptRoot $selectedPrompt
if (-not (Test-Path $promptPath)) {
  Write-Host "[loop] FATAL: prompt file not found: '$selectedPrompt'" -ForegroundColor Red
  exit 1
}

# Resolve effective model for ollama (cmdline -Model overrides preset default)
$effectiveModel = if ($Model) { $Model } elseif ($selectedPreset.ContainsKey('Model')) { $selectedPreset.Model } else { '' }
$autoPull = $false   # explicitly disabled

# DeepSeek key check
if ($selectedPreset.Provider -eq 'deepseek') {
  if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) {
    Write-Host ''
    Write-Host '[loop] FATAL: DeepSeek preset selected but $env:DEEPSEEK_API_KEY is not set.' -ForegroundColor Red
    Write-Host '       Set it once in PowerShell, then reopen the terminal:' -ForegroundColor Yellow
    Write-Host '         setx DEEPSEEK_API_KEY "your-deepseek-api-key"' -ForegroundColor Yellow
    exit 1
  }
}

# ============================================================================
# Boot beacon
# ============================================================================
Write-Both ''
Write-Both "[loop.ps1] starting at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" Magenta
Write-Both "[loop.ps1] preset:     $($selectedPreset.Name)  (key=$($selectedPreset.Key), provider=$($selectedPreset.Provider))" DarkGray
if ($effectiveModel) { Write-Both "[loop.ps1] model:      $effectiveModel" DarkGray }
Write-Both "[loop.ps1] prompt:     $selectedPrompt" DarkGray
Write-Both "[loop.ps1] auto-stash: removed; dirty files are never moved into git stash" DarkGray
Write-Both "[loop.ps1] auto-pull:  $(if ($autoPull) { 'enabled' } else { 'disabled' })" DarkGray
Write-Both "[loop.ps1] logging to: $logPath" DarkGray
Write-Both "[loop.ps1] hard cap: ${HardTimeoutSec}s (2 hr safety net; no idle timeout)" DarkGray
Write-Both "[loop.ps1] quiet status: report every ${NoOutputStatusSec}s without output (no auto-kill)" DarkGray
if ($MaxIterations -gt 0) { Write-Both "[loop.ps1] max iterations: $MaxIterations" DarkGray }
Write-Both "[loop.ps1] PS version: $($PSVersionTable.PSVersion)" DarkGray
Write-Both ''
Write-Both '[loop.ps1] Ctrl+C aborts immediately.  Q ends after this session.' Yellow
Write-Both ('[loop.ps1] Or drop a sentinel file: ' + $stopFlagPath) DarkGray
Write-Both '             (use stop-loop.bat from another window)' DarkGray
Write-Both ''

# Clear any stale stop flag from a previous run
if (Test-Path $stopFlagPath) { Remove-Item $stopFlagPath -ErrorAction SilentlyContinue }

# ============================================================================
# Stop-request polling helpers (shared by read-loop and countdown)
# ============================================================================
$script:stopRequested = $false
$script:pauseRequested = $false
$script:skipSleepRequested = $false
$script:lastHintAt    = [DateTime]::MinValue

function Test-StopRequested {
  if ($script:stopRequested) { return $true }
  # Sentinel file
  if (Test-Path $stopFlagPath) {
    $script:stopRequested = $true
    Write-Both '' Yellow
    Write-Both '[loop] STOP REQUESTED via stop-after.flag -- finishing this session, then exiting.' Yellow
    return $true
  }
  # Keypress (only works when stdin is a real console)
  try {
    while ([Console]::KeyAvailable) {
      $k = [Console]::ReadKey($true)
      if ($k.Key -eq [ConsoleKey]::Q) {
        $script:stopRequested = $true
        Write-Both '' Yellow
        Write-Both '[loop] STOP REQUESTED via Q -- finishing this session, then exiting.' Yellow
        Write-Both '         (Ctrl+C still aborts immediately.)' DarkGray
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
  if (-not $Force -and ($now - $script:lastHintAt).TotalSeconds -lt $HintEverySec) { return }
  $script:lastHintAt = $now
  if ($script:stopRequested) { return }   # no point nagging once requested
  try { Write-Host '' } catch {}
  Write-Host '  -- Ctrl+C = abort now  |  Q = stop after this session  |  P = pause/resume  |  N = skip wait now --' -ForegroundColor DarkGray
  Append-Log -Text '  -- Ctrl+C = abort now  |  Q = stop after this session  |  P = pause/resume  |  N = skip wait now --'
}

# ============================================================================
# Main loop
# ============================================================================
$iter = 0
$script:anySessionFailed = $false
while ($true) {
  $iter++
  $sessionFailed = $false
  $sessionStopRequested = $false
  try {
    Acquire-LoopLock
    if ($script:stopRequested) {
      $sessionStopRequested = $true
      continue
    }

    # -1) Auto-pull disabled; keep this run on the current local working tree.
    Write-Both "[loop] auto-pull disabled; using current local working tree state. Run .\git-pull.bat manually before starting if you want remote updates." DarkGray

    # 0) Pre-iteration self-heal.
    $sentinelPath = Join-Path $tempDir 'last-killed.txt'
    if (Test-Path $sentinelPath) {
      $sentinel = Get-Content -Raw -Path $sentinelPath -ErrorAction SilentlyContinue
      Write-Both '' Red
      Write-Both '[loop] PRIOR ITERATION WAS WATCHDOG-KILLED:' Red
      foreach ($line in ($sentinel -split "`r?`n")) {
        if ($line) { Write-Both "         $line" Red }
      }
      Remove-Item $sentinelPath -ErrorAction SilentlyContinue
    }
    Write-Both '[loop] working tree rescue stash disabled; leaving dirty files visible.' DarkGray
    Rescue-PrismaMigrations
    Retry-InfraBlockedIssues

    # 1) Kill orphaned dev-server processes on web/api ports.
    try {
      $cs = Get-NetTCPConnection -LocalPort 3000,3001 -State Listen -ErrorAction SilentlyContinue
      if ($cs) {
        foreach ($c in $cs) {
          $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
          if ($p) {
            Write-Both "[loop] killing leftover process on port $($c.LocalPort): $($p.ProcessName) (PID $($p.Id))" Yellow
            Stop-ProcessTree -RootPid $c.OwningProcess
          }
        }
      } else {
        Write-Both "[loop] ports 3000/3001 clean." DarkGray
      }
    } catch {
      Write-Both "[loop] port-cleanup error (non-fatal): $_" Red
    }

    # 1b) Sweep orphan node.exe whose command line points into this repo's apps/ tree.
    try {
      $repoMatch = [regex]::Escape($PSScriptRoot) + '\\apps\\'
      $orphanNodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match $repoMatch }
      if ($orphanNodes) {
        foreach ($n in $orphanNodes) {
          Write-Both "[loop] killing orphan repo node PID $($n.ProcessId)" Yellow
          Stop-ProcessTree -RootPid $n.ProcessId
        }
      }
    } catch {
      Write-Both "[loop] orphan-node sweep error (non-fatal): $_" Red
    }

    # 2) SESSION START banner.
    $startStamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Both ''
    Write-Both $bar Cyan
    Write-Both " SESSION START   #$iter   $startStamp   [$($selectedPreset.Key)]   prompt=[$selectedPrompt]" Cyan
    Write-Both $bar Cyan
    Write-Both ''
    Show-HintBannerThrottled -Force

    # 3) Re-read prompt content each iteration so prompt edits are picked up
    #    without restarting the loop. Prepend the ollama language guard
    #    fresh each iteration.
    try {
      $promptContent = Get-Content -Raw -Path $promptPath -ErrorAction Stop
    } catch {
      Write-Both "[loop] FATAL: failed to read prompt file '$selectedPrompt': $_" Red
      throw
    }
    if ([string]::IsNullOrWhiteSpace($promptContent)) {
      Write-Both "[loop] FATAL: prompt file '$selectedPrompt' is empty." Red
      throw "prompt file '$selectedPrompt' is empty"
    }
    if ($selectedPreset.Provider -eq 'ollama') {
      $ollamaLanguageGuard = @'
You must respond in English only.
Think in English.
Do not use Chinese unless the user explicitly asks for Chinese.
All code comments, documentation edits, changelog entries, todo updates, and terminal-facing summaries must be written in English.

'@
      $promptContent = $ollamaLanguageGuard + $promptContent
    }

    # 4) Build the ProcessStartInfo per provider.
    $launcherName = switch ($selectedPreset.Provider) {
      'ollama' { 'ollama' }
      'codex'  { 'codex' }
      default  { 'claude' }
    }
    $launcherCmd  = Resolve-LauncherCommand -Name $launcherName
    if (-not $launcherCmd) {
      Write-Both "[loop] FATAL: '$launcherName' not found in PATH. Sleeping 60s and retrying." Red
      Start-Sleep -Seconds 60
      continue
    }

    $psi                          = New-Object System.Diagnostics.ProcessStartInfo
    $launcherSource               = $launcherCmd.Source
    $launcherPrefixArgs           = ''
    if ($launcherSource -match '\.ps1$') {
      $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
      if (-not $pwsh) {
        Write-Both "[loop] FATAL: pwsh (PowerShell 7+) not found for '$launcherName' wrapper. Sleeping 60s and retrying." Red
        Start-Sleep -Seconds 60
        continue
      }
      $psi.FileName       = $pwsh.Source
      $launcherPrefixArgs = "-NoProfile -ExecutionPolicy Bypass -File $(Quote-Arg $launcherSource) "
    } else {
      $psi.FileName       = $launcherSource
    }
    $psi.RedirectStandardInput    = $true
    $psi.RedirectStandardOutput   = $true
    $psi.RedirectStandardError    = $true
    $psi.UseShellExecute          = $false
    $psi.CreateNoWindow           = $true
    $psi.WorkingDirectory         = $PSScriptRoot
    $psi.StandardOutputEncoding   = [System.Text.UTF8Encoding]::new($false)
    $psi.StandardErrorEncoding    = [System.Text.UTF8Encoding]::new($false)

    $promptViaStdin = $true
    if ($selectedPreset.Provider -eq 'ollama') {
      $promptViaStdin = $false
      # Windows CreateProcess caps the full command line near 32 KB. Ollama
      # accepts the prompt only as an argv string, so guard against silent
      # truncation on long prompts. Leave headroom for the launch wrapper args.
      $promptByteLen = [System.Text.Encoding]::UTF8.GetByteCount($promptContent)
      if ($promptByteLen -gt 28000) {
        Write-Both "[loop] FATAL: ollama prompt is ${promptByteLen} bytes; Windows command-line limit (~32 KB) would truncate it. Shorten '$selectedPrompt' or pick a non-ollama preset." Red
        Start-Sleep -Seconds 60
        continue
      }
      $promptArg = Quote-Arg $promptContent
      $passthroughArgs = "-p $promptArg --output-format stream-json --include-partial-messages --verbose --dangerously-skip-permissions"
      if ([string]::IsNullOrWhiteSpace($effectiveModel)) {
        $psi.Arguments = "launch claude --yes -- $passthroughArgs"
      } else {
        $psi.Arguments = "launch claude --model $(Quote-Arg $effectiveModel) --yes -- $passthroughArgs"
      }
    } elseif ($selectedPreset.Provider -eq 'codex') {
      # Codex reads the prompt from stdin when '-' is provided.
      $codexModelArg = if ($effectiveModel) { " -m $(Quote-Arg $effectiveModel)" } else { '' }
      $psi.Arguments = "${launcherPrefixArgs}exec --json --color never -C $(Quote-Arg $PSScriptRoot) --dangerously-bypass-approvals-and-sandbox$codexModelArg -"
    } else {
      # anthropic / deepseek -- prompt via stdin
      $psi.Arguments = "${launcherPrefixArgs}-p --output-format stream-json --include-partial-messages --verbose --dangerously-skip-permissions"
    }

    # Inject DeepSeek (or other) env vars into THIS child only -- does not
    # leak into the parent shell.
    if ($selectedPreset.ContainsKey('Env') -and $selectedPreset.Env) {
      foreach ($k in $selectedPreset.Env.Keys) {
        $psi.Environment[$k] = [string]$selectedPreset.Env[$k]
      }
    }
    if ($selectedPreset.Provider -eq 'deepseek') {
      $psi.Environment['ANTHROPIC_AUTH_TOKEN'] = $env:DEEPSEEK_API_KEY
    }

    Write-Both "[loop] invoking $launcherName ..." DarkGray

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    if ($promptViaStdin) {
      try {
        $promptBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($promptContent)
        $proc.StandardInput.BaseStream.Write($promptBytes, 0, $promptBytes.Length)
        $proc.StandardInput.BaseStream.Flush()
      } catch {}
    }
    try { $proc.StandardInput.Close() } catch {}

    $iterStart       = Get-Date
    $aborted         = $false
    $abortReason     = ''
    $exitDetectedAt  = $null
    $script:knownChildPids = New-Object System.Collections.Generic.HashSet[int]
    $script:lastChildScanAt = [DateTime]::MinValue
    $stdout          = $proc.StandardOutput
    $stderr          = $proc.StandardError
    $plainTextOutput = $false

    # Per-iteration parse state.
  $script:curTool      = $null
  $script:curToolInput = ''
  $script:inThinking   = $false
  $script:resultSeen   = $false
  $script:codexStderrSpeaker = ''
  $script:infraBlockDetected = $false
  $script:infraBlockReason = ''
  $script:stderrRawLinesEmitted = 0
  $script:stderrRawSuppressed = $false
  $script:activeCommandRaw = ''
  $script:activeCommand = ''
  $script:activeCommandStartedAt = $null
  $script:deployTailByteOffset = 0
  $script:deployTailCarry = ''
  $script:lastDeployTailAt = $null
  $deployTailPath = Join-Path $tempDir 'deploy_direct.last.log'

    $truncateLine = {
      param([string]$Text, [int]$Max = 240)
      $Text = Normalize-LoopText $Text
      if ($null -eq $Text) { return '' }
      if ($Text.Length -le $Max) { return $Text }
      return $Text.Substring(0, $Max) + '...'
    }
    $isFileReadCommand = {
      param([string]$CmdText)
      if ([string]::IsNullOrWhiteSpace($CmdText)) { return $false }
      $c = $CmdText.Trim()
      # Show the command itself, but do not preview raw file contents.
      return ($c -match '(?i)(^|\s)(Get-Content|gc|cat|type)(\s|$)')
    }

  $emitCodexStderrSummary = {
      param([string]$line)
      if (Test-InfraBlockText $line) {
        $script:infraBlockDetected = $true
        $script:infraBlockReason = $line.Trim()
      }
      if ($ShowCodexStderr) {
        $shown = & $truncateLine $line
        Write-Host $shown -ForegroundColor DarkGray
        Append-Log -Text $shown
        return
      }

      $trimmed = $line.Trim()
      if ($trimmed -eq '') { return }

      if ($trimmed -eq 'codex') {
        $script:codexStderrSpeaker = 'codex'
        Write-Host '[codex]' -ForegroundColor DarkCyan
        Append-Log -Text '[codex]'
        return
      }
      if ($trimmed -eq 'user') {
        $script:codexStderrSpeaker = 'user'
        return
      }
      if ($trimmed -match '^(OpenAI Codex|workdir:|model:|provider:|approval:|sandbox:|reasoning effort:|session id:|tokens used|collab:)' -or $trimmed -match '(?i)\b(error|failed|panic|exception)\b') {
        $shown = & $truncateLine $trimmed
        Write-Host $shown -ForegroundColor DarkGray
        Append-Log -Text $shown
        return
      }
      if ($script:codexStderrSpeaker -eq 'codex') {
        $shown = & $truncateLine $trimmed
        Write-Host $shown -ForegroundColor Gray
        Append-Log -Text $shown
      }
    }

    $summarizeTool = {
      param($name, $jsonStr)
      if ([string]::IsNullOrWhiteSpace($jsonStr)) { return '' }
      try {
        $j = $jsonStr | ConvertFrom-Json -ErrorAction Stop
      } catch { return '' }
      switch ($name) {
        'Read'        { return "$($j.file_path)" }
        'Write'       { return "$($j.file_path)" }
        'Edit'        { return "$($j.file_path)" }
        'NotebookEdit' { return "$($j.file_path)" }
        'Glob'        { return "$($j.pattern)$(if ($j.path) { "  in $($j.path)" })" }
        'Grep'        { return "/$($j.pattern)/$(if ($j.path) { "  in $($j.path)" })$(if ($j.glob) { "  glob=$($j.glob)" })" }
        'Bash'        {
          $cmd = "$($j.command)"
          if ($cmd.Length -gt 100) { $cmd = $cmd.Substring(0, 100) + '...' }
          return $cmd
        }
        'PowerShell'  {
          $cmd = "$($j.command)"
          if ($cmd.Length -gt 100) { $cmd = $cmd.Substring(0, 100) + '...' }
          return $cmd
        }
        'WebFetch'    { return "$($j.url)" }
        'WebSearch'   { return "$($j.query)" }
        'TodoWrite'   { return "($($j.todos.Count) items)" }
        'TaskCreate'  { return "$($j.description)" }
        'Agent'       { return "$($j.subagent_type): $($j.description)" }
        'Skill'       { return "$($j.skill)" }
        'ToolSearch'  { return "$($j.query)" }
        default       {
          $s = $jsonStr -replace '\s+', ' '
          if ($s.Length -gt 80) { $s = $s.Substring(0, 80) + '...' }
          return $s
        }
      }
    }

    $flushTool = {
      if ($null -ne $script:curTool) {
        $sum = & $summarizeTool $script:curTool $script:curToolInput
        $sum = Normalize-LoopText $sum
        if ($sum) {
          $msg = "       $sum"
          Write-Host $msg -ForegroundColor DarkGray
          Append-Log -Text $msg
        }
        $script:curTool = $null
        $script:curToolInput = ''
        Show-HintBannerThrottled
      }
    }

    $emitLine = {
      param($line, [string]$Source = 'stdout')
      if ($null -eq $line -or $line -eq '') { return }
      if ($plainTextOutput) {
        if ($Source -eq 'stderr') {
          & $emitCodexStderrSummary $line
          return
        }
        $line = & $truncateLine $line 600
        $color = if ($Source -eq 'stderr') { [System.ConsoleColor]::DarkGray } else { [System.ConsoleColor]::Gray }
        Write-Host $line -ForegroundColor $color
        Append-Log -Text $line
        return
      }
      try {
        $o = $line | ConvertFrom-Json -ErrorAction Stop
        if ($o.type -eq 'result' -or $o.type -eq 'turn.completed') {
          $script:resultSeen = $true
          if ($o.type -eq 'turn.completed') {
            $usage = $o.usage
            $usageText = ''
            if ($usage) {
              $usageText = " input=$($usage.input_tokens) cached=$($usage.cached_input_tokens) output=$($usage.output_tokens) reasoning=$($usage.reasoning_output_tokens)"
            }
            Write-Both "[turn completed]$usageText" DarkGreen
          }
        }
        elseif ($o.type -eq 'error') {
          $msg = if ($o.message) { "$($o.message)" } else { 'unknown error' }
          if (Test-InfraBlockText $msg) {
            $script:infraBlockDetected = $true
            $script:infraBlockReason = $msg
          }
          Write-Both "[codex error] $msg" Red
        }
        elseif ($o.type -eq 'turn.failed') {
          $msg = 'turn failed'
          try {
            if ($o.error -and $o.error.message) { $msg = "$($o.error.message)" }
          } catch {}
          if (Test-InfraBlockText $msg) {
            $script:infraBlockDetected = $true
            $script:infraBlockReason = $msg
          }
          Write-Both "[codex turn.failed] $msg" Red
        }
        if ($o.type -eq 'item.started' -and $o.item) {
          $item = $o.item
          if ($item.type -eq 'command_execution' -and $item.command) {
            & $flushTool
            try { Write-Host '' } catch {}
            Write-Host '[cmd]' -ForegroundColor DarkCyan
            Append-Log -Text "`n[cmd]"
            $cmd = "$($item.command)"
            if ($cmd.Length -gt 140) { $cmd = $cmd.Substring(0, 140) + '...' }
            $script:activeCommandRaw = "$($item.command)"
            $script:activeCommand = $cmd
            $script:activeCommandStartedAt = Get-Date
            if ($script:activeCommandRaw -match '(?i)\bpython(?:\.exe)?\s+deploy_direct\.py\b') {
              $script:deployTailByteOffset = 0
              $script:deployTailCarry = ''
              $script:lastDeployTailAt = Get-Date
            }
            Write-Host "       $cmd" -ForegroundColor DarkGray
            Append-Log -Text "       $cmd"
            Show-HintBannerThrottled
          }
          elseif ($item.type -ne 'agent_message') {
            & $flushTool
            try { Write-Host '' } catch {}
            Write-Host "[item started] $($item.type)" -ForegroundColor DarkCyan
            Append-Log -Text "`n[item started] $($item.type)"
            if ($item.status) {
              Write-Host "       status=$($item.status)" -ForegroundColor DarkGray
              Append-Log -Text "       status=$($item.status)"
            }
            Show-HintBannerThrottled
          }
        }
        if ($o.type -eq 'item.completed' -and $o.item) {
          $item = $o.item
          if ($item.type -eq 'agent_message' -and $item.text) {
            & $flushTool
            $agentText = Normalize-LoopText "$($item.text)"
            Write-Host $agentText
            Append-Log -Text $agentText
          }
          elseif ($item.type -eq 'command_execution') {
            & $flushTool
            $exit = if ($null -ne $item.exit_code) { $item.exit_code } else { '?' }
            $color = if ($exit -eq 0) { [System.ConsoleColor]::DarkGreen } else { [System.ConsoleColor]::Red }
            $script:activeCommandRaw = ''
            $script:activeCommand = ''
            $script:activeCommandStartedAt = $null
            $script:lastDeployTailAt = $null
            try { Write-Host '' } catch {}
            Write-Host "       [cmd exit=$exit]" -ForegroundColor $color
            Append-Log -Text "       [cmd exit=$exit]"
            if ($item.aggregated_output) {
              $cmdText = "$($item.command)"
              if (& $isFileReadCommand $cmdText) {
                Write-Host '         [output redacted: file content preview suppressed]' -ForegroundColor DarkGray
                Append-Log -Text '         [output redacted: file content preview suppressed]'
              } else {
                $lines = (Normalize-LoopText "$($item.aggregated_output)") -split "`r?`n" | Where-Object { $_.Trim() }
                foreach ($p in @($lines | Select-Object -First 4)) {
                  Write-Host "         $p" -ForegroundColor $color
                  Append-Log -Text "         $p"
                }
                if ($lines.Count -gt 4) {
                  Write-Host '         ...' -ForegroundColor $color
                  Append-Log -Text '         ...'
                }
              }
            }
            Show-HintBannerThrottled
          }
          elseif ($item.type -eq 'tool_call' -and $item.name) {
            & $flushTool
            try { Write-Host '' } catch {}
            Write-Host "[tool] $($item.name)" -ForegroundColor DarkCyan
            Append-Log -Text "`n[tool] $($item.name)"
            if ($item.arguments) {
              $sum = "$($item.arguments)" -replace '\s+', ' '
              if ($sum.Length -gt 100) { $sum = $sum.Substring(0, 100) + '...' }
              Write-Host "       $sum" -ForegroundColor DarkGray
              Append-Log -Text "       $sum"
            }
            Show-HintBannerThrottled
          }
          else {
            & $flushTool
            try { Write-Host '' } catch {}
            $status = if ($item.status) { " status=$($item.status)" } else { '' }
            Write-Host "[item completed] $($item.type)$status" -ForegroundColor DarkGreen
            Append-Log -Text "`n[item completed] $($item.type)$status"
            Show-HintBannerThrottled
          }
        }
        if ($o.type -eq 'stream_event') {
          $e = $o.event
          if ($e.type -eq 'content_block_start' -and $e.content_block.type -eq 'tool_use') {
            & $flushTool
            $script:curTool = $e.content_block.name
            $script:curToolInput = ''
            try { Write-Host '' } catch {}
            Write-Host "[tool] $($script:curTool)" -ForegroundColor DarkCyan
            Append-Log -Text "`n[tool] $($script:curTool)"
          }
          elseif ($e.type -eq 'content_block_delta' -and $e.delta.type -eq 'input_json_delta' -and $null -ne $script:curTool) {
            $script:curToolInput += "$($e.delta.partial_json)"
          }
          elseif ($e.type -eq 'content_block_stop') {
            & $flushTool
          }
          elseif ($e.type -eq 'content_block_delta' -and $e.delta.type -eq 'text_delta') {
            & $flushTool
            $deltaText = Normalize-LoopText "$($e.delta.text)"
            try { [Console]::Write($deltaText) } catch { Write-Host -NoNewline $deltaText }
            Append-Log -Text $deltaText -NoNewline
          }
          elseif ($e.type -eq 'content_block_start' -and $e.content_block.type -eq 'thinking') {
            & $flushTool
            $script:inThinking = $true
            try { Write-Host '' } catch {}
            Write-Host '[thinking]' -ForegroundColor DarkGray -NoNewline
            Write-Host ''
            Append-Log -Text "`n[thinking]"
          }
          elseif ($e.type -eq 'content_block_delta' -and $e.delta.type -eq 'thinking_delta' -and $script:inThinking) {
            $thinkingText = Normalize-LoopText "$($e.delta.thinking)"
            try { [Console]::Write($thinkingText) } catch { Write-Host -NoNewline $thinkingText }
            Append-Log -Text $thinkingText -NoNewline
          }
          elseif ($e.type -eq 'content_block_stop' -and $script:inThinking) {
            $script:inThinking = $false
            try { Write-Host '' } catch {}
            Append-Log -Text ''
            Show-HintBannerThrottled
          }
        }
        elseif ($o.type -eq 'user' -and $o.message -and $o.message.content) {
          foreach ($block in @($o.message.content)) {
            if ($block.type -ne 'tool_result') { continue }
            $resultText = ''
            if ($block.content -is [string]) {
              $resultText = $block.content
            } else {
              foreach ($inner in @($block.content)) {
                if ($inner.type -eq 'text' -and $inner.text) { $resultText += $inner.text }
                elseif ($inner.type -eq 'image') { $resultText += '<image>' }
              }
            }
            if ([string]::IsNullOrWhiteSpace($resultText)) { continue }
            $lines = $resultText -split "`r?`n"
            $picked = @($lines | Select-Object -First 4)
            $more = ($lines.Count -gt 4) -or ($resultText.Length -gt 300)
            $preview = Normalize-LoopText ($picked -join "`n")
            if ($preview.Length -gt 300) { $preview = $preview.Substring(0, 300); $more = $true }
            $color = if ($block.is_error) { [System.ConsoleColor]::Red } else { [System.ConsoleColor]::DarkGreen }
            $tag = if ($block.is_error) { '[result ERROR]' } else { '[result]' }
            try { Write-Host '' } catch {}
            Write-Host "       $tag" -ForegroundColor $color
            Append-Log -Text "       $tag"
            foreach ($p in ($preview -split "`r?`n")) {
              Write-Host "         $p" -ForegroundColor $color
              Append-Log -Text "         $p"
            }
            if ($more) {
              Write-Host '         ...' -ForegroundColor $color
              Append-Log -Text '         ...'
            }
            Show-HintBannerThrottled
          }
        }
      } catch {
        $raw = & $truncateLine "$line" 240
        $trim = $raw.Trim()
        if ([string]::IsNullOrWhiteSpace($trim)) { return }
        if ($trim -match '^SUCCESS: The process with PID \d+ .* has been terminated\.$') {
          # Codex may emit taskkill cleanup lines on Windows after failures.
          # Suppress these to keep the actual error visible.
          return
        }
        if ($Source -eq 'stderr') {
          $script:stderrRawLinesEmitted++
          if ($script:stderrRawLinesEmitted -le 6) {
            Write-Host "[stderr] $trim" -ForegroundColor DarkGray
            Append-Log -Text "[stderr] $trim"
            return
          }
          if (-not $script:stderrRawSuppressed) {
            $script:stderrRawSuppressed = $true
            Write-Host '[stderr] additional failure-output lines suppressed to keep loop logs compact' -ForegroundColor DarkGray
            Append-Log -Text '[stderr] additional failure-output lines suppressed to keep loop logs compact'
          }
          return
        }
        Write-Host "[raw] $raw" -ForegroundColor DarkGray
        Append-Log -Text "[raw] $raw"
      }
    }

    # Read loop.
    $pendingRead = $null
    $pendingErrRead = $null
    $stdoutClosed = $false
    $stderrClosed = $false
    $postResultDeadline = $null
    $postResultCloseRequested = $false
    $postResultKillDeadline = $null
    $lastOutputAt = Get-Date
    $lastNoOutputStatusAt = Get-Date
    while ($true) {
      $now = Get-Date
      if (($now - $iterStart).TotalSeconds -ge $HardTimeoutSec) {
        $aborted = $true
        $abortReason = "hard cap ${HardTimeoutSec}s -- killing claude + descendants"
        break
      }

      # Poll user stop request (Q key or sentinel file). Does NOT kill the
      # running session; just records intent. The current iteration runs to
      # completion, then the outer loop exits.
      [void](Test-StopRequested)

      # Track child PIDs while the process is alive so we can reap orphans
      # without relying on ParentProcessId after exit (Windows reuses PIDs).
      if (-not $proc.HasExited -and ($now - $script:lastChildScanAt).TotalSeconds -ge 2) {
        $script:lastChildScanAt = $now
        try {
          $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($proc.Id)" -ErrorAction SilentlyContinue
          foreach ($k in $kids) { [void]$script:knownChildPids.Add([int]$k.ProcessId) }
        } catch {}
      }

      if (-not $proc.HasExited -and $script:activeCommandRaw -match '(?i)\bpython(?:\.exe)?\s+deploy_direct\.py\b') {
        $shouldTail = $true
        if ($script:lastDeployTailAt) {
          $shouldTail = ((Get-Date) - $script:lastDeployTailAt).TotalSeconds -ge 3
        }
        if ($shouldTail -and (Test-Path $deployTailPath)) {
          try {
            $fs = [System.IO.File]::Open($deployTailPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            try {
              if ($fs.Length -lt $script:deployTailByteOffset) {
                # File was truncated/rotated since last read; resync from start.
                $script:deployTailByteOffset = 0
                $script:deployTailCarry = ''
              }
              if ($fs.Length -gt $script:deployTailByteOffset) {
                [void]$fs.Seek($script:deployTailByteOffset, [System.IO.SeekOrigin]::Begin)
                $remaining = $fs.Length - $script:deployTailByteOffset
                $buf = New-Object byte[] $remaining
                $read = $fs.Read($buf, 0, $buf.Length)
                $script:deployTailByteOffset += $read
                $chunk = $script:deployTailCarry + [System.Text.Encoding]::UTF8.GetString($buf, 0, $read)
                $parts = $chunk -split "`r?`n"
                # Last element is the incomplete trailing line (or '' if chunk ended on a newline); carry it forward.
                $script:deployTailCarry = $parts[-1]
                $newLines = @($parts | Select-Object -First ($parts.Count - 1) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
                foreach ($dl in @($newLines | Select-Object -First 6)) {
                  $shown = if ($dl.Length -gt 220) { $dl.Substring(0, 220) + '...' } else { $dl }
                  Write-Both "[deploy] $shown" DarkGray
                }
                if ($newLines.Count -gt 6) {
                  Write-Both "[deploy] ... ($($newLines.Count - 6) more lines)" DarkGray
                }
              }
            } finally {
              $fs.Dispose()
            }
          } catch {}
          $script:lastDeployTailAt = Get-Date
        }
      }

      if (-not $proc.HasExited -and ($now - $lastOutputAt).TotalSeconds -ge $NoOutputStatusSec -and ($now - $lastNoOutputStatusAt).TotalSeconds -ge $NoOutputStatusSec) {
        $silentFor = [int]($now - $lastOutputAt).TotalSeconds
        $activeHint = ''
        if ($script:activeCommandStartedAt -and $script:activeCommand) {
          $cmdFor = [int]($now - $script:activeCommandStartedAt).TotalSeconds
          $activeHint = " active-cmd=${cmdFor}s: $($script:activeCommand)"
        }
        Write-Both "[loop] waiting: no $launcherName output for ${silentFor}s; process still alive (reasoning, tool, or internal worker may be running).$activeHint" DarkYellow
        $lastNoOutputStatusAt = $now
      }

      if ($script:resultSeen -and $null -eq $postResultDeadline) {
        $postResultDeadline = $now.AddSeconds($PostResultGraceSec)
        Write-Both "[loop] result event received; waiting up to ${PostResultGraceSec}s for $launcherName to exit..." DarkGray
      }
      if ($null -ne $postResultDeadline -and $now -ge $postResultDeadline -and -not $proc.HasExited -and -not $postResultCloseRequested) {
        [void](Request-GracefulExit -Process $proc -Name $launcherName)
        $postResultCloseRequested = $true
        $postResultKillDeadline = $now.AddSeconds($PostResultCloseWaitSec)
        Write-Both "[loop] waiting ${PostResultCloseWaitSec}s more before force-kill (if still running)." DarkGray
      }
      if ($postResultCloseRequested -and $null -ne $postResultKillDeadline -and $now -ge $postResultKillDeadline -and -not $proc.HasExited) {
        Write-Both "[loop] $launcherName still running after graceful-close window; force-killing." DarkYellow
        Stop-ProcessTree -RootPid $proc.Id
        Start-Sleep -Milliseconds 200
      }

      if ($proc.HasExited) {
        if ($null -eq $exitDetectedAt) {
          $exitDetectedAt = $now
          # Reap only PIDs we observed as children BEFORE the parent exited.
          # Reading ParentProcessId after exit is unsafe because Windows can
          # reuse $proc.Id, which would point at unrelated processes.
          foreach ($childPid in @($script:knownChildPids)) {
            try {
              $still = Get-Process -Id $childPid -ErrorAction SilentlyContinue
              if ($still) {
                Write-Both "[loop] $launcherName exited; reaping orphan child: $($still.ProcessName) (PID $childPid)" DarkYellow
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
          Write-Both "[loop] ReadLineAsync error: $_" Red
          $stdoutClosed = $true
        }
      }
      if (-not $stderrClosed -and $null -eq $pendingErrRead) {
        try { $pendingErrRead = $stderr.ReadLineAsync() } catch {
          Write-Both "[loop] stderr ReadLineAsync error: $_" Red
          $stderrClosed = $true
        }
      }

      $finished = $false
      if ($null -ne $pendingRead) { $finished = $pendingRead.Wait(1000) }
      else { Start-Sleep -Seconds 1 }
      if ($finished -and $null -ne $pendingRead) {
        $line = $pendingRead.Result
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

    if ($aborted) {
      Write-Both ''
      Write-Both "[loop] WATCHDOG: $abortReason" Red
      Stop-ProcessTree -RootPid $proc.Id
      try { $proc.WaitForExit(5000) | Out-Null } catch {}
      Write-Both '[loop] post-watchdog: leaving working tree untouched; no git stash is used.' Yellow
      Rescue-PrismaMigrations
      $sentinelTxt = @(
        "watchdog-killed: yes",
        "iteration: $iter",
        "killed_at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
        "reason: $abortReason",
        "stashed: no - stash disabled"
      ) -join "`n"
      try { Set-Content -Path (Join-Path $tempDir 'last-killed.txt') -Value $sentinelTxt -Encoding UTF8 } catch {}
    } else {
      try { $proc.WaitForExit(5000) | Out-Null } catch {}
    }

    $exitCode = if ($proc.HasExited) { $proc.ExitCode } else { 'killed' }
    if ($exitCode -ne 0) {
      $sessionFailed = $true
      $script:anySessionFailed = $true
      if ($script:infraBlockDetected) {
        Mark-InfraBlockedFromLoop -Reason $script:infraBlockReason
      }
      try {
        if (-not $proc.HasExited) {
          Write-Both "[loop] child process has not exited after stream drain; skipping blocking stderr ReadToEnd." Red
          throw 'child process did not exit cleanly'
        }
        $err = $proc.StandardError.ReadToEnd()
        if (!$script:infraBlockDetected -and (Test-InfraBlockText $err)) {
          Mark-InfraBlockedFromLoop -Reason $err
        }
        if ($err) {
          Write-Both '[loop] STDERR:' Red
          $i = 0
          foreach ($line in ($err -split "`r?`n")) {
            if (-not $line) { continue }
            if ($i -lt 8) {
              Write-Both "         $line" Red
            } elseif ($i -eq 8) {
              Write-Both '         ... (additional stderr lines suppressed)' Red
            }
            $i++
          }
        }
      } catch {}
    }
    try { $proc.Dispose() } catch {}

    # 5) SESSION COMPLETE banner.
    $endStamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $extra = if ($aborted) { '  WATCHDOG-KILLED' } else { '' }
    Write-Both ''
    Write-Both ''
    Write-Both $bar Green
    Write-Both " SESSION COMPLETE  #$iter   $endStamp   ($launcherName exit=$exitCode$extra)   prompt=[$selectedPrompt]" Green

    # If user pressed Q (or dropped the sentinel file), exit cleanly here.
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
    if ($script:infraBlockDetected) {
      $retrySec = 1800
      Write-Both "[loop] infra-block failure; retrying in 30 minutes." Yellow
      for ($i = $retrySec; $i -ge 1; $i--) {
        try { Write-Host -NoNewline ("`r  infra-blocked; retrying in {0}m {1:D2}s...   [Q stop]" -f [Math]::Floor($i/60), ($i % 60)) } catch {}
        Start-Sleep -Seconds 1
        [void](Test-StopRequested)
        if ($script:stopRequested) { break }
      }
      Write-Both '' Yellow
    } else {
      Write-Both '[loop] session failed; continuing to next iteration in 30s.' Yellow
      Start-Sleep -Seconds 30
    }
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
  Write-Both " Sleeping ${SleepBetweenSec} seconds.  N = start next now | P = pause/resume | Q = stop after sleep | Ctrl+C abort." Green
  Write-Both $bar Green

  # 6) Visible countdown with stop-poll. This happens outside the lock so
  # another runner can acquire the next session slot.
  for ($i = $SleepBetweenSec; $i -ge 1; $i--) {
    try {
      Write-Host -NoNewline ("`r  next iteration in {0,2}s...   [N start now  |  P pause/resume  |  Q stop after current  |  Ctrl+C abort]" -f $i)
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
  Write-Both '[loop.ps1] exited after failed bounded session.' Red
  exit 1
}
Write-Both ''
Write-Both '[loop.ps1] exited cleanly.' Magenta
