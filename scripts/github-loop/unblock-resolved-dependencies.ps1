param(
  [string]$Repository = 'radialmonster/bigbsky-dev'
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }

function ConvertTo-Array {
  param($Value)
  if ($null -eq $Value) { return @() }
  if ($Value -is [array]) { return $Value }
  return @($Value)
}

function Invoke-GhJson {
  param([string[]]$CliArgs)
  $raw = & $Gh @CliArgs
  if ($LASTEXITCODE -ne 0) { throw "gh failed: $($CliArgs -join ' ')" }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

function Test-IssueClosed {
  param([int]$Number)
  $issue = Invoke-GhJson @(
    'issue', 'view', "$Number",
    '--repo', $Repository,
    '--json', 'state'
  )
  return [string]$issue.state -eq 'CLOSED'
}

function Get-RepositoryParts {
  $parts = $Repository.Split('/')
  if ($parts.Count -ne 2) { throw "Repository must be OWNER/REPO, got: $Repository" }
  return [pscustomobject]@{ Owner = $parts[0]; Name = $parts[1] }
}

function Get-RestIssueId {
  param([int]$Number)
  $repo = Get-RepositoryParts
  $issue = & $Gh api `
    --header 'Accept: application/vnd.github+json' `
    --header 'X-GitHub-Api-Version: 2026-03-10' `
    "repos/$($repo.Owner)/$($repo.Name)/issues/$Number" | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or !$issue.id) { throw "Could not read REST issue id for #$Number." }
  return [int64]$issue.id
}

function Get-NativeBlockingIssueNumbers {
  param([int]$BlockedIssueNumber)
  return @(Get-NativeBlockingIssues -BlockedIssueNumber $BlockedIssueNumber | ForEach-Object { [int]$_.number })
}

function Get-NativeBlockingIssues {
  param([int]$BlockedIssueNumber)
  $repo = Get-RepositoryParts
  try {
    $raw = & $Gh api `
      --header 'Accept: application/vnd.github+json' `
      --header 'X-GitHub-Api-Version: 2026-03-10' `
      "repos/$($repo.Owner)/$($repo.Name)/issues/$BlockedIssueNumber/dependencies/blocked_by"
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { return @() }
    return @(ConvertTo-Array ($raw | ConvertFrom-Json))
  } catch {
    Write-Host "Issue dependency API unavailable while reading #${BlockedIssueNumber}: $_" -ForegroundColor Yellow
    return @()
  }
}

function Add-NativeBlockedByDependency {
  param(
    [int]$BlockedIssueNumber,
    [int]$BlockingIssueNumber
  )
  $existing = @(Get-NativeBlockingIssueNumbers -BlockedIssueNumber $BlockedIssueNumber)
  if ($existing -contains $BlockingIssueNumber) {
    return $false
  }

  $repo = Get-RepositoryParts
  $blockingIssueId = Get-RestIssueId -Number $BlockingIssueNumber
  $payloadPath = Join-Path $env:TEMP ("bigbsky-issue-dependency-{0}-{1}.json" -f $BlockedIssueNumber, $BlockingIssueNumber)
  $payload = @{ issue_id = $blockingIssueId } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($payloadPath, $payload, [System.Text.UTF8Encoding]::new($false))
  try {
    & $Gh api `
      --method POST `
      --header 'Accept: application/vnd.github+json' `
      --header 'X-GitHub-Api-Version: 2026-03-10' `
      "repos/$($repo.Owner)/$($repo.Name)/issues/$BlockedIssueNumber/dependencies/blocked_by" `
      --input $payloadPath | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Remove-Item -LiteralPath $payloadPath -Force -ErrorAction SilentlyContinue
      return $true
    }
  } catch {}
  Remove-Item -LiteralPath $payloadPath -Force -ErrorAction SilentlyContinue

  Write-Host "Could not create native dependency: #$BlockedIssueNumber blocked by #$BlockingIssueNumber" -ForegroundColor Yellow
  return $false
}

function Test-PathExists {
  param([string]$RelativePath)
  return Test-Path -LiteralPath (Join-Path $Root $RelativePath)
}

function Get-DependencyReview {
  param(
    [int]$IssueNumber,
    [string]$Title,
    [string]$Body
  )
  $resolved = New-Object System.Collections.Generic.List[string]
  $unresolved = New-Object System.Collections.Generic.List[string]
  $blockers = New-Object System.Collections.Generic.List[int]

  foreach ($match in [regex]::Matches($Body, '(?im)\bBlocked by\s+#(?<n>\d+)\b')) {
    $blockingIssue = [int]$match.Groups['n'].Value
    if ($blockingIssue -le 0 -or $blockingIssue -eq $IssueNumber) { continue }
    if (Test-IssueClosed $blockingIssue) {
      $resolved.Add("explicit body dependency #$blockingIssue is closed")
    } else {
      $blockers.Add($blockingIssue)
      $unresolved.Add("explicit body dependency #$blockingIssue is not closed")
    }
  }

  $mentionsPlatformCatalog = $Body -match '(?i)(platform-catalog|platform catalog|task 3|issue #3|#3)'
  if ($mentionsPlatformCatalog) {
    $platformSpecExists = Test-PathExists 'planning\specs\platform-catalog.md'
    $platformIssueClosed = Test-IssueClosed 3
    if ($platformSpecExists -and $platformIssueClosed) {
      $resolved.Add('platform catalog boundary is present: planning/specs/platform-catalog.md exists and issue #3 is closed')
    } else {
      $blockers.Add(3)
      if (!$platformSpecExists) { $unresolved.Add('planning/specs/platform-catalog.md is still missing') }
      if (!$platformIssueClosed) { $unresolved.Add('issue #3 is not closed') }
    }
  }

  $createsVendorIntegrationSpec = $Title -match '(?i)vendor catalog import contract'
  $mentionsVendorIntegrations = $Body -match '(?i)(vendor-integrations\.md|provider registry|provider keys|secret field shapes|vendor integration spec)'
  if ($mentionsVendorIntegrations) {
    if ($createsVendorIntegrationSpec) {
      $resolved.Add('this issue is the vendor integration contract task; missing planning/specs/vendor-integrations.md is work to do here, not a blocker')
    } elseif (Test-PathExists 'planning\specs\vendor-integrations.md') {
      $resolved.Add('vendor integration spec is present: planning/specs/vendor-integrations.md exists')
    } else {
      $blockers.Add(4)
      $unresolved.Add('planning/specs/vendor-integrations.md is still missing')
    }
  }

  if ($IssueNumber -eq 26 -or $Body -match '(?i)not be implemented before\s+#24|#24\s+.*provides the rollup endpoint|backend ticket work-source source-set and invoice links') {
    if (Test-IssueClosed 24) {
      $resolved.Add('issue #24 is closed; backend ticket work-source source-set dependency is satisfied')
    } else {
      $blockers.Add(24)
      $unresolved.Add('issue #24 is not closed')
    }
  }

  if ($IssueNumber -eq 28 -or $Body -match '(?i)#24 has landed|once #24 and the reservation slice are present|source-link/reservation Prisma models and migrations from #24') {
    if (Test-IssueClosed 24) {
      $resolved.Add('issue #24 is closed; ticket source-set/source-link prerequisite is satisfied')
    } else {
      $blockers.Add(24)
      $unresolved.Add('issue #24 is not closed')
    }
  }

  if ($IssueNumber -eq 227) {
    if (Test-IssueClosed 25) {
      $resolved.Add('issue #25 is closed; reserved ticket items review dashboard prerequisite is satisfied')
    } else {
      $blockers.Add(25)
      $unresolved.Add('issue #25 (reserved ticket items review dashboard) is not closed')
    }
  }

  return [pscustomobject]@{
    Resolved = @($resolved)
    Unresolved = @($unresolved)
    BlockingIssues = @($blockers | Select-Object -Unique)
  }
}

$issues = @(ConvertTo-Array (Invoke-GhJson @(
  'issue', 'list',
  '--repo', $Repository,
  '--state', 'open',
  '--json', 'number,title,body,labels,url',
  '--limit', '200'
)))

if ($issues.Count -eq 0) {
  Write-Host 'No dependency-blocked issues found.'
  exit 0
}

$cleared = 0
foreach ($issue in ($issues | Sort-Object number)) {
  $labels = @(ConvertTo-Array $issue.labels | ForEach-Object { $_.name })
  if ($labels -contains 'ai:implemented') { continue }
  if ($labels -contains 'ai:pr-open') { continue }

  $evidence = Get-DependencyReview -IssueNumber ([int]$issue.number) -Title ([string]$issue.title) -Body ([string]$issue.body)
  foreach ($blockingIssue in $evidence.BlockingIssues) {
    if ($blockingIssue -gt 0 -and $blockingIssue -ne [int]$issue.number) {
      $created = Add-NativeBlockedByDependency -BlockedIssueNumber ([int]$issue.number) -BlockingIssueNumber $blockingIssue
      if ($created) {
        Write-Host "Created native dependency: #$($issue.number) is blocked by #$blockingIssue"
      }
    }
  }

  $nativeBlockers = @(Get-NativeBlockingIssues -BlockedIssueNumber ([int]$issue.number))
  $openNativeBlockers = @($nativeBlockers | Where-Object { [string]$_.state -eq 'open' })
  if ($openNativeBlockers.Count -gt 0) {
    $blockerText = ($openNativeBlockers | ForEach-Object { "#$($_.number)" }) -join ', '
    if ($labels -notcontains 'ai:blocked') {
      & $Gh issue edit $issue.number --repo $Repository --add-label 'ai:blocked' | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Failed to add ai:blocked to issue #$($issue.number)." }
      & $Gh issue comment $issue.number --repo $Repository --body "Workflow update: native GitHub dependency relationship shows this issue is blocked by open issue(s): $blockerText. Added ``ai:blocked`` so implementation loops skip it until the dependency closes." | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Failed to comment native dependency block on issue #$($issue.number)." }
      Write-Host "Marked issue #$($issue.number) ai:blocked from native dependency: $blockerText"
    } else {
      Write-Host "Issue #$($issue.number) remains blocked by native dependency: $blockerText"
    }
    continue
  }

  if ($nativeBlockers.Count -gt 0) {
    $closedText = ($nativeBlockers | ForEach-Object { "#$($_.number)" }) -join ', '
    $evidence.Resolved += "all native GitHub dependencies are closed: $closedText"
  }

  if ($evidence.Unresolved.Count -gt 0) {
    Write-Host ("Issue #{0} remains blocked: {1}" -f $issue.number, ($evidence.Unresolved -join '; '))
    continue
  }

  if ($labels -notcontains 'ai:blocked') { continue }

  if ($evidence.Resolved.Count -eq 0) {
    Write-Host ("Issue #{0} remains blocked: no known automatic dependency rule matched." -f $issue.number)
    continue
  }

  $body = "Workflow update: automatic dependency unblock sweep removed ``ai:blocked`` because the blocking dependency appears resolved.`n`nResolved evidence:`n"
  $body += (($evidence.Resolved | ForEach-Object { "- $_" }) -join "`n")
  $body += "`n`nThe issue is kept on ``ai:needs-roast`` so the next issue-roast pass can refresh the body against the now-available dependency."

  & $Gh issue edit $issue.number --repo $Repository --add-label 'ai:needs-roast' --remove-label 'ai:blocked' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to move issue #$($issue.number) from ai:blocked to ai:needs-roast." }
  & $Gh issue comment $issue.number --repo $Repository --body $body | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to comment dependency unblock on issue #$($issue.number)." }
  Write-Host "Cleared ai:blocked from issue #$($issue.number): $($issue.title)"
  $cleared++
}

Write-Host "Dependency unblock sweep complete. Cleared: $cleared"
