param(
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')),
  [string]$LaneRoot = '',
  [string]$Repository = 'radialmonster/bigbsky-dev',
  [int]$MinStoppedLaneAgeMinutes = 120,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($LaneRoot)) {
  if ($env:BIGBSKY_LANES_ROOT) { $LaneRoot = $env:BIGBSKY_LANES_ROOT }
  else { $LaneRoot = [System.IO.Path]::GetFullPath((Join-Path $RepositoryRoot '..\bigbsky-github-lanes')) }
}
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }

function Invoke-Git {
  param([string[]]$GitArgs, [string]$WorkDir = $RepositoryRoot)
  $output = & git -c core.longpaths=true -C $WorkDir @GitArgs 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git failed in ${WorkDir}: git $($GitArgs -join ' ')`n$($output -join "`n")"
  }
  return @($output)
}

function ConvertTo-Array {
  param($Value)
  if ($null -eq $Value) { return @() }
  if ($Value -is [array]) { return $Value }
  return @($Value)
}

function Get-Worktrees {
  $lines = Invoke-Git @('worktree', 'list', '--porcelain')
  $items = New-Object System.Collections.Generic.List[object]
  $current = [ordered]@{}
  foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      if ($current.Count -gt 0) {
        $items.Add([pscustomobject]$current)
        $current = [ordered]@{}
      }
      continue
    }
    if ($line -match '^worktree\s+(.+)$') { $current.Path = $Matches[1]; continue }
    if ($line -match '^HEAD\s+(.+)$') { $current.Head = $Matches[1]; continue }
    if ($line -match '^branch\s+refs/heads/(.+)$') { $current.Branch = $Matches[1]; continue }
    if ($line -eq 'detached') { $current.Detached = $true; continue }
  }
  if ($current.Count -gt 0) { $items.Add([pscustomobject]$current) }
  return $items.ToArray()
}

function Get-StatusShort {
  param([string]$Path)
  if (!(Test-Path $Path)) { return @('missing path') }
  return @(Invoke-Git @('status', '--short') -WorkDir $Path)
}

function Test-LaneProcessRunning {
  param([string]$Path)
  $escaped = [regex]::Escape($Path)
  $processes = @(Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and $_.CommandLine -match $escaped
  })
  return $processes.Count -gt 0
}

function Get-LaneAgeMinutes {
  param([string]$Path)
  try {
    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    return ([DateTimeOffset]::Now - [DateTimeOffset]$item.LastWriteTime).TotalMinutes
  } catch {
    return 0
  }
}

function Get-OpenPrHeads {
  $raw = & $Gh pr list --repo $Repository --state open --limit 100 --json headRefName,number,title
  if ($LASTEXITCODE -ne 0) { return @() }
  return @(ConvertTo-Array ($raw | ConvertFrom-Json))
}

function Remove-SafeWorktree {
  param([string]$Path)
  Invoke-Git @('worktree', 'remove', '--force', $Path) | Out-Null
}

function Remove-SafeBranch {
  param([string]$Branch)
  if ([string]::IsNullOrWhiteSpace($Branch)) { return }
  if ($Branch -notmatch '^(lane/|work/)') { return }
  Invoke-Git @('branch', '-D', $Branch) | Out-Null
}

function Remove-SafeDirectory {
  param([string]$Path, [string]$NormalizedLaneRoot)
  $resolved = Resolve-Path $Path -ErrorAction Stop
  $normalized = $resolved.Path.TrimEnd('\', '/') -replace '\\', '/'
  if ($normalized -ne $NormalizedLaneRoot -and $normalized -notlike "$NormalizedLaneRoot/*") {
    throw "Refusing to remove path outside lane root: $($resolved.Path)"
  }
  Remove-Item -LiteralPath $resolved.Path -Recurse -Force
}

$rootPath = (Resolve-Path $RepositoryRoot).Path
$mainBranch = (Invoke-Git @('branch', '--show-current') -WorkDir $rootPath | Select-Object -First 1)
$mainStatus = @(Get-StatusShort -Path $rootPath)
if ($mainBranch -ne 'main') {
  throw "Workflow cleanup requires primary worktree on main; currently on '$mainBranch'."
}
if ($mainStatus.Count -gt 0) {
  throw 'Workflow cleanup requires a clean primary worktree.'
}

$resolvedLaneRoot = Resolve-Path $LaneRoot -ErrorAction SilentlyContinue
if ($resolvedLaneRoot) {
  $normalizedLaneRoot = $resolvedLaneRoot.Path.TrimEnd('\', '/') -replace '\\', '/'
} else {
  $normalizedLaneRoot = $LaneRoot.TrimEnd('\', '/') -replace '\\', '/'
}

$openPrs = @(Get-OpenPrHeads)
$openPrHeads = @($openPrs | ForEach-Object { $_.headRefName })
$worktrees = @(Get-Worktrees)
$registeredWorktreePaths = @($worktrees | ForEach-Object { ([string]$_.Path).TrimEnd('\', '/') -replace '\\', '/' })
$cleaned = 0
$skipped = 0

Write-Host ''
Write-Host "Workflow cleanup ($(if ($Apply) { 'apply' } else { 'dry-run' }))" -ForegroundColor Cyan

foreach ($worktree in ($worktrees | Sort-Object Path)) {
  $path = [string]$worktree.Path
  $normalizedPath = $path -replace '\\', '/'
  $isLane = $normalizedPath -eq $normalizedLaneRoot -or $normalizedPath -like "$normalizedLaneRoot/*"
  if (!$isLane) { continue }

  $branch = if ($worktree.Branch) { [string]$worktree.Branch } elseif ($worktree.Detached) { '' } else { '' }
  $branchLabel = if ($branch) { $branch } elseif ($worktree.Detached) { '(detached)' } else { '(unknown)' }
  $status = @(Get-StatusShort -Path $path)
  $running = Test-LaneProcessRunning -Path $path
  $hasOpenPr = $branch -and ($openPrHeads -contains $branch)
  $safeBranch = ($branch -match '^(lane/|work/)') -or ($worktree.Detached -eq $true)

  $reasons = New-Object System.Collections.Generic.List[string]
  if ($running) { $reasons.Add('process-running') }
  if ($status.Count -gt 0) { $reasons.Add('dirty') }
  if ($hasOpenPr) { $reasons.Add('open-pr-head') }
  if (!$safeBranch) { $reasons.Add('not-lane-work-or-detached') }
  $ageMinutes = Get-LaneAgeMinutes -Path $path
  if ($branch -match '^lane/' -and $ageMinutes -lt $MinStoppedLaneAgeMinutes) {
    $reasons.Add(("recent-lane-log-retention:{0:n0}m" -f $ageMinutes))
  }

  if ($reasons.Count -gt 0) {
    Write-Host ("  skip {0} [{1}] - {2}" -f $path, $branchLabel, ($reasons -join ', ')) -ForegroundColor DarkGray
    $skipped++
    continue
  }

  if ($Apply) {
    Remove-SafeWorktree -Path $path
    if ((Test-Path $path) -and !(Test-Path (Join-Path $path '.git'))) {
      Remove-SafeDirectory -Path $path -NormalizedLaneRoot $normalizedLaneRoot
    }
    if ($branch) { Remove-SafeBranch -Branch $branch }
    Write-Host ("  removed {0} [{1}]" -f $path, $branchLabel)
  } else {
    Write-Host ("  would remove {0} [{1}]" -f $path, $branchLabel)
  }
  $cleaned++
}

Invoke-Git @('worktree', 'prune') | Out-Null

if (Test-Path $LaneRoot) {
  foreach ($laneDir in (Get-ChildItem -LiteralPath $LaneRoot -Directory -Force)) {
    $normalizedDir = $laneDir.FullName.TrimEnd('\', '/') -replace '\\', '/'
    if ($registeredWorktreePaths -contains $normalizedDir) { continue }
    $running = Test-LaneProcessRunning -Path $laneDir.FullName
    $gitPointer = Test-Path (Join-Path $laneDir.FullName '.git')
    $ageMinutes = Get-LaneAgeMinutes -Path $laneDir.FullName
    $recent = $ageMinutes -lt $MinStoppedLaneAgeMinutes
    if ($running -or $gitPointer -or $recent) {
      $reasons = @()
      if ($running) { $reasons += 'process-running' }
      if ($gitPointer) { $reasons += 'has-git-pointer' }
      if ($recent) { $reasons += ("recent-lane-log-retention:{0:n0}m" -f $ageMinutes) }
      Write-Host ("  skip orphan directory {0} - {1}" -f $laneDir.FullName, ($reasons -join ', ')) -ForegroundColor DarkGray
      $skipped++
      continue
    }

    if ($Apply) {
      Remove-SafeDirectory -Path $laneDir.FullName -NormalizedLaneRoot $normalizedLaneRoot
      Write-Host ("  removed orphan directory {0}" -f $laneDir.FullName)
    } else {
      Write-Host ("  would remove orphan directory {0}" -f $laneDir.FullName)
    }
    $cleaned++
  }
}

Write-Host ("Workflow cleanup complete. {0}: {1}; skipped: {2}" -f ($(if ($Apply) { 'removed' } else { 'would remove' })), $cleaned, $skipped)
