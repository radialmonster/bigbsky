param(
  [string]$Repository = 'radialmonster/bigbsky-dev',
  [int]$IssueNumber = 0
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

$claimed = @(ConvertTo-Array (& $Gh issue list --repo $Repository --state open --label ai:claimed --limit 50 --json number,title | ConvertFrom-Json))

if ($claimed.Count -eq 0) {
  Write-Host 'No open issues with ai:claimed found.'
  exit 0
}

Write-Host ''
Write-Host "Open issues with ai:claimed ($($claimed.Count)):" -ForegroundColor Cyan
$claimed | Sort-Object number | ForEach-Object {
  Write-Host ("  #{0}: {1}" -f $_.number, $_.title)
}

if ($IssueNumber -gt 0) {
  $targets = @($claimed | Where-Object { [int]$_.number -eq $IssueNumber })
  if ($targets.Count -eq 0) {
    Write-Host "Issue #$IssueNumber does not have ai:claimed or is not open." -ForegroundColor Yellow
    exit 1
  }
} else {
  Write-Host ''
  $raw = (Read-Host 'Enter issue number to unclaim, "all" to unclaim all, or blank to cancel').Trim().ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($raw)) {
    Write-Host 'Cancelled.' -ForegroundColor Yellow
    exit 0
  }
  if ($raw -eq 'all') {
    $targets = $claimed
  } else {
    $n = 0
    if (![int]::TryParse($raw, [ref]$n) -or $n -le 0) {
      Write-Host 'Invalid input. Cancelled.' -ForegroundColor Yellow
      exit 0
    }
    $targets = @($claimed | Where-Object { [int]$_.number -eq $n })
    if ($targets.Count -eq 0) {
      Write-Host "Issue #$n does not have ai:claimed or is not open." -ForegroundColor Yellow
      exit 1
    }
  }
}

foreach ($issue in $targets) {
  & $Gh issue edit $issue.number --repo $Repository --remove-label 'ai:claimed'
  if ($LASTEXITCODE -ne 0) { throw "Failed to remove ai:claimed from issue #$($issue.number)." }
  Write-Host ("Unclaimed #{0}: {1}" -f $issue.number, $issue.title) -ForegroundColor Green
}
