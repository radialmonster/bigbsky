param(
  [string]$Repository = 'radialmonster/bigbsky-dev'
)

$ErrorActionPreference = 'Stop'
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }

function Invoke-GhJson {
  param([string[]]$CliArgs)
  $raw = & $Gh @CliArgs
  if ($LASTEXITCODE -ne 0) { throw "gh failed: $($CliArgs -join ' ')" }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

function ConvertTo-Array {
  param($Value)
  if ($null -eq $Value) { return @() }
  if ($Value -is [array]) { return $Value }
  return @($Value)
}

function Get-RepositoryParts {
  $parts = $Repository.Split('/')
  if ($parts.Count -ne 2) { throw "Repository must be OWNER/REPO, got: $Repository" }
  return [pscustomobject]@{ Owner = $parts[0]; Name = $parts[1] }
}

function Get-NativeBlockingIssues {
  param([int]$BlockedIssueNumber)
  $repo = Get-RepositoryParts
  $raw = & $Gh api `
    --header 'Accept: application/vnd.github+json' `
    --header 'X-GitHub-Api-Version: 2026-03-10' `
    "repos/$($repo.Owner)/$($repo.Name)/issues/$BlockedIssueNumber/dependencies/blocked_by" 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { return @() }
  return @(ConvertTo-Array ($raw | ConvertFrom-Json))
}

function Get-RestIssueId {
  param([int]$Number)
  $repo = Get-RepositoryParts
  $issue = Invoke-GhJson @('api', "repos/$($repo.Owner)/$($repo.Name)/issues/$Number")
  if ($null -eq $issue.id) { throw "Could not read REST id for issue #$Number." }
  return [int64]$issue.id
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Add-NativeBlockedByDependency {
  param(
    [int]$BlockedIssueNumber,
    [int]$BlockingIssueNumber
  )
  $existing = @(Get-NativeBlockingIssues -BlockedIssueNumber $BlockedIssueNumber | ForEach-Object { [int]$_.number })
  if ($existing -contains $BlockingIssueNumber) { return $false }

  $repo = Get-RepositoryParts
  $payloadPath = Join-Path $env:TEMP ("bigbsky-followup-dependency-{0}-{1}.json" -f $BlockedIssueNumber, $BlockingIssueNumber)
  Write-Utf8NoBom -Path $payloadPath -Content (@{
    issue_id = (Get-RestIssueId -Number $BlockingIssueNumber)
  } | ConvertTo-Json -Compress)
  try {
    & $Gh api `
      --method POST `
      --header 'Accept: application/vnd.github+json' `
      --header 'X-GitHub-Api-Version: 2026-03-10' `
      "repos/$($repo.Owner)/$($repo.Name)/issues/$BlockedIssueNumber/dependencies/blocked_by" `
      --input $payloadPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "GitHub dependency API failed." }
    return $true
  } finally {
    Remove-Item -LiteralPath $payloadPath -Force -ErrorAction SilentlyContinue
  }
}

$blockedParents = @(Invoke-GhJson @(
  'issue', 'list',
  '--repo', $Repository,
  '--state', 'open',
  '--label', 'ai:blocked',
  '--json', 'number,title,labels',
  '--limit', '100'
))

if ($blockedParents.Count -eq 0) {
  Write-Host 'No blocked parent issues are waiting on follow-ups.'
  exit 0
}

$openBlockingFollowUps = @(Invoke-GhJson @(
  'issue', 'list',
  '--repo', $Repository,
  '--state', 'open',
  '--label', 'ai:blocks-release',
  '--json', 'number,title,body,url',
  '--limit', '100'
))

$cleared = 0
foreach ($parent in ($blockedParents | Sort-Object number)) {
  $labels = @(ConvertTo-Array $parent.labels | ForEach-Object { $_.name })
  if (!(($labels -contains 'ai:implemented') -and ($labels -contains 'ai:needs-verify') -and ($labels -contains 'ai:pr-open'))) {
    continue
  }

  $parentNumber = [int]($parent.number | Select-Object -First 1)
  $remaining = @(ConvertTo-Array $openBlockingFollowUps | Where-Object {
    [string]$body = $_.body
    $body -match "(?im)\b(Follow-up from Issue|Original issue|Source issue)\s*:?\s*#$parentNumber\b"
  })
  foreach ($followUp in $remaining) {
    $followUpNumber = [int]($followUp.number | Select-Object -First 1)
    $createdResult = @(Add-NativeBlockedByDependency -BlockedIssueNumber $parentNumber -BlockingIssueNumber $followUpNumber)
    $created = [bool]($createdResult | Select-Object -Last 1)
    if ($created) {
      Write-Host "Created native dependency: #$parentNumber is blocked by #$followUpNumber"
    }
  }
  $nativeRemaining = @(Get-NativeBlockingIssues -BlockedIssueNumber $parentNumber | Where-Object {
    [string]$_.state -eq 'open'
  })

  if ($remaining.Count -gt 0 -or $nativeRemaining.Count -gt 0) {
    $uniqueBlockers = @(
      @($remaining | ForEach-Object { [int]($_.number | Select-Object -First 1) })
      @($nativeRemaining | ForEach-Object { [int]($_.number | Select-Object -First 1) })
    ) | Select-Object -Unique
    $total = $uniqueBlockers.Count
    Write-Host ("Issue #{0} remains blocked by {1} open follow-up/dependency issue(s)." -f $parentNumber, $total)
    continue
  }

  & $Gh issue edit $parentNumber --repo $Repository --remove-label 'ai:blocked' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to clear ai:blocked from issue #$parentNumber." }
  & $Gh issue comment $parentNumber --repo $Repository --body 'Workflow update: release-blocking follow-ups linked to this implemented PR issue are closed. Removed `ai:blocked`; PR verification may resume.' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to comment unblock on issue #$parentNumber." }
  Write-Host "Cleared ai:blocked from issue #${parentNumber}: $($parent.title)"
  $cleared++
}

Write-Host "Resolved follow-up unblock sweep complete. Cleared: $cleared"
