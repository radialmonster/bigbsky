param(
  [string[]]$Presets = @('anthropic-opus', 'anthropic-sonnet'),
  [switch]$All,
  [string]$Prompt = 'prompt-model-smoke.txt'
)

$ErrorActionPreference = 'Continue'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$ResultsRoot = Join-Path $Root 'out\model-smoke'
$LoopLog = Join-Path $Root 'loop.log'
$AllPresets = @(
  'codex-yolo',
  'codex-spark',
  'anthropic-opus',
  'anthropic-sonnet',
  'deepseek-api',
  'ollama-deepseek-v4-pro-cloud',
  'ollama-deepseek-v4-flash-cloud',
  'ollama-gemma4-31b-cloud',
  'ollama-glm',
  'ollama-kimi'
)

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

if ($All) {
  $Presets = $AllPresets
}

New-Item -ItemType Directory -Force -Path $ResultsRoot | Out-Null
Set-Location $Root

$summary = New-Object System.Collections.Generic.List[object]
$PresetNames = @{
  'codex-yolo'                    = 'Codex CLI / OpenAI gpt-5.5 medium'
  'codex-spark'                   = 'Codex CLI / OpenAI gpt-5.3-codex spark'
  'anthropic-opus'                = 'Claude Code / Anthropic claude-opus-4-7 1M'
  'anthropic-sonnet'              = 'Claude Code / Anthropic claude-sonnet-4-6'
  'deepseek-api'                  = 'Claude Code / DeepSeek API deepseek-v4-pro 1M'
  'ollama-deepseek-v4-pro-cloud'  = 'Ollama Cloud / DeepSeek deepseek-v4-pro:cloud'
  'ollama-deepseek-v4-flash-cloud'= 'Ollama Cloud / DeepSeek deepseek-v4-flash:cloud'
  'ollama-gemma4-31b-cloud'       = 'Ollama Cloud / Google gemma4:31b-cloud'
  'ollama-glm'                    = 'Ollama Cloud / Zhipu GLM glm-5.1:cloud'
  'ollama-kimi'                   = 'Ollama Cloud / Moonshot Kimi kimi-k2.6:cloud'
}

foreach ($preset in $Presets) {
  $startedAt = Get-Date
  $stamp = $startedAt.ToString('yyyyMMdd_HHmmss')
  $safePreset = $preset -replace '[^a-zA-Z0-9._-]', '-'
  $resultPath = Join-Path $ResultsRoot "$stamp-$safePreset.log"
  $presetLabel = if ($PresetNames.ContainsKey($preset)) { "$preset  —  $($PresetNames[$preset])" } else { $preset }
  Write-Host ''
  Write-Host "== Model smoke: $presetLabel ==" -ForegroundColor Cyan

  $beforeLength = 0
  if (Test-Path $LoopLog) {
    $beforeLength = (Get-Item $LoopLog).Length
  }

  & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'loop.ps1') $preset $Prompt -MaxIterations 1 -SleepBetweenSec 1
  $exitCode = $LASTEXITCODE

  $logText = ''
  if (Test-Path $LoopLog) {
    $stream = [System.IO.File]::Open($LoopLog, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      if ($beforeLength -gt 0 -and $beforeLength -lt $stream.Length) {
        $stream.Seek($beforeLength, [System.IO.SeekOrigin]::Begin) | Out-Null
      }
      $reader = New-Object System.IO.StreamReader($stream)
      $logText = $reader.ReadToEnd()
      $reader.Dispose()
    } finally {
      $stream.Dispose()
    }
  }

  $smokeJson = $null
  foreach ($line in ($logText -split "`n")) {
    $trimmed = $line.Trim()
    if ($trimmed -match '^\{"smoke_result"') {
      try { $smokeJson = $trimmed | ConvertFrom-Json } catch {}
      if ($smokeJson) { break }
    }
  }
  $status = if ($logText -match '(?i)(usage limit|usage cap|hit your limit|rate limit|quota|model is at capacity|try again at|infra-block detected)') {
    'infra-blocked'
  } elseif ($smokeJson -and [string]$smokeJson.smoke_result -eq 'pass') {
    'passed'
  } elseif ($smokeJson -and [string]$smokeJson.smoke_result -eq 'fail') {
    'failed'
  } elseif ($logText -match '(?i)(turn\.failed|codex error|SESSION.*failed)') {
    'failed'
  } elseif ($exitCode -eq 0) {
    'completed'
  } else {
    'failed'
  }
  Write-Utf8NoBom -Path $resultPath -Content $logText
  $summary.Add([pscustomobject]@{
    preset = $preset
    name = if ($PresetNames.ContainsKey($preset)) { $PresetNames[$preset] } else { '' }
    status = $status
    exit_code = $exitCode
    started_at = $startedAt.ToString('o')
    ended_at = (Get-Date).ToString('o')
    log = $resultPath
  })
}

$summaryPath = Join-Path $ResultsRoot 'latest-summary.json'
Write-Utf8NoBom -Path $summaryPath -Content ($summary | ConvertTo-Json -Depth 4)

Write-Host ''
Write-Host "Model smoke summary: $summaryPath" -ForegroundColor Cyan
$summary | Format-Table -AutoSize
