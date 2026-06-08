param(
  [string]$Repository = 'radialmonster/bigbsky-dev',
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }

function ConvertTo-Array {
  param($Value)
  if ($null -eq $Value) { return @() }
  if ($Value -is [array]) { return $Value }
  return @($Value)
}

function Get-LabelNames {
  param($Item)
  return @(ConvertTo-Array $Item.labels | ForEach-Object { $_.name })
}

function Invoke-GhJson {
  param([string[]]$CliArgs)
  $raw = & $Gh @CliArgs
  if ($LASTEXITCODE -ne 0) { throw "gh failed: $($CliArgs -join ' ')" }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

$issues = @(ConvertTo-Array (Invoke-GhJson @(
  'issue', 'list',
  '--repo', $Repository,
  '--state', 'all',
  '--limit', '200',
  '--json', 'number,title,state,labels,url'
)))

Write-Host ''
Write-Host "Workflow label audit ($(if ($Apply) { 'apply' } else { 'read-only' }))" -ForegroundColor Cyan

$closedOpenStateLabels = @()
$closedReleasedFullyRoasted = @()
$needsRoastFullyRoasted = @()

foreach ($issue in ($issues | Sort-Object number)) {
  $labels = @(Get-LabelNames $issue)
  $isOpen = [string]$issue.state -eq 'OPEN'
  $isFully = $labels -contains 'ai:fully-roasted'
  $needsRoast = $labels -contains 'ai:needs-roast'
  $isReleased = ($labels -contains 'ai:released') -or ($labels -contains 'ai:deployed')
  $hasOpenStateLabel = @('ai:needs-roast', 'ai:claimed', 'ai:implemented', 'ai:needs-verify', 'ai:pr-open', 'ai:blocked', 'ai:infra-blocked', 'ai:needs-user-answer', 'ai:blocks-release') | Where-Object { $labels -contains $_ }

  if (!$isOpen -and $hasOpenStateLabel.Count -gt 0) { $closedOpenStateLabels += [pscustomobject]@{ Issue = $issue; Labels = $hasOpenStateLabel } }
  if (!$isOpen -and $isReleased -and $isFully) { $closedReleasedFullyRoasted += $issue }
  if ($isOpen -and $needsRoast -and $isFully) { $needsRoastFullyRoasted += $issue }
}

if ($Apply) {
  foreach ($item in $closedOpenStateLabels) {
    & $Gh issue edit $item.Issue.number --repo $Repository --remove-label ($item.Labels -join ',')
    if ($LASTEXITCODE -ne 0) { throw "Failed to remove open workflow state labels from closed issue #$($item.Issue.number)" }
  }
  foreach ($issue in $needsRoastFullyRoasted) {
    & $Gh issue edit $issue.number --repo $Repository --remove-label 'ai:fully-roasted'
    if ($LASTEXITCODE -ne 0) { throw "Failed to remove ai:fully-roasted from issue #$($issue.number)" }
  }
  foreach ($issue in $closedReleasedFullyRoasted) {
    & $Gh issue edit $issue.number --repo $Repository --remove-label 'ai:fully-roasted'
    if ($LASTEXITCODE -ne 0) { throw "Failed to remove ai:fully-roasted from issue #$($issue.number)" }
  }
}

function Write-IssueList {
  param([string]$Title, [object[]]$Items)
  Write-Host ''
  Write-Host ("{0}: {1}" -f $Title, $Items.Count) -ForegroundColor Yellow
  if ($Items.Count -eq 0) {
    Write-Host '  none'
    return
  }
  $Items | Select-Object -First 30 | ForEach-Object {
    if ($_.PSObject.Properties.Name -contains 'Issue') {
      Write-Host ("  #{0}: {1} [{2}]" -f $_.Issue.number, $_.Issue.title, ($_.Labels -join ', '))
    } else {
      Write-Host ("  #{0}: {1}" -f $_.number, $_.title)
    }
  }
  if ($Items.Count -gt 30) { Write-Host ("  ... {0} more" -f ($Items.Count - 30)) }
}

Write-IssueList -Title 'Closed issues with open workflow state labels' -Items $closedOpenStateLabels
Write-IssueList -Title 'Closed released issues still marked fully-roasted' -Items $closedReleasedFullyRoasted
Write-IssueList -Title 'Open issues marked both needs-roast and fully-roasted' -Items $needsRoastFullyRoasted

Write-Host ''
Write-Host 'Policy' -ForegroundColor Yellow
Write-Host '  fully-roasted = no meaningful issue-quality gaps remain; implementation may proceed.'
Write-Host '  needs-roast = not fully roasted yet; another roast pass is required.'
Write-Host '  released/deployed closed issues should not keep fully-roasted; release cleanup removes it.'
