param(
  [ValidateSet('Prepare')]
  [string]$Mode = 'Prepare',
  [int]$IssueNumber = 0,
  [string]$Repository = 'radialmonster/bigbsky-dev',
  [switch]$NoClaim
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$OutRoot = Join-Path $Root 'out\issue-work'
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }
. (Join-Path $PSScriptRoot 'workflow-lock.ps1')

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

function Get-NativeIssueDependencies {
  param(
    [int]$IssueNumber,
    [ValidateSet('blocked_by', 'blocking')]
    [string]$Direction
  )
  $repo = Get-RepositoryParts
  try {
    $raw = & $Gh api `
      --header 'Accept: application/vnd.github+json' `
      --header 'X-GitHub-Api-Version: 2026-03-10' `
      "repos/$($repo.Owner)/$($repo.Name)/issues/$IssueNumber/dependencies/$Direction"
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { return @() }
    return @(ConvertTo-Array ($raw | ConvertFrom-Json))
  } catch {
    Write-Host "Issue dependency API unavailable while reading #${IssueNumber} ${Direction}: $_" -ForegroundColor Yellow
    return @()
  }
}

function Get-OpenNativeBlockers {
  param([int]$IssueNumber)
  return @(Get-NativeIssueDependencies -IssueNumber $IssueNumber -Direction 'blocked_by' | Where-Object {
    [string]$_.state -eq 'open'
  })
}

function Get-OpenNativeBlockedIssues {
  param([int]$IssueNumber)
  return @(Get-NativeIssueDependencies -IssueNumber $IssueNumber -Direction 'blocking' | Where-Object {
    [string]$_.state -eq 'open'
  })
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function New-BranchSlug {
  param([string]$Title)
  $slug = $Title.ToLowerInvariant()
  $slug = $slug -replace '\[[^\]]+\]', ''
  $slug = $slug -replace '[^a-z0-9]+', '-'
  $slug = $slug.Trim('-')
  if ($slug.Length -gt 56) { $slug = $slug.Substring(0, 56).Trim('-') }
  if ([string]::IsNullOrWhiteSpace($slug)) { return 'work' }
  return $slug
}

function Get-IssueNumberFromText {
  param([string]$Text)
  if ($Text -match '(?im)\b(?:Refs|Fixes|Closes|Resolves)\s+#(?<n>\d+)\b') {
    return [int]$Matches.n
  }
  if ($Text -match '(?im)\bIssue\s+#(?<n>\d+)\b') {
    return [int]$Matches.n
  }
  if ($Text -match '(?im)\bwork/issue-(?<n>\d+)-') {
    return [int]$Matches.n
  }
  return 0
}

function Get-OpenPullRequestIssueNumberSet {
  $set = @{}
  $prs = @(Invoke-GhJson @(
    'pr', 'list',
    '--repo', $Repository,
    '--state', 'open',
    '--json', 'title,body,headRefName',
    '--limit', '100'
  ))
  foreach ($pr in $prs) {
    $issueNumber = Get-IssueNumberFromText -Text "$($pr.title)`n$($pr.body)`n$($pr.headRefName)"
    if ($issueNumber -gt 0) { $set[[string]$issueNumber] = $true }
  }
  return ,$set
}

function Get-OpenPullRequestForIssue {
  param([int]$IssueNumber)
  $prs = @(Invoke-GhJson @(
    'pr', 'list',
    '--repo', $Repository,
    '--state', 'open',
    '--json', 'number,title,body,headRefName,baseRefName,url,comments,files,updatedAt',
    '--limit', '100'
  ))
  foreach ($pr in ($prs | Sort-Object updatedAt -Descending)) {
    $text = "$($pr.title)`n$($pr.body)`n$($pr.headRefName)"
    $linkedIssue = Get-IssueNumberFromText -Text $text
    if ($linkedIssue -eq $IssueNumber) { return $pr }
  }
  return $null
}

function Format-PullRequestContext {
  param([object]$PullRequest)
  if ($null -eq $PullRequest) {
    return 'No open pull request is currently linked to this issue.'
  }
  $filesText = ($PullRequest.files | ForEach-Object {
    "- $($_.path) ($($_.changeType), +$($_.additions)/-$($_.deletions))"
  }) -join "`n"
  if ([string]::IsNullOrWhiteSpace($filesText)) { $filesText = '- none reported' }

  $commentsText = ($PullRequest.comments | ForEach-Object {
    "## PR comment by $($_.author.login) at $($_.createdAt)`n$($_.body)"
  }) -join "`n`n"
  if ([string]::IsNullOrWhiteSpace($commentsText)) { $commentsText = 'No PR comments.' }

  return @"
Open PR: #$($PullRequest.number) $($PullRequest.title)
URL: $($PullRequest.url)
Head branch: $($PullRequest.headRefName)
Base branch: $($PullRequest.baseRefName)

## PR Body

$($PullRequest.body)

## PR Files

$filesText

## PR Comments

$commentsText
"@
}

function Get-RoastMetadata {
  param([string]$Body)
  if ($Body -match '(?s)<!--\s*bigbsky:issue-roast\s+(?<json>\{.*?\})\s*-->') {
    try {
      $parsed = $Matches.json | ConvertFrom-Json
      if ($null -ne $parsed.last_roasted_at) {
        return [pscustomobject]@{
          Count = if ($null -ne $parsed.count) { [int]$parsed.count } else { 0 }
          LastRoastedAt = [DateTimeOffset]::Parse([string]$parsed.last_roasted_at)
        }
      }
    } catch {}
  }
  return $null
}

function Test-WorkflowComment {
  param([string]$Body)
  return ([string]$Body) -match '^(Workflow claim:|Workflow update:|Issue body updated|(?:#{1,6}\s*)?Implementation (?:complete|summary|repair complete|update|verification update)\b|Correction to the implementation metadata\b)'
}

function Get-IssueTimelineEvents {
  param([int]$IssueNumber)
  $repo = Get-RepositoryParts
  try {
    $raw = & $Gh api `
      --header 'Accept: application/vnd.github.mockingbird-preview+json' `
      "repos/$($repo.Owner)/$($repo.Name)/issues/$IssueNumber/timeline"
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { return @() }
    return @(ConvertTo-Array ($raw | ConvertFrom-Json))
  } catch {
    Write-Host "Issue timeline unavailable while checking stale roast state for #${IssueNumber}: $_" -ForegroundColor Yellow
    return @()
  }
}

function Test-IssueChangedAfterRoast {
  param([object]$Issue)
  $metadata = Get-RoastMetadata -Body ([string]$Issue.body)
  if ($null -eq $metadata -or $null -eq $metadata.LastRoastedAt) { return $false }

  $lastRoastedAt = [DateTimeOffset]$metadata.LastRoastedAt
  # The roast script writes LastRoastedAt into the body in the same operation that
  # GitHub records as an `edited` timeline event. Clock drift between the script's
  # local time and GitHub's server time can make the timeline event read as a few
  # seconds AFTER LastRoastedAt, producing a false "human edited the issue" signal
  # and bouncing the issue back to roast forever (#50/#250 stuck loop). Use a
  # 120-second grace window for body edits to absorb that drift; renames/reopens
  # are unambiguously human and remain strict.
  $editGrace = $lastRoastedAt.AddSeconds(120)

  # Non-workflow comments posted after the last roast = human activity.
  $comments = @($Issue.comments | Where-Object {
    ([DateTimeOffset]::Parse([string]$_.createdAt) -gt $lastRoastedAt) -and
    -not (Test-WorkflowComment -Body ([string]$_.body))
  })
  if ($comments.Count -gt 0) { return $true }

  # Manual timeline events after the last roast = human activity.
  # Label changes are intentionally excluded: they are always workflow-generated and
  # update issue.updatedAt, which would otherwise produce false positives.
  $timeline = @(Get-IssueTimelineEvents -IssueNumber ([int]$Issue.number))
  $manualTimelineEvents = @($timeline | Where-Object {
    $eventName = [string]$_.event
    $eventAt = [DateTimeOffset]::Parse([string]$_.created_at)
    if (-not (@('edited', 'renamed', 'reopened') -contains $eventName)) { return $false }
    if ($eventName -eq 'edited') {
      # Body edits within the grace window are treated as the roast's own write.
      return $eventAt -gt $editGrace
    }
    return $eventAt -gt $lastRoastedAt
  })
  if ($manualTimelineEvents.Count -gt 0) { return $true }

  return $false
}

function Send-IssueBackToRoast {
  param([int]$IssueNumber)
  if ($NoClaim) {
    Write-Host "Issue #$IssueNumber has human activity after its last roast and would be returned to issue roast." -ForegroundColor Yellow
    return
  }
  & $Gh issue edit $IssueNumber --repo $Repository --remove-label 'ai:fully-roasted' --add-label 'ai:needs-roast' | Out-Null
  & $Gh issue comment $IssueNumber --repo $Repository --body 'Workflow update: New human activity was detected after the last full roast, so this issue was returned to issue roast before implementation.' | Out-Null
}

function Get-WorkIssueDetail {
  param([int]$IssueNumber)
  return Invoke-GhJson @(
    'issue', 'view', "$IssueNumber",
    '--repo', $Repository,
    '--json', 'number,title,body,labels,comments,url,updatedAt'
  )
}

function Get-NextWorkIssueNumber {
  $rows = Invoke-GhJson @(
    'issue', 'list',
    '--repo', $Repository,
    '--state', 'open',
    '--label', 'ai:fully-roasted',
    '--json', 'number,title,labels,createdAt,updatedAt',
    '--limit', '200'
  )
  $excludedLabels = @('ai:claimed', 'ai:blocked', 'ai:infra-blocked', 'ai:needs-user-answer', 'ai:implemented')
  $eligible = @($rows | Where-Object {
    $names = @($_.labels | ForEach-Object { $_.name })
    -not ($excludedLabels | Where-Object { $names -contains $_ })
  })
  if ($eligible.Count -eq 0) {
    throw 'No open ai:fully-roasted issue is available for implementation.'
  }

  $openPrIssueNumbers = Get-OpenPullRequestIssueNumberSet
  $ranked = @($eligible | ForEach-Object {
    $issueNumber = [int]$_.number
    $openBlockers = @(Get-OpenNativeBlockers -IssueNumber $issueNumber)
    $openBlockedIssues = @(Get-OpenNativeBlockedIssues -IssueNumber $issueNumber)
    [pscustomobject]@{
      Issue = $_
      Number = $issueNumber
      CreatedAt = $_.createdAt
      IsUrgent = @($_.labels | ForEach-Object { $_.name }) -contains 'priority:urgent'
      HasOpenPullRequest = $openPrIssueNumbers.ContainsKey([string]$issueNumber)
      BlocksRelease = @($_.labels | ForEach-Object { $_.name }) -contains 'ai:blocks-release'
      HorizonRank = if (@($_.labels | ForEach-Object { $_.name }) -contains 'short-term') { 0 } elseif (@($_.labels | ForEach-Object { $_.name }) -contains 'long-term') { 2 } else { 1 }
      OpenBlockerCount = $openBlockers.Count
      OpenBlockedCount = $openBlockedIssues.Count
      OpenBlockers = $openBlockers
    }
  })

  $available = @($ranked | Where-Object { $_.OpenBlockerCount -eq 0 })
  if ($available.Count -eq 0) {
    $blockedText = ($ranked | ForEach-Object {
      $blockers = ($_.OpenBlockers | ForEach-Object { "#$($_.number)" }) -join ', '
      "#$($_.Number) blocked by $blockers"
    }) -join '; '
    throw "No open ai:fully-roasted issue is available for implementation without open native blockers. $blockedText"
  }

  $ordered = @($available |
    Sort-Object `
      @{ Expression = { if ($_.IsUrgent) { 0 } else { 1 } } }, `
      @{ Expression = { if ($_.HasOpenPullRequest) { 0 } else { 1 } } }, `
      @{ Expression = { if ($_.BlocksRelease) { 0 } else { 1 } } }, `
      @{ Expression = { if ($_.OpenBlockedCount -gt 0) { 0 } else { 1 } } }, `
      @{ Expression = { -1 * $_.OpenBlockedCount } }, `
      @{ Expression = { $_.HorizonRank } }, `
      @{ Expression = { $_.CreatedAt } })

  foreach ($candidate in $ordered) {
    $detail = Get-WorkIssueDetail -IssueNumber ([int]$candidate.Number)
    if (Test-IssueChangedAfterRoast -Issue $detail) {
      Send-IssueBackToRoast -IssueNumber ([int]$candidate.Number)
      continue
    }
    return [int]$candidate.Number
  }

  throw 'No open ai:fully-roasted issue is available for implementation after stale roast checks.'
}

function New-WorkPrompt {
  param([object]$Issue, [object]$PullRequest)
  $labels = ($Issue.labels | ForEach-Object { $_.name }) -join ', '
  $branchName = "work/issue-$($Issue.number)-$(New-BranchSlug -Title $Issue.title)"
  if ($PullRequest -and $PullRequest.headRefName) {
    $branchName = [string]$PullRequest.headRefName
  }
  $commentsText = ($Issue.comments | ForEach-Object {
    "## Comment by $($_.author.login) at $($_.createdAt)`n$($_.body)"
  }) -join "`n`n"
  $pullRequestContext = Format-PullRequestContext -PullRequest $PullRequest
  return @"
You are implementing Bigbsky GitHub issue #$($Issue.number).

Repository: $Repository
Issue URL: $($Issue.url)
Title: $($Issue.title)
Labels: $labels
Branch: $branchName

Selection policy:
- priority:urgent issues are selected before normal ready issues.
- Issues with open native GitHub ``blocked by`` dependencies are skipped, even if labels are stale.
- Within eligible issues, issues tied to an open PR are selected before ordinary ready issues so failed PRs get repaired before unrelated new work.
- If no urgent or dependency-unblocking issue is available, ai:blocks-release issues are selected before normal ready issues.
- After open-PR and release-blocking issues, issues that unblock other open issues through native GitHub dependencies are selected before ordinary ready issues.
- Otherwise, short-term issues are selected before neutral issues, neutral issues are selected before long-term issues, and older issues win within the same group.
- Issues labeled ai:claimed, ai:blocked, ai:infra-blocked, ai:needs-user-answer, or ai:implemented are skipped.

Rules:
- Use GitHub Issues as the source of truth.
- Do not edit changelog/internal/CHANGELOG.md.
- Implement only the first implementation slice unless a tiny supporting change is required.
- Keep changes scoped and follow existing project patterns.
- Read CLAUDE.md and apply its verification baseline before marking work ready.
- Default local baseline:
  - pnpm install --frozen-lockfile
  - pnpm lint
  - pnpm typecheck
  - pnpm exec prettier --check .
- Add relevant tests, pnpm test, pnpm build, migration/generation checks, or browser checks based on files touched and risk.
- If any baseline command cannot run, report the command, reason, and whether it blocks the work. Do not hide missing tooling.
- Create or reuse the branch named above from the current `origin/main`.
- If an open pull request is listed below, update that PR branch instead of opening a duplicate PR.
- Commit and push one focused commit to that branch, not directly to `main`.
- Open or update a pull request from that branch to `main`.
- Use `Refs #$($Issue.number)` in the PR body. Do not use `Fixes #$($Issue.number)` until the verification loop is responsible for closure.
- Comment on the issue with summary, verification, files touched, and remaining follow-up.
- Remove ai:claimed and ai:fully-roasted, then add ai:implemented, ai:needs-verify, and ai:pr-open when the PR is open and ready for verification.
- Do not close the issue.
- Do not merge the PR in implementation mode.

# Issue Body

$($Issue.body)

# Comments

$commentsText

# Existing Pull Request Context

$pullRequestContext
"@
}

# Selection + claim under a cross-process selection lock.
# Three paths: (1) env-provided target issue (fast-track), (2) explicit
# -IssueNumber (operator override or repair), (3) auto-pick from the ranked
# fully-roasted queue. Paths 2 and 3 go through the selection lock when
# claiming so concurrent SS lanes do not race and pick the same issue.
$selectionLock = $null
$claimedHere = $false
try {
  if ($IssueNumber -le 0) {
    if (![string]::IsNullOrWhiteSpace($env:BIGBSKY_TARGET_ISSUE) -and $env:BIGBSKY_TARGET_ISSUE -match '^\d+$') {
      $IssueNumber = [int]$env:BIGBSKY_TARGET_ISSUE
      Write-Host ("Fast-track: using target issue #$IssueNumber from BIGBSKY_TARGET_ISSUE environment variable.") -ForegroundColor Cyan
    } elseif (!$NoClaim) {
      $selectionLock = Enter-WorkflowWorkSelectionLock -TimeoutSeconds 120
      if (!$selectionLock.Acquired) {
        throw 'Work-issue selection lock timed out after 120s. Another lane may be holding it.'
      }
      $IssueNumber = Get-NextWorkIssueNumber
    } else {
      $IssueNumber = Get-NextWorkIssueNumber
    }
  }

  $issue = Invoke-GhJson @(
    'issue', 'view', "$IssueNumber",
    '--repo', $Repository,
    '--json', 'number,title,body,labels,comments,url,updatedAt'
  )
  $pullRequest = Get-OpenPullRequestForIssue -IssueNumber $IssueNumber

  $labelNames = @($issue.labels | ForEach-Object { $_.name })
  if (($labelNames -contains 'ai:claimed') -and !$NoClaim) {
    throw "Issue #$IssueNumber is already claimed."
  }
  foreach ($blocked in @('ai:blocked', 'ai:infra-blocked', 'ai:needs-user-answer', 'ai:implemented')) {
    if ($labelNames -contains $blocked) { throw "Issue #$IssueNumber has $blocked and is not eligible for work." }
  }
  if (-not ($labelNames -contains 'ai:fully-roasted')) {
    throw "Issue #$IssueNumber is not labeled ai:fully-roasted."
  }
  if (Test-IssueChangedAfterRoast -Issue $issue) {
    Send-IssueBackToRoast -IssueNumber $IssueNumber
    throw "Issue #$IssueNumber has human activity after its last full roast and was returned to ai:needs-roast."
  }
  $openNativeBlockers = @(Get-OpenNativeBlockers -IssueNumber $IssueNumber)
  if ($openNativeBlockers.Count -gt 0) {
    $blockerText = ($openNativeBlockers | ForEach-Object { "#$($_.number)" }) -join ', '
    throw "Issue #$IssueNumber has open native blocker(s): $blockerText and is not eligible for work."
  }

  if (!$NoClaim) {
    if ($null -eq $selectionLock) {
      # Path 2: explicit -IssueNumber. Use per-issue claim lock since no
      # selection race is possible -- the caller already knows the target.
      $claimLock = Enter-WorkflowIssueClaim -IssueNumber $IssueNumber -TimeoutSeconds 15
      if (!$claimLock.Acquired) {
        throw "Issue #$IssueNumber claim lock timed out - another lane may be claiming it."
      }
      try {
        $freshLabels = @((Invoke-GhJson @('issue', 'view', "$IssueNumber", '--repo', $Repository, '--json', 'labels')).labels | ForEach-Object { $_.name })
        if ($freshLabels -contains 'ai:claimed') {
          throw "Issue #$IssueNumber is already claimed."
        }
        & $Gh issue edit $IssueNumber --repo $Repository --add-label 'ai:claimed' | Out-Null
        $claimedHere = $true
        & $Gh issue comment $IssueNumber --repo $Repository --body "Workflow claim: implementation started at $(Get-Date -Format o)." | Out-Null
      } finally {
        Exit-WorkflowIssueClaim -Lock $claimLock
      }
    } else {
      # Path 3: auto-selected; selection lock is still held. Add the claim
      # label and poll until GitHub's API reports it visible before releasing
      # the lock so the next lane in line cannot list the same candidate.
      & $Gh issue edit $IssueNumber --repo $Repository --add-label 'ai:claimed' | Out-Null
      $claimedHere = $true
      $polls = 0
      $maxPolls = 20  # ~5 seconds max
      while ($polls -lt $maxPolls) {
        Start-Sleep -Milliseconds 250
        $check = Invoke-GhJson @('issue', 'view', "$IssueNumber", '--repo', $Repository, '--json', 'labels')
        $checkLabels = @($check.labels | ForEach-Object { $_.name })
        if ($checkLabels -contains 'ai:claimed') { break }
        $polls++
      }
      if ($polls -ge $maxPolls) {
        Write-Host "Warning: ai:claimed label did not become visible within 5s after add for #$IssueNumber; releasing selection lock anyway." -ForegroundColor Yellow
      }
      & $Gh issue comment $IssueNumber --repo $Repository --body "Workflow claim: implementation started at $(Get-Date -Format o)." | Out-Null
    }
  }
} finally {
  if ($null -ne $selectionLock) { Exit-WorkflowWorkSelectionLock -Lock $selectionLock }
}

$dir = Join-Path $OutRoot ("issue-{0}" -f $IssueNumber)
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$promptPath = Join-Path $dir 'prompt.md'
$metaPath = Join-Path $dir 'metadata.json'
Write-Utf8NoBom -Path $promptPath -Content (New-WorkPrompt -Issue $issue -PullRequest $pullRequest)
Write-Utf8NoBom -Path $metaPath -Content (@{
  repository = $Repository
  issue_number = $IssueNumber
  branch = if ($pullRequest -and $pullRequest.headRefName) { [string]$pullRequest.headRefName } else { "work/issue-$IssueNumber-$(New-BranchSlug -Title $issue.title)" }
  pull_request_number = if ($pullRequest) { [int]$pullRequest.number } else { $null }
  generated_at = (Get-Date -Format o)
  prompt_path = $promptPath
  claimed = (-not $NoClaim)
} | ConvertTo-Json -Depth 6)

Write-Host "Prepared issue work bundle:"
Write-Host "  $promptPath"
Write-Host "Issue: #$IssueNumber $($issue.title)"
if ($pullRequest) { Write-Host "Open PR: #$($pullRequest.number) $($pullRequest.title)" }
