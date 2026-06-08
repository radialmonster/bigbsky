param(
  [ValidateSet('Prepare', 'Apply')]
  [string]$Mode = 'Prepare',
  [int]$PullRequestNumber = 0,
  [string]$Repository = 'radialmonster/bigbsky-dev',
  [string]$ResultFile = '',
  [switch]$NoClaim,
  [switch]$KeepClaim
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$OutRoot = Join-Path $Root 'out\pr-verify'
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }
. (Join-Path $PSScriptRoot 'workflow-lock.ps1')

function Assert-GhVerifierPrerequisite {
  if (!(Get-Command $Gh -ErrorAction SilentlyContinue) -and !(Test-Path $Gh)) {
    throw "PR verification requires GitHub CLI. Install GitHub CLI or make gh available on PATH."
  }

  & $Gh --version *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "PR verification requires GitHub CLI version check to succeed."
  }

  & $Gh auth status --hostname github.com *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "PR verification requires GitHub CLI authentication for github.com. Run 'gh auth login --hostname github.com' with an account that can access $Repository."
  }
}

function Invoke-GhJson {
  param([string[]]$CliArgs)
  $raw = & $Gh @CliArgs
  if ($LASTEXITCODE -ne 0) { throw "gh failed: $($CliArgs -join ' ')" }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Set-IssueLabels {
  param(
    [int]$IssueNumber,
    [string[]]$Add = @(),
    [string[]]$Remove = @(),
    [switch]$IgnoreErrors
  )
  $args = @('issue', 'edit', "$IssueNumber", '--repo', $Repository)
  $addLabels = @($Add | Where-Object { ![string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
  $removeLabels = @($Remove | Where-Object { ![string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
  if ($removeLabels.Count -gt 0) {
    try {
      $current = Invoke-GhJson @('issue', 'view', "$IssueNumber", '--repo', $Repository, '--json', 'labels')
      $currentLabels = @($current.labels | ForEach-Object { $_.name })
      $removeLabels = @($removeLabels | Where-Object { $currentLabels -contains $_ })
    } catch {
      if ($IgnoreErrors) { return }
      throw
    }
  }
  if ($addLabels.Count -gt 0) { $args += @('--add-label', ($addLabels -join ',')) }
  if ($removeLabels.Count -gt 0) { $args += @('--remove-label', ($removeLabels -join ',')) }
  if ($args.Count -le 4) { return }
  & $Gh @args 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0 -and !$IgnoreErrors) { throw "Failed to update labels on issue/PR #$IssueNumber." }
}

function Test-WorkflowComment {
  param([string]$Body)
  return $Body -match '^(Workflow claim:|Workflow update:|Issue body updated|(?:#{1,6}\s*)?Implementation (?:complete|summary|repair complete|update|verification update)\b|Correction to the implementation metadata\b|PR verification)'
}

function Get-IssueNumberFromText {
  param([string]$Text)
  if ($Text -match '(?im)\b(?:Refs|Fixes|Closes|Resolves)\s+#(?<n>\d+)\b') {
    return [int]$Matches.n
  }
  if ($Text -match '(?im)\bIssue\s+#(?<n>\d+)\b') {
    return [int]$Matches.n
  }
  return 0
}

function Get-IssueNumberFromUrl {
  param([string]$Url)
  if ($Url -match '/issues/(?<number>\d+)(?:$|[?#])') {
    return [int]$Matches.number
  }
  return 0
}

function Get-NormalizedText {
  param([string]$Text)
  if ($null -eq $Text) { $Text = '' }
  return ($Text.ToLowerInvariant() -replace '[^a-z0-9]+', ' ').Trim()
}

function Get-KeywordSet {
  param([string]$Text)
  $stopWords = @(
    'about', 'after', 'against', 'already', 'before', 'being', 'could', 'from',
    'github', 'issue', 'issues', 'label', 'needs', 'original', 'bigbsky',
    'should', 'that', 'their', 'there', 'these', 'this', 'through', 'track',
    'when', 'where', 'with', 'workflow'
  )
  $seen = @{}
  foreach ($word in ((Get-NormalizedText -Text $Text) -split '\s+')) {
    if ($word.Length -lt 4) { continue }
    if ($stopWords -contains $word) { continue }
    $seen[$word] = $true
  }
  return @($seen.Keys)
}

function Get-KeywordOverlapCount {
  param([string[]]$Left, [string[]]$Right)
  $rightSet = @{}
  foreach ($word in $Right) { $rightSet[$word] = $true }
  $count = 0
  foreach ($word in $Left) {
    if ($rightSet.ContainsKey($word)) { $count++ }
  }
  return $count
}

function Find-OpenSimilarIssue {
  param([string]$Title, [string]$Body)
  if ([string]::IsNullOrWhiteSpace($Title)) { return $null }

  $candidateIssues = @(Invoke-GhJson @(
    'issue', 'list',
    '--repo', $Repository,
    '--state', 'open',
    '--json', 'number,title,body,url',
    '--limit', '100'
  ))
  if ($candidateIssues.Count -eq 0) { return $null }

  $normalizedTitle = Get-NormalizedText -Text $Title
  $titleKeywords = @(Get-KeywordSet -Text $Title)
  $bodyKeywords = @(Get-KeywordSet -Text $Body)

  foreach ($issue in ($candidateIssues | Sort-Object number)) {
    $candidateTitle = [string]$issue.title
    if ((Get-NormalizedText -Text $candidateTitle) -eq $normalizedTitle) {
      return [pscustomobject]@{ Kind = 'exact'; Issue = $issue }
    }

    $candidateTitleKeywords = @(Get-KeywordSet -Text $candidateTitle)
    $candidateBodyKeywords = @(Get-KeywordSet -Text ([string]$issue.body))
    $titleOverlap = Get-KeywordOverlapCount -Left $titleKeywords -Right $candidateTitleKeywords
    $bodyOverlap = Get-KeywordOverlapCount -Left $bodyKeywords -Right $candidateBodyKeywords
    $requiredTitleOverlap = [Math]::Min(3, [Math]::Max(1, $titleKeywords.Count))
    if ($titleKeywords.Count -ge 3 -and $titleOverlap -ge $requiredTitleOverlap -and $bodyOverlap -ge 3) {
      return [pscustomobject]@{ Kind = 'same_scope'; Issue = $issue }
    }
    if (($titleOverlap -ge 1 -and $bodyOverlap -ge 2) -or $bodyOverlap -ge 4) {
      return [pscustomobject]@{ Kind = 'related'; Issue = $issue }
    }
  }

  return $null
}

function Get-FollowUpExcerpt {
  param([string]$Body)
  if ($null -eq $Body) { return '' }
  $normalized = ($Body -replace '\r', '' -split '\n' | Where-Object {
    $line = $_.Trim()
    $line -and $line -notmatch '^(Follow-up from|Original issue:|Refs?\s+#|Related open issue:)'
  } | Select-Object -First 6) -join "`n"
  if ($normalized.Length -gt 1200) {
    return $normalized.Substring(0, 1200).TrimEnd() + "`n..."
  }
  return $normalized
}

function Add-FollowUpFindingToIssue {
  param(
    [int]$IssueNumber,
    [int]$ParentIssueNumber,
    [string]$Title,
    [string]$Body
  )
  $issue = Invoke-GhJson @('issue', 'view', "$IssueNumber", '--repo', $Repository, '--json', 'body')
  $existingBody = [string]$issue.body
  $marker = "<!-- bigbsky:follow-up-source issue=$ParentIssueNumber title=$(Get-NormalizedText -Text $Title) -->"
  if ($existingBody -match [regex]::Escape($marker)) { return }
  $excerpt = Get-FollowUpExcerpt -Body $Body
  $addition = @"

## Additional Finding

$marker

Source issue: #$ParentIssueNumber
Suggested follow-up: $Title

$excerpt
"@
  $dir = Join-Path $OutRoot 'follow-ups'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $bodyPath = Join-Path $dir ("amended-issue-{0}.md" -f $IssueNumber)
  Write-Utf8NoBom -Path $bodyPath -Content ($existingBody.TrimEnd() + $addition)
  & $Gh issue edit $IssueNumber --repo $Repository --body-file $bodyPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to amend existing follow-up issue #$IssueNumber." }
}

function Add-SubIssueRelationship {
  param([int]$ParentIssueNumber, [int]$SubIssueNumber, [string]$Directory)
  $subIssue = Invoke-GhJson @('api', "repos/$Repository/issues/$SubIssueNumber")
  if ($null -eq $subIssue.id) { throw "Could not read REST id for issue #$SubIssueNumber." }
  $payloadPath = Join-Path $Directory ("sub-issue-{0}.json" -f $SubIssueNumber)
  Write-Utf8NoBom -Path $payloadPath -Content (@{
    sub_issue_id = [int64]$subIssue.id
    replace_parent = $true
  } | ConvertTo-Json -Compress)
  & $Gh api --method POST --header 'Accept: application/vnd.github+json' --header 'X-GitHub-Api-Version: 2026-03-10' "repos/$Repository/issues/$ParentIssueNumber/sub_issues" --input $payloadPath | Out-Null
}

function Get-RestIssueId {
  param([int]$Number)
  $issue = Invoke-GhJson @('api', "repos/$Repository/issues/$Number")
  if ($null -eq $issue.id) { throw "Could not read REST id for issue #$Number." }
  return [int64]$issue.id
}

function Get-NativeBlockingIssues {
  param([int]$BlockedIssueNumber)
  $raw = & $Gh api `
    --header 'Accept: application/vnd.github+json' `
    --header 'X-GitHub-Api-Version: 2026-03-10' `
    "repos/$Repository/issues/$BlockedIssueNumber/dependencies/blocked_by" 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { return @() }
  return @(ConvertTo-Array ($raw | ConvertFrom-Json))
}

function Add-NativeBlockedByDependency {
  param(
    [int]$BlockedIssueNumber,
    [int]$BlockingIssueNumber,
    [string]$Directory
  )
  $existing = @(Get-NativeBlockingIssues -BlockedIssueNumber $BlockedIssueNumber | ForEach-Object { [int]$_.number })
  if ($existing -contains $BlockingIssueNumber) { return $false }

  $payloadPath = Join-Path $Directory ("blocked-by-{0}.json" -f $BlockingIssueNumber)
  Write-Utf8NoBom -Path $payloadPath -Content (@{
    issue_id = (Get-RestIssueId -Number $BlockingIssueNumber)
  } | ConvertTo-Json -Compress)
  & $Gh api `
    --method POST `
    --header 'Accept: application/vnd.github+json' `
    --header 'X-GitHub-Api-Version: 2026-03-10' `
    "repos/$Repository/issues/$BlockedIssueNumber/dependencies/blocked_by" `
    --input $payloadPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to add native dependency: #$BlockedIssueNumber blocked by #$BlockingIssueNumber." }
  return $true
}

function Remove-PrWorkflowLabels {
  param(
    [int]$PullRequestNumber,
    [string[]]$Labels = @('ai:claimed', 'ai:implemented', 'ai:needs-verify', 'ai:pr-open')
  )
  Set-IssueLabels -IssueNumber $PullRequestNumber -Remove $Labels -IgnoreErrors
}

function Add-PrWorkflowLabels {
  param([int]$PullRequestNumber, [string[]]$Labels)
  Set-IssueLabels -IssueNumber $PullRequestNumber -Add $Labels -IgnoreErrors
}

function Get-NextPullRequestNumber {
  $prs = Invoke-GhJson @(
    'pr', 'list',
    '--repo', $Repository,
    '--state', 'open',
    '--json', 'number,title,body,createdAt,headRefName,baseRefName',
    '--limit', '100'
  )
  foreach ($pr in $prs | Sort-Object createdAt) {
    $issueNumber = Get-IssueNumberFromText -Text "$($pr.title)`n$($pr.body)`n$($pr.headRefName)"
    if ($issueNumber -le 0) { continue }
    $issue = Invoke-GhJson @(
      'issue', 'view', "$issueNumber",
      '--repo', $Repository,
      '--json', 'number,labels,state'
    )
    $labels = @($issue.labels | ForEach-Object { $_.name })
    if (
      $issue.state -eq 'OPEN' -and
      ($labels -contains 'ai:needs-verify') -and
      ($labels -contains 'ai:pr-open') -and
      -not ($labels -contains 'ai:needs-roast') -and
      -not ($labels -contains 'ai:claimed') -and
      -not ($labels -contains 'ai:blocked') -and
      -not ($labels -contains 'ai:infra-blocked') -and
      -not ($labels -contains 'ai:needs-user-answer')
    ) {
      return [int]$pr.number
    }
  }
  throw 'No open PR linked to an issue labeled ai:needs-verify and ai:pr-open is available.'
}

function Invoke-GitText {
  param([string[]]$GitArgs)
  $output = & git @GitArgs 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git failed: git $($GitArgs -join ' ')`n$($output -join "`n")"
  }
  return ($output -join "`n")
}

function Get-LocalPullRequestDiffSummary {
  param([object]$Pr)

  $baseRef = [string]$Pr.baseRefName
  $prRef = "refs/remotes/origin/pr/$($Pr.number)"
  $baseRemoteRef = "origin/$baseRef"

  Invoke-GitText @('fetch', '--quiet', 'origin', $baseRef) | Out-Null
  Invoke-GitText @('fetch', '--quiet', 'origin', "pull/$($Pr.number)/head:$prRef") | Out-Null

  $nameStatus = Invoke-GitText @('diff', '--name-status', "$baseRemoteRef...$prRef")
  $stat = Invoke-GitText @('diff', '--stat', "$baseRemoteRef...$prRef")
  $numstat = Invoke-GitText @('diff', '--numstat', "$baseRemoteRef...$prRef")

  $changedFiles = @($nameStatus -split '\r?\n' | Where-Object { ![string]::IsNullOrWhiteSpace($_) })
  $importantFiles = @(
    $changedFiles |
      ForEach-Object {
        $parts = $_ -split '\s+'
        $parts[$parts.Count - 1]
      } |
      Where-Object {
        $_ -match '(^|/)(scripts|docs|prompts|changelog|apps|packages|\.github)/' -or
        $_ -match '\.(ps1|ts|tsx|js|json|md|hbs|yml|yaml|prisma|sql)$'
      } |
      Select-Object -First 40
  )

  $preview = ''
  if ($importantFiles.Count -gt 0) {
    $previewArgs = @('diff', '--unified=20', "$baseRemoteRef...$prRef", '--') + $importantFiles
    $preview = Invoke-GitText $previewArgs
    if ($preview.Length -gt 60000) {
      $preview = $preview.Substring(0, 60000).TrimEnd() + "`n...`n[diff preview truncated at 60000 characters]"
    }
  }

  return @"
GitHub PR diff API was unavailable for this PR, so this bundle uses a local git fallback.

Compared range: $baseRemoteRef...$prRef

## Diff Stat

~~~text
$stat
~~~

## Changed Files

~~~text
$nameStatus
~~~

## Numstat

~~~text
$numstat
~~~

## Focused Diff Preview

~~~diff
$preview
~~~
"@
}

function Get-PullRequestDiffText {
  param([object]$Pr)
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $diff = & $Gh pr diff $Pr.number --repo $Repository 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -eq 0) { return ($diff -join "`n") }

  $errorText = ($diff -join "`n")
  if ($errorText -match 'maximum number of files|diff exceeded|PullRequest\.diff too_large|HTTP 406') {
    return Get-LocalPullRequestDiffSummary -Pr $Pr
  }

  throw "Failed to read PR diff for #$($Pr.number).`n$errorText"
}

function Get-PullRequestBundle {
  param([int]$Number)
  $pr = Invoke-GhJson @(
    'pr', 'view', "$Number",
    '--repo', $Repository,
    '--json', 'number,title,body,state,url,headRefName,baseRefName,files,commits,comments,createdAt,updatedAt'
  )
  $issueNumber = Get-IssueNumberFromText -Text "$($pr.title)`n$($pr.body)`n$($pr.headRefName)"
  if ($issueNumber -le 0) { throw "Could not infer linked issue number for PR #$Number. Use Refs #N in the PR body." }
  $issue = Invoke-GhJson @(
    'issue', 'view', "$issueNumber",
    '--repo', $Repository,
    '--json', 'number,title,body,state,labels,comments,url'
  )
  $diff = Get-PullRequestDiffText -Pr $pr
  $fragmentPath = Join-Path $Root ("changelog\unreleased\issue-{0}.md" -f $issueNumber)
  $fragment = if (Test-Path $fragmentPath) { Get-Content -LiteralPath $fragmentPath -Encoding UTF8 -Raw } else { '' }
  return [pscustomobject]@{
    Pr = $pr
    Issue = $issue
    Diff = $diff
    FragmentPath = $fragmentPath
    Fragment = $fragment
  }
}

function New-VerifyPrompt {
  param([object]$Bundle)
  $pr = $Bundle.Pr
  $issue = $Bundle.Issue
  $prFiles = ($pr.files | ForEach-Object { "- $($_.path) ($($_.changeType), +$($_.additions)/-$($_.deletions))" }) -join "`n"
  $prComments = ($pr.comments | ForEach-Object { "## PR comment by $($_.author.login) at $($_.createdAt)`n$($_.body)" }) -join "`n`n"
  $issueLabels = ($issue.labels | ForEach-Object { $_.name }) -join ', '
  $issueComments = ($issue.comments | ForEach-Object { "## Issue comment by $($_.author.login) at $($_.createdAt)`n$($_.body)" }) -join "`n`n"
  return @"
You are verifying Bigbsky pull request #$($pr.number) against GitHub issue #$($issue.number).

Repository: $Repository
PR URL: $($pr.url)
Issue URL: $($issue.url)

Return JSON only using this shape:

~~~json
{
  "pull_request_number": $($pr.number),
  "issue_number": $($issue.number),
  "decision": "pass",
  "comment": "neutral workflow comment for PR and issue",
  "merge_method": "squash",
  "verification_gaps": [
    {
      "command": "command that could not run",
      "reason": "why it could not run",
      "blocking": false,
      "follow_up_needed": true
    }
  ],
  "follow_up_issues": [
    {
      "title": "Follow-up title",
      "body": "Follow-up from Issue #$($issue.number).\n\nDetails...",
      "type": "Bug",
      "labels": ["ai:needs-roast", "ai:follow-up"],
      "blocks_release": false
    }
  ]
}
~~~

Decision values:
- pass: acceptance criteria are satisfied; merge the PR.
- fail: acceptance criteria are not satisfied; keep the PR open and return the issue to needs-roast so the roast loop confirms the spec before repair.
- needs-user-answer: verification found a blocking product/user question.
- blocked: verification is blocked by environment, dependency, or credentials.

Rules:
- Verify the PR against the issue acceptance criteria, not just against the PR description.
- Read CLAUDE.md and apply its verification baseline before deciding pass/fail.
- Bootstrap step (required before any baseline command):
  - pnpm install --frozen-lockfile
  This installs the formatter and all other tooling the baseline needs. A command that fails only because install was skipped is not genuinely unavailable.
- Default local baseline (run after bootstrap):
  - pnpm lint
  - pnpm typecheck
  - pnpm exec prettier --check .
- A command is genuinely unavailable only when it still cannot run after the required bootstrap has completed, or when the repository/worktree context truly does not provide that command. Skipping pnpm install --frozen-lockfile is not a valid reason to treat pnpm exec prettier --check . as unavailable.
- Add relevant tests, pnpm test, pnpm build, migration/generation checks, or browser checks based on files touched and risk.
- Docs-only PRs may use focused docs checks instead of the full app baseline, but any skipped baseline command must be explained in the JSON comment or verification_gaps.
- Treat missing verification as a real failure unless the issue is docs-only and the provided docs checks are enough.
- Verify spec alignment. If the issue or PR changes behavior, API/schema contracts, permissions, workflow rules, billing/inventory/payment logic, routes, or user-facing UX promises, the relevant planning/specs/*.md files should be updated in the same PR or the result must clearly explain why no spec change is needed.
- Treat missing required spec updates as a verification gap. If implemented behavior makes a referenced spec stale, fail the PR or create a release-blocking follow-up when the spec drift is separate but must be fixed before release.
- If any command could not run, record it in verification_gaps.
- A passing result with non-blocking verification_gaps must create follow_up_issues for any repo/tooling problem, such as missing local formatter/test dependencies.
- Do not pass with text like "could not run", "not installed", or "unable to run" unless verification_gaps records the gap and a follow-up issue exists or the gap is explicitly non-actionable.
- Before proposing a follow_up_issue, check the issue context and open follow-up issues. If an issue is an exact duplicate, reference/reuse it instead of proposing a new one. If an issue is similar and same-scope, prefer amending/commenting on that issue with the new finding. If an issue is related but separately actionable, create a new follow-up and reference the related issue.
- Use blocks_release true and include label ai:blocks-release only when the follow-up must be resolved before the parent issue can safely release. Non-blocking adjacent work should leave blocks_release false.
- If acceptance criteria are unmet by the PR's own implementation, use decision "fail" and return the original issue to work.
- If acceptance criteria are unmet because verification exposed a separate release-blocking failure outside the PR's implementation slice, use decision "fail" and include a follow_up_issues entry for that separate blocker. Set blocks_release true and include ai:blocks-release. The apply step will reuse an exact duplicate, amend a same-scope issue, or create a linked follow-up.
- If the acceptance criteria are met but adjacent work is discovered, use decision "pass" and create follow_up_issues.
- Use neutral wording such as `Workflow update:`.
- Do not close the issue directly; the apply script handles labels and closure policy.
- Use merge_method `squash` unless there is a specific reason for `merge` or `rebase`.

# Pull Request

Title: $($pr.title)
State: $($pr.state)
Head: $($pr.headRefName)
Base: $($pr.baseRefName)

## Body

$($pr.body)

## Files

$prFiles

## PR Comments

$prComments

# Linked Issue

Title: $($issue.title)
State: $($issue.state)
Labels: $issueLabels

## Issue Body

$($issue.body)

## Issue Comments

$issueComments

# Changelog Fragment

Path: $($Bundle.FragmentPath)

~~~md
$($Bundle.Fragment)
~~~

# Diff

~~~diff
$($Bundle.Diff)
~~~
"@
}

function Prepare-PrVerify {
  & (Join-Path $Root 'scripts\github-loop\sync-pr-issue-state.ps1') -Repository $Repository
  if ($PullRequestNumber -le 0) {
    if (![string]::IsNullOrWhiteSpace($env:BIGBSKY_TARGET_ISSUE) -and $env:BIGBSKY_TARGET_ISSUE -match '^\d+$') {
      $targetIssue = [int]$env:BIGBSKY_TARGET_ISSUE
      Write-Host ("Fast-track: finding PR linked to issue #$targetIssue from BIGBSKY_TARGET_ISSUE environment variable.") -ForegroundColor Cyan
      $allPrs = @(Invoke-GhJson @('pr', 'list', '--repo', $Repository, '--state', 'open', '--json', 'number,title,body,headRefName', '--limit', '100'))
      foreach ($pr in ($allPrs | Sort-Object updatedAt -Descending)) {
        $linkedNumber = Get-IssueNumberFromText -Text "$($pr.title)`n$($pr.body)`n$($pr.headRefName)"
        if ($linkedNumber -eq $targetIssue) {
          $script:PullRequestNumber = [int]$pr.number
          Write-Host ("Fast-track: found PR #$($script:PullRequestNumber) linked to issue #$targetIssue.") -ForegroundColor Cyan
          break
        }
      }
      if ($script:PullRequestNumber -le 0) {
        Write-Host ("Fast-track: no open PR found linked to issue #$targetIssue; falling back to auto-selection.") -ForegroundColor Yellow
        $script:PullRequestNumber = Get-NextPullRequestNumber
      }
    } else {
      $script:PullRequestNumber = Get-NextPullRequestNumber
    }
  }
  $bundle = Get-PullRequestBundle -Number $PullRequestNumber
  $labels = @($bundle.Issue.labels | ForEach-Object { $_.name })
  if (($labels -contains 'ai:claimed') -and !$NoClaim) {
    throw "Issue #$($bundle.Issue.number) is already claimed."
  }
  if (!$NoClaim) {
    $claimLock = Enter-WorkflowIssueClaim -IssueNumber $bundle.Issue.number -TimeoutSeconds 15
    if (!$claimLock.Acquired) {
      throw "Issue #$($bundle.Issue.number) claim lock timed out - another lane may be claiming it."
    }
    try {
      $freshLabels = @((& $Gh issue view $bundle.Issue.number --repo $Repository --json labels | ConvertFrom-Json).labels | ForEach-Object { $_.name })
      if ($freshLabels -contains 'ai:claimed') {
        throw "Issue #$($bundle.Issue.number) is already claimed."
      }
      & $Gh issue edit $bundle.Issue.number --repo $Repository --add-label 'ai:claimed' | Out-Null
      & $Gh issue comment $bundle.Issue.number --repo $Repository --body "Workflow claim: PR verification started for #$PullRequestNumber at $(Get-Date -Format o)." | Out-Null
    } finally {
      Exit-WorkflowIssueClaim -Lock $claimLock
    }
  }

  $dir = Join-Path $OutRoot ("pr-{0}" -f $PullRequestNumber)
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $promptPath = Join-Path $dir 'prompt.md'
  $resultPath = Join-Path $dir 'result.json'
  $metaPath = Join-Path $dir 'metadata.json'
  Write-Utf8NoBom -Path $promptPath -Content (New-VerifyPrompt -Bundle $bundle)
  Write-Utf8NoBom -Path $resultPath -Content (@{
    pull_request_number = $PullRequestNumber
    issue_number = $bundle.Issue.number
    decision = ''
    comment = ''
    merge_method = 'squash'
    verification_gaps = @()
    follow_up_issues = @()
  } | ConvertTo-Json -Depth 8)
  Write-Utf8NoBom -Path $metaPath -Content (@{
    repository = $Repository
    pull_request_number = $PullRequestNumber
    issue_number = $bundle.Issue.number
    generated_at = (Get-Date -Format o)
    prompt_path = $promptPath
    result_path = $resultPath
    claimed = (-not $NoClaim)
  } | ConvertTo-Json -Depth 6)

  Write-Host "Prepared PR verification bundle:"
  Write-Host "  $promptPath"
  Write-Host "  $resultPath"
  Write-Host "PR: #$PullRequestNumber $($bundle.Pr.title)"
  Write-Host "Issue: #$($bundle.Issue.number) $($bundle.Issue.title)"
}

function Get-PreparedMetadata {
  param([string]$Path)
  $metadataPath = Join-Path (Split-Path -Parent $Path) 'metadata.json'
  if (!(Test-Path $metadataPath)) { return $null }
  return Get-Content -LiteralPath $metadataPath -Encoding UTF8 -Raw | ConvertFrom-Json
}

function New-FollowUpIssue {
  param([int]$ParentIssueNumber, [object]$FollowUp)
  if ([string]::IsNullOrWhiteSpace([string]$FollowUp.title)) { return $null }
  $labels = @('ai:needs-roast', 'ai:follow-up')
  if ($FollowUp.labels) { $labels = @($FollowUp.labels) }
  if ($FollowUp.PSObject.Properties['blocks_release'] -and $FollowUp.blocks_release -eq $true -and $labels -notcontains 'ai:blocks-release') {
    $labels += 'ai:blocks-release'
  }
  if ($FollowUp.PSObject.Properties['blocks_release'] -and $FollowUp.blocks_release -eq $true -and $labels -notcontains 'priority:urgent') {
    $labels += 'priority:urgent'
  }
  $body = [string]$FollowUp.body
  if ([string]::IsNullOrWhiteSpace($body)) {
    $body = "Follow-up from Issue #$ParentIssueNumber.`n`nOriginal issue: #$ParentIssueNumber"
  }
  $dir = Join-Path $OutRoot 'follow-ups'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null

  $similar = Find-OpenSimilarIssue -Title ([string]$FollowUp.title) -Body $body
  if ($similar -and $similar.Kind -in @('exact', 'same_scope')) {
    $existingIssue = $similar.Issue
    $existingNumber = [int]$existingIssue.number
    $existingUrl = [string]$existingIssue.url
    if ($similar.Kind -eq 'same_scope') {
      Add-FollowUpFindingToIssue -IssueNumber $existingNumber -ParentIssueNumber $ParentIssueNumber -Title ([string]$FollowUp.title) -Body $body
    }
    $comment = @"
Workflow update: Reused this existing open follow-up instead of creating a duplicate from Issue #$ParentIssueNumber.

Requested follow-up title: $($FollowUp.title)
"@
    if ($similar.Kind -eq 'same_scope') {
      $comment = @"
Workflow update: Added a related finding from Issue #$ParentIssueNumber to this existing same-scope follow-up instead of creating a duplicate.

Requested follow-up title: $($FollowUp.title)
"@
    }
    & $Gh issue comment $existingNumber --repo $Repository --body $comment | Out-Null
    if ($FollowUp.PSObject.Properties['blocks_release'] -and $FollowUp.blocks_release -eq $true) {
      Add-NativeBlockedByDependency -BlockedIssueNumber $ParentIssueNumber -BlockingIssueNumber $existingNumber -Directory $dir | Out-Null
      & $Gh issue edit $ParentIssueNumber --repo $Repository --add-label 'ai:blocked' | Out-Null
      & $Gh issue edit $existingNumber --repo $Repository --add-label 'ai:blocks-release,priority:urgent' | Out-Null
    } else {
      Add-SubIssueRelationship -ParentIssueNumber $ParentIssueNumber -SubIssueNumber $existingNumber -Directory $dir
    }
    return $existingUrl
  }

  if ($similar -and $similar.Kind -eq 'related') {
    $relatedIssue = $similar.Issue
    $body = "Related open issue: #$($relatedIssue.number) $($relatedIssue.url)`n`n$body"
  }

  $bodyPath = Join-Path $dir ("issue-{0}-{1}.md" -f $ParentIssueNumber, ([guid]::NewGuid().ToString('N')))
  Write-Utf8NoBom -Path $bodyPath -Content $body
  $created = & $Gh issue create --repo $Repository --title ([string]$FollowUp.title) --body-file $bodyPath --label ($labels -join ',')
  if ($LASTEXITCODE -ne 0) { throw "Failed to create follow-up issue: $($FollowUp.title)" }
  $createdUrl = [string]$created
  $createdNumber = Get-IssueNumberFromUrl -Url $createdUrl
  if ($createdNumber -gt 0) {
    if ($FollowUp.type -and @('Bug', 'Feature', 'Task') -contains [string]$FollowUp.type) {
      & $Gh api --method PATCH --header 'Accept: application/vnd.github+json' --header 'X-GitHub-Api-Version: 2026-03-10' "repos/$($Repository)/issues/$createdNumber" -f "type=$($FollowUp.type)" | Out-Null
    }
    if ($FollowUp.PSObject.Properties['blocks_release'] -and $FollowUp.blocks_release -eq $true) {
      Add-NativeBlockedByDependency -BlockedIssueNumber $ParentIssueNumber -BlockingIssueNumber $createdNumber -Directory $dir | Out-Null
      & $Gh issue edit $ParentIssueNumber --repo $Repository --add-label 'ai:blocked' | Out-Null
    } else {
      Add-SubIssueRelationship -ParentIssueNumber $ParentIssueNumber -SubIssueNumber $createdNumber -Directory $dir
    }
    if ($similar -and $similar.Kind -eq 'related') {
      & $Gh issue comment ([int]$similar.Issue.number) --repo $Repository --body "Workflow update: Created related follow-up issue $createdUrl from Issue #$ParentIssueNumber." | Out-Null
    }
  }
  return $createdUrl
}

function Test-SeparateFailureNeedsFollowUp {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  return $Text -match '(?is)\b(outside\s+(this|the)\s+.+?\s+(slice|scope|change|pr)|unrelated\s+(failure|blocker|issue|problem|spec|test)|separate(ly)?\s+(actionable|release-blocking|blocker|failure|issue|problem)|adjacent\s+(risk|work|failure|blocker|issue|problem)|different\s+(file|area|module|spec|test)|another\s+(spec|test|module|area)|focused\s+.+?\s+(checks?|tests?)\s+pass(?:ed|es)?\s+.+?pnpm\s+test\b.+?\bred|targeted\s+.+?\s+(checks?|tests?)\s+pass(?:ed|es)?\s+.+?pnpm\s+test\b.+?\bred)\b'
}

function Set-PullRequestClosingReference {
  param(
    [int]$PullRequestNumber,
    [int]$IssueNumber
  )
  $pr = Invoke-GhJson @(
    'pr', 'view', "$PullRequestNumber",
    '--repo', $Repository,
    '--json', 'body'
  )
  $body = [string]$pr.body
  if ([string]::IsNullOrWhiteSpace($body)) {
    $body = "Closes #$IssueNumber"
  } elseif ($body -match "(?im)^\s*(Refs|References|Related to)\s+#$IssueNumber\b") {
    $body = [regex]::Replace($body, "(?im)^\s*(Refs|References|Related to)\s+#$IssueNumber\b", "Closes #$IssueNumber", 1)
  } elseif ($body -notmatch "(?im)^\s*(Close[sd]?|Fix(e[sd])?|Resolve[sd]?)\s+#$IssueNumber\b") {
    $body = "Closes #$IssueNumber`n`n$body"
  }

  $dir = Join-Path $OutRoot ("pr-{0}" -f $PullRequestNumber)
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $bodyPath = Join-Path $dir 'closing-pr-body.md'
  Write-Utf8NoBom -Path $bodyPath -Content $body
  & $Gh pr edit $PullRequestNumber --repo $Repository --body-file $bodyPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to update PR #$PullRequestNumber body with closing reference to issue #$IssueNumber." }
}

function Apply-PrVerify {
  if ($PullRequestNumber -le 0 -and $ResultFile) {
    $guess = Split-Path -Parent $ResultFile
    if ($guess -match 'pr-(\d+)$') { $script:PullRequestNumber = [int]$Matches[1] }
  }
  if ($PullRequestNumber -le 0) { throw 'Apply requires -PullRequestNumber or a result path under out\pr-verify\pr-N.' }
  if (!$ResultFile) { $ResultFile = Join-Path $OutRoot ("pr-{0}\result.json" -f $PullRequestNumber) }
  if (!(Test-Path $ResultFile)) { throw "Result file not found: $ResultFile" }

  $result = Get-Content -LiteralPath $ResultFile -Encoding UTF8 -Raw | ConvertFrom-Json
  if ([int]$result.pull_request_number -ne $PullRequestNumber) { throw 'Result pull_request_number mismatch.' }
  $issueNumber = [int]$result.issue_number
  if ($issueNumber -le 0) { throw 'Result issue_number is required.' }

  $metadata = Get-PreparedMetadata -Path $ResultFile
  if ($metadata -and $metadata.generated_at) {
    $generatedAt = [DateTimeOffset]::Parse([string]$metadata.generated_at)
    $currentIssue = Invoke-GhJson @('issue', 'view', "$issueNumber", '--repo', $Repository, '--json', 'comments')
    $newUserComments = @($currentIssue.comments | Where-Object {
      ([DateTimeOffset]::Parse([string]$_.createdAt) -gt $generatedAt) -and
      -not (Test-WorkflowComment -Body ([string]$_.body))
    })
    if ($newUserComments.Count -gt 0) {
      if (!$KeepClaim) { & $Gh issue edit $issueNumber --repo $Repository --remove-label 'ai:claimed' | Out-Null }
      throw "New non-workflow issue comment arrived after prepare; rerun Prepare for PR #$PullRequestNumber."
    }
  }

  $decision = [string]$result.decision
  if (@('pass', 'fail', 'needs-user-answer', 'blocked') -notcontains $decision) {
    throw "Invalid decision: $decision"
  }
  $comment = [string]$result.comment
  if ([string]::IsNullOrWhiteSpace($comment)) {
    $comment = "Workflow update: PR verification result is `$decision`."
  }

  $verificationGaps = @()
  if ($result.PSObject.Properties['verification_gaps']) {
    $verificationGaps = @($result.verification_gaps)
  }
  $followUps = @()
  if ($result.PSObject.Properties['follow_up_issues']) {
    $followUps = @($result.follow_up_issues)
  }
  $hasBlockingFollowUp = @($followUps | Where-Object {
    ($_.PSObject.Properties['blocks_release'] -and $_.blocks_release -eq $true) -or
    ($_.labels -and (@($_.labels) -contains 'ai:blocks-release'))
  }).Count -gt 0
  $gapLanguage = '(?i)\b(could not run|couldn''t run|unable to run|not installed|missing dependency|missing tool|command not found|not found|failed to execute)\b'
  $gapText = "$comment`n$($verificationGaps | ConvertTo-Json -Depth 6 -Compress)"
  if ($decision -eq 'pass' -and $gapText -match $gapLanguage) {
    if ($verificationGaps.Count -eq 0) {
      throw 'Passing PR verification mentions missing/unrun checks but verification_gaps is empty.'
    }
    $actionableGaps = @($verificationGaps | Where-Object {
      $null -eq $_.follow_up_needed -or $_.follow_up_needed -eq $true
    })
    if ($actionableGaps.Count -gt 0 -and $followUps.Count -eq 0) {
      throw 'Passing PR verification has actionable verification gaps but no follow_up_issues.'
    }
  }
  $failureText = "$comment`n$($verificationGaps | ConvertTo-Json -Depth 6 -Compress)"
  $separateFailureNeedsFollowUp = Test-SeparateFailureNeedsFollowUp -Text $failureText
  if ($decision -eq 'fail' -and $followUps.Count -eq 0) {
    if ($separateFailureNeedsFollowUp) {
      throw 'Failing PR verification describes a separate/out-of-scope blocker but follow_up_issues is empty. Add or reuse a release-blocking follow-up issue in the result JSON.'
    }
  }

  $followUpUrls = @()
  foreach ($followUp in $followUps) {
    $url = New-FollowUpIssue -ParentIssueNumber $issueNumber -FollowUp $followUp
    if ($url) { $followUpUrls += $url }
  }
  if ($followUpUrls.Count -gt 0) {
    $followUpText = ($followUpUrls | ForEach-Object { "- $_" }) -join "`n"
    $comment = "$comment`n`nFollow-up issues:`n$followUpText"
  }

  & $Gh pr comment $PullRequestNumber --repo $Repository --body $comment | Out-Null
  & $Gh issue comment $issueNumber --repo $Repository --body $comment | Out-Null

  if ($decision -eq 'pass') {
    $method = [string]$result.merge_method
    if (@('merge', 'squash', 'rebase') -notcontains $method) { $method = 'squash' }
    Set-PullRequestClosingReference -PullRequestNumber $PullRequestNumber -IssueNumber $issueNumber
    & $Gh pr merge $PullRequestNumber --repo $Repository "--$method" --delete-branch | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to merge PR #$PullRequestNumber." }
    Set-IssueLabels -IssueNumber $issueNumber `
      -Add @('ai:ready-for-release') `
      -Remove @('ai:claimed', 'ai:pr-open', 'ai:needs-verify', 'ai:fully-roasted', 'ai:implemented', 'priority:urgent', 'ai:blocks-release')
    Remove-PrWorkflowLabels -PullRequestNumber $PullRequestNumber -Labels @('ai:claimed', 'ai:implemented', 'ai:needs-verify', 'ai:pr-open', 'ai:blocked', 'ai:infra-blocked', 'ai:needs-user-answer', 'priority:urgent', 'ai:blocks-release')
    & $Gh issue close $issueNumber --repo $Repository --comment 'Workflow update: PR verification passed and the implementation PR was merged.' | Out-Null
  } elseif ($decision -eq 'fail') {
    if ($separateFailureNeedsFollowUp -and $hasBlockingFollowUp) {
      Set-IssueLabels -IssueNumber $issueNumber `
        -Add @('ai:blocked', 'ai:implemented', 'ai:needs-verify', 'ai:pr-open') `
        -Remove @('ai:claimed', 'ai:fully-roasted', 'ai:blocks-release')
      Remove-PrWorkflowLabels -PullRequestNumber $PullRequestNumber
      Add-PrWorkflowLabels -PullRequestNumber $PullRequestNumber -Labels @('ai:blocked')
    } else {
      Set-IssueLabels -IssueNumber $issueNumber `
        -Add @('ai:needs-roast', 'ai:pr-open') `
        -Remove @('ai:claimed', 'ai:implemented', 'ai:needs-verify', 'ai:fully-roasted')
      Remove-PrWorkflowLabels -PullRequestNumber $PullRequestNumber
    }
  } elseif ($decision -eq 'needs-user-answer') {
    Set-IssueLabels -IssueNumber $issueNumber `
      -Add @('ai:needs-user-answer') `
      -Remove @('ai:claimed', 'ai:implemented', 'ai:needs-verify', 'ai:pr-open')
    Remove-PrWorkflowLabels -PullRequestNumber $PullRequestNumber
    Add-PrWorkflowLabels -PullRequestNumber $PullRequestNumber -Labels @('ai:needs-user-answer')
  } elseif ($decision -eq 'blocked') {
    Set-IssueLabels -IssueNumber $issueNumber `
      -Add @('ai:blocked') `
      -Remove @('ai:claimed', 'ai:implemented', 'ai:needs-verify', 'ai:pr-open')
    Remove-PrWorkflowLabels -PullRequestNumber $PullRequestNumber
    Add-PrWorkflowLabels -PullRequestNumber $PullRequestNumber -Labels @('ai:blocked')
  }

  if (!$KeepClaim) {
    Set-IssueLabels -IssueNumber $issueNumber -Remove @('ai:claimed') -IgnoreErrors
  }
  Write-Host "Applied PR verification result '$decision' to PR #$PullRequestNumber and issue #$issueNumber."
}

Assert-GhVerifierPrerequisite

if ($Mode -eq 'Prepare') { Prepare-PrVerify }
else { Apply-PrVerify }
