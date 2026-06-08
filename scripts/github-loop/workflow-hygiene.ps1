param(
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')),
  [string]$LaneRoot = '',
  [string]$Repository = 'radialmonster/bigbsky-dev'
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
  $output = & git -C $WorkDir @GitArgs 2>&1
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

function Get-OpenPrHeads {
  $raw = & $Gh pr list --repo $Repository --state open --limit 100 --json headRefName,number,title
  if ($LASTEXITCODE -ne 0) { return @() }
  return @(ConvertTo-Array ($raw | ConvertFrom-Json))
}

$rootPath = (Resolve-Path $RepositoryRoot).Path
$resolvedLaneRoot = Resolve-Path $LaneRoot -ErrorAction SilentlyContinue
if ($resolvedLaneRoot) {
  $normalizedLaneRoot = $resolvedLaneRoot.Path.TrimEnd('\', '/') -replace '\\', '/'
} else {
  $normalizedLaneRoot = $LaneRoot.TrimEnd('\', '/') -replace '\\', '/'
}
$mainBranch = (Invoke-Git @('branch', '--show-current') -WorkDir $rootPath | Select-Object -First 1)
$mainStatus = @(Get-StatusShort -Path $rootPath)
$worktrees = @(Get-Worktrees)
$openPrs = @(Get-OpenPrHeads)
$openPrHeads = @($openPrs | ForEach-Object { $_.headRefName })
$mergedBranches = @(Invoke-Git @('branch', '--merged', 'main') -WorkDir $rootPath | ForEach-Object {
  ($_ -replace '^[\*\+ ]+\s*', '').Trim()
} | Where-Object {
  $_ -and $_ -ne 'main' -and $_ -notmatch '^lane/'
})

Write-Host ''
Write-Host 'Workflow hygiene' -ForegroundColor Cyan

Write-Host ''
Write-Host 'Main worktree' -ForegroundColor Yellow
Write-Host "  Path:   $rootPath"
Write-Host "  Branch: $mainBranch"
if ($mainBranch -ne 'main') {
  Write-Host '  Warning: primary worktree is not on main.' -ForegroundColor Yellow
}
if ($mainStatus.Count -eq 0) {
  Write-Host '  Status: clean'
} else {
  Write-Host '  Status: dirty'
  $mainStatus | Select-Object -First 20 | ForEach-Object { Write-Host "    $_" }
}

Write-Host ''
Write-Host 'Worktrees' -ForegroundColor Yellow
foreach ($worktree in ($worktrees | Sort-Object Path)) {
  $path = [string]$worktree.Path
  $normalizedPath = $path -replace '\\', '/'
  $branch = if ($worktree.Branch) { [string]$worktree.Branch } elseif ($worktree.Detached) { '(detached)' } else { '(unknown)' }
  $status = @(Get-StatusShort -Path $path)
  $isLane = $normalizedPath -like "$normalizedLaneRoot*"
  $running = if ($isLane) { Test-LaneProcessRunning -Path $path } else { $false }
  $openPrMatch = $openPrHeads -contains $branch
  $staleHint = ''
  if ($isLane -and !$running -and !$openPrMatch -and ($branch -match '^(work/|lane/)' -or $branch -eq '(detached)')) {
    $staleHint = ' stale-candidate'
  }
  Write-Host ("  {0} [{1}] running={2} dirty={3}{4}" -f $path, $branch, $running, ($status.Count -gt 0), $staleHint)
  if ($status.Count -gt 0) {
    $status | Select-Object -First 8 | ForEach-Object { Write-Host "    $_" }
  }
}

Write-Host ''
Write-Host 'Merged local branches not main/lane' -ForegroundColor Yellow
if ($mergedBranches.Count -eq 0) {
  Write-Host '  none'
} else {
  $mergedBranches | Sort-Object | ForEach-Object {
    $openPrMatch = $openPrHeads -contains $_
    $suffix = if ($openPrMatch) { ' (open PR head)' } else { '' }
    Write-Host "  $_$suffix"
  }
}

Write-Host ''
Write-Host 'Open PR heads' -ForegroundColor Yellow
if ($openPrs.Count -eq 0) {
  Write-Host '  none'
} else {
  $openPrs | Sort-Object number | ForEach-Object {
    Write-Host ("  PR #{0}: {1} [{2}]" -f $_.number, $_.title, $_.headRefName)
  }
}

Write-Host ''
Write-Host 'Notes' -ForegroundColor Yellow
Write-Host '  This report is read-only. It does not prune branches, remove worktrees, or delete artifacts.'
Write-Host '  Stale candidates should be reviewed before cleanup because lane worktrees may intentionally preserve context.'
