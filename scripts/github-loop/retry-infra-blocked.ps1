param(
  [string]$Repository = 'radialmonster/bigbsky-dev',
  [int]$CooldownMinutes = 30
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

function Test-WorkflowInfraBlockComment {
  param([string]$Body)
  # Match any comment that signals an infra block was set — agent-written messages vary in format.
  return $Body -match '(?is)(infrastructure blocked this loop run|ai:infra-blocked|infra.block detected|infra-block|rate limit exceeded|usage limit|quota|model is at capacity|try again at)'
}

$issues = @(Invoke-GhJson @(
  'issue', 'list',
  '--repo', $Repository,
  '--state', 'open',
  '--label', 'ai:infra-blocked',
  '--json', 'number,title,comments,url,updatedAt',
  '--limit', '100'
))

if ($issues.Count -eq 0) {
  Write-Host 'No infra-blocked issues are waiting for retry.'
  exit 0
}

$now = [DateTimeOffset]::UtcNow
$retried = 0
foreach ($issue in ($issues | Sort-Object number)) {
  $infraComments = @($issue.comments | Where-Object { Test-WorkflowInfraBlockComment -Body ([string]$_.body) })

  # Fall back to most recent comment or issue updatedAt if no matching comment found.
  $blockedAt = if ($infraComments.Count -gt 0) {
    $latest = $infraComments | Sort-Object createdAt -Descending | Select-Object -First 1
    [DateTimeOffset]::Parse([string]$latest.createdAt)
  } elseif ($issue.comments.Count -gt 0) {
    $latestComment = $issue.comments | Sort-Object createdAt -Descending | Select-Object -First 1
    [DateTimeOffset]::Parse([string]$latestComment.createdAt)
  } else {
    [DateTimeOffset]::Parse([string]$issue.updatedAt)
  }
  $ageMinutes = ($now - $blockedAt.ToUniversalTime()).TotalMinutes
  if ($ageMinutes -lt $CooldownMinutes) {
    Write-Host ("Issue #{0} remains infra-blocked for {1:n1} more minutes." -f $issue.number, ($CooldownMinutes - $ageMinutes))
    continue
  }

  & $Gh issue edit $issue.number --repo $Repository --remove-label 'ai:infra-blocked' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to clear ai:infra-blocked from issue #$($issue.number)." }
  $retryBody = [string]::Format('Workflow update: automatic infrastructure retry window elapsed after {0} minutes. Removed `ai:infra-blocked`; normal eligible loops may claim this issue again.', $CooldownMinutes)
  & $Gh issue comment $issue.number --repo $Repository --body $retryBody | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to comment retry on issue #$($issue.number)." }
  Write-Host "Cleared ai:infra-blocked from issue #$($issue.number): $($issue.title)"
  $retried++
}

Write-Host "Infra retry sweep complete. Cleared: $retried"
