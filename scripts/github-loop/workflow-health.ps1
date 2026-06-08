param(
  [string]$Repository = 'radialmonster/bigbsky-dev'
)

$ErrorActionPreference = 'Stop'
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }

function Get-LabelNames {
  param($Item)
  return @($Item.labels | ForEach-Object { $_.name })
}

function ConvertTo-Array {
  param($Value)
  if ($null -eq $Value) { return @() }
  if ($Value -is [array]) { return $Value }
  return @($Value)
}

$issuesRaw = & $Gh issue list --repo $Repository --state open --limit 200 --json number,title,labels,url,createdAt,updatedAt
$readyReleaseRaw = & $Gh issue list --repo $Repository --state closed --label ai:ready-for-release --limit 100 --json number,title,labels,url,createdAt,updatedAt
$prsRaw = & $Gh pr list --repo $Repository --state open --limit 100 --json number,title,labels,url
$issues = @(ConvertTo-Array ($issuesRaw | ConvertFrom-Json))
$readyReleaseIssues = @(ConvertTo-Array ($readyReleaseRaw | ConvertFrom-Json))
$prs = @(ConvertTo-Array ($prsRaw | ConvertFrom-Json))

$buckets = [ordered]@{
  'Waiting on user' = @($issues | Where-Object { (Get-LabelNames $_) -contains 'ai:needs-user-answer' })
  'Infra blocked' = @($issues | Where-Object { (Get-LabelNames $_) -contains 'ai:infra-blocked' })
  'Release blockers' = @($issues | Where-Object { (Get-LabelNames $_) -contains 'ai:blocks-release' })
  'Needs roast' = @($issues | Where-Object {
    $labels = Get-LabelNames $_
    ($labels -contains 'ai:needs-roast') -and
    -not ($labels -contains 'ai:claimed') -and
    -not ($labels -contains 'ai:blocked') -and
    -not ($labels -contains 'ai:infra-blocked') -and
    -not ($labels -contains 'ai:needs-user-answer')
  })
  'Ready for implementation' = @($issues | Where-Object {
    $labels = Get-LabelNames $_
    ($labels -contains 'ai:fully-roasted') -and
    -not ($labels -contains 'ai:claimed') -and
    -not ($labels -contains 'ai:blocked') -and
    -not ($labels -contains 'ai:infra-blocked') -and
    -not ($labels -contains 'ai:needs-user-answer') -and
    -not ($labels -contains 'ai:implemented')
  })
  'Needs PR verify' = @($issues | Where-Object {
    $labels = Get-LabelNames $_
    ($labels -contains 'ai:needs-verify') -and
    ($labels -contains 'ai:pr-open') -and
    -not ($labels -contains 'ai:needs-roast') -and
    -not ($labels -contains 'ai:blocked') -and
    -not ($labels -contains 'ai:infra-blocked')
  })
  'Blocked PR verify' = @($issues | Where-Object {
    $labels = Get-LabelNames $_
    ($labels -contains 'ai:needs-verify') -and
    ($labels -contains 'ai:pr-open') -and
    ($labels -contains 'ai:blocked')
  })
  'Ready for release' = @($readyReleaseIssues)
  'Claimed' = @($issues | Where-Object { (Get-LabelNames $_) -contains 'ai:claimed' })
}

Write-Host ''
Write-Host 'Workflow health' -ForegroundColor Cyan
foreach ($name in $buckets.Keys) {
  $items = @($buckets[$name])
  Write-Host ''
  Write-Host ("{0}: {1}" -f $name, $items.Count) -ForegroundColor Yellow
  $items | Sort-Object number | Select-Object -First 10 | ForEach-Object {
    Write-Host ("  #{0}: {1}" -f $_.number, $_.title)
  }
  if ($items.Count -gt 10) { Write-Host ("  ... {0} more" -f ($items.Count - 10)) }
}

Write-Host ''
Write-Host ("Open PRs: {0}" -f $prs.Count) -ForegroundColor Yellow
$prs | Sort-Object number | ForEach-Object {
  Write-Host ("  PR #{0}: {1}" -f $_.number, $_.title)
}

$inconsistent = @($issues | Where-Object {
  $labels = Get-LabelNames $_
  (
    ($labels -contains 'ai:needs-verify') -and -not ($labels -contains 'ai:pr-open')
  ) -or (
    (($labels -contains 'ai:fully-roasted') -and ($labels -contains 'ai:implemented'))
  ) -or (
    (($labels -contains 'ai:needs-roast') -and (@('ai:fully-roasted', 'ai:implemented', 'ai:needs-verify', 'ai:pr-open') | Where-Object { $labels -contains $_ }))
  ) -or (
    ($labels -contains 'ai:claimed') -and ($labels -contains 'ai:infra-blocked')
  )
})

Write-Host ''
Write-Host ("Possible stale states: {0}" -f $inconsistent.Count) -ForegroundColor Yellow
if ($inconsistent.Count -eq 0) {
  Write-Host '  none'
} else {
  $inconsistent | Sort-Object number | ForEach-Object {
    $labels = (Get-LabelNames $_) -join ', '
    Write-Host ("  #{0}: {1} [{2}]" -f $_.number, $_.title, $labels)
    Write-Host ("    {0}" -f $_.url)
  }
}
