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

function Get-IssueNumberFromText {
  param([string]$Text)
  $matches = [regex]::Matches($Text, '(?i)(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|issue)\s*:?\s*#(\d+)|\(#(\d+)\)|issue-(\d+)')
  foreach ($match in $matches) {
    for ($i = 1; $i -lt $match.Groups.Count; $i++) {
      if ($match.Groups[$i].Success) { return [int]$match.Groups[$i].Value }
    }
  }
  return 0
}

$prs = @(Invoke-GhJson @(
  'pr', 'list',
  '--repo', $Repository,
  '--state', 'open',
  '--json', 'number,title,body,headRefName,labels',
  '--limit', '100'
))

$cleared = 0
foreach ($pr in ($prs | Sort-Object number)) {
  $issueNumber = Get-IssueNumberFromText -Text "$($pr.title)`n$($pr.body)`n$($pr.headRefName)"
  if ($issueNumber -le 0) { continue }

  $issue = Invoke-GhJson @(
    'issue', 'view', "$issueNumber",
    '--repo', $Repository,
    '--json', 'number,state,labels'
  )
  if ([string]$issue.state -ne 'OPEN') { continue }

  $issueLabels = @($issue.labels | ForEach-Object { $_.name })
  if (($issueLabels -notcontains 'ai:fully-roasted') -or
      ($issueLabels -contains 'ai:implemented') -or
      ($issueLabels -contains 'ai:needs-verify') -or
      ($issueLabels -contains 'ai:pr-open')) {
    continue
  }

  $prLabels = @($pr.labels | ForEach-Object { $_.name })
  $changed = $false
  foreach ($label in @('ai:claimed', 'ai:implemented', 'ai:needs-verify', 'ai:pr-open')) {
    if ($prLabels -contains $label) {
      & $Gh pr edit $pr.number --repo $Repository --remove-label $label 2>$null | Out-Null
      & $Gh issue edit $pr.number --repo $Repository --remove-label $label 2>$null | Out-Null
      $changed = $true
    }
  }

  if ($changed) {
    Write-Host "Cleared stale PR verification labels from PR #$($pr.number); linked issue #$issueNumber is fully-roasted."
    $cleared++
  }
}

Write-Host "Stale PR verification label cleanup complete. Cleared PRs: $cleared"
