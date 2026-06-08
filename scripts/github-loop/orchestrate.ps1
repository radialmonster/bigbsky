param(
  [ValidateSet('SafeCycle', 'FullShip', 'DeployFocused', 'DiscussionsToIssues', 'BlockerRecovery', 'IssuesToPr', 'FastTrackIssue', 'FastTrackDiscussion')]
  [string]$Recipe = 'SafeCycle',
  [string]$Profile = 'default',
  [int]$DiscussionTriage = 0,
  [int]$DiscussionPromote = 0,
  [int]$IssueRoast = 0,
  [int]$IssueWork = 0,
  [int]$PrVerifyPreflight = 0,
  [int]$PrVerify = 0,
  [int]$ChangelogRoast = 0,
  [int]$Release = 0,
  [switch]$Deploy,
  [switch]$NoDefaults,
  [switch]$RepeatUntilStop,
  [string]$StopAt = '',
  [int]$SleepBetweenCyclesSec = 60,
  [int]$InfraRetryCooldownMinutes = 30,
  [string]$PrimaryRoot = '',
  [int]$TargetIssueNumber = 0,
  [int]$TargetDiscussionNumber = 0,
  # Deploy throttling. Either or both can be > 0. The deploy step is skipped
  # this cycle unless at least one threshold is satisfied (OR semantics).
  # Both 0 (default) = no throttling, current per-cycle deploy behavior.
  # State lives at $PrimaryRoot/.loop-tmp/last-deploy.json so all lanes share it.
  [int]$DeployAfterReleases = 0,
  [int]$DeployAfterHours = 0
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if ([string]::IsNullOrWhiteSpace($PrimaryRoot)) {
  if ($env:BIGBSKY_PRIMARY_ROOT) { $PrimaryRoot = $env:BIGBSKY_PRIMARY_ROOT }
  else { $PrimaryRoot = [string]$Root }
}
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }
$Repo = 'radialmonster/bigbsky-dev'
$ProfilePath = Join-Path $Root 'config\github-workflow-profiles.json'
$StopFlagPath = Join-Path $Root '.loop-tmp\orchestrator-stop.flag'
$ModelSmokeSummaryPath = Join-Path $Root 'out\model-smoke\latest-summary.json'
$ModelSmokeFreshMinutes = 1440
$StopDeadline = $null
$WorkflowBranch = ''
. (Join-Path $PSScriptRoot 'git-sync.ps1')
. (Join-Path $PSScriptRoot 'workflow-lock.ps1')

function Resolve-StopDeadline {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }

  $tz = [TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time')
  $easternNow = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::Now, $tz)
  $trimmed = $Value.Trim()

  if ($trimmed -match '^\d{1,2}:\d{2}$') {
    $parts = $trimmed -split ':'
    $candidate = [datetime]::new($easternNow.Year, $easternNow.Month, $easternNow.Day, [int]$parts[0], [int]$parts[1], 0)
    if ($candidate -le $easternNow.DateTime) { $candidate = $candidate.AddDays(1) }
    return [DateTimeOffset]::new($candidate, $tz.GetUtcOffset($candidate))
  }

  $parsed = [datetime]::Parse($trimmed)
  return [DateTimeOffset]::new($parsed, $tz.GetUtcOffset($parsed))
}

function Format-EasternTime {
  param([DateTimeOffset]$Value)
  $tz = [TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time')
  $eastern = [TimeZoneInfo]::ConvertTime($Value, $tz)
  return $eastern.ToString('yyyy-MM-dd HH:mm zzz')
}

function Test-OrchestratorStopDue {
  if (Test-Path $StopFlagPath) { return $true }
  if ($null -eq $script:StopDeadline) { return $false }
  return [DateTimeOffset]::Now -ge $script:StopDeadline
}

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

function Get-GitBranchName {
  param([string]$Path = '')
  if ([string]::IsNullOrWhiteSpace($Path)) { $Path = $Root }
  return Get-WorkflowGitBranchName -Path $Path
}

function Get-StepPreset {
  param([string]$Step)
  if (!(Test-Path $ProfilePath)) {
    return 'codex-yolo'
  }
  $profiles = Get-Content -Raw $ProfilePath | ConvertFrom-Json
  if (-not ($profiles.PSObject.Properties.Name -contains $Profile)) {
    throw "Unknown workflow profile '$Profile'. Add it to config\github-workflow-profiles.json or choose one of: $($profiles.PSObject.Properties.Name -join ', ')"
  }
  $profileObject = $profiles.$Profile
  if ($profileObject.PSObject.Properties.Name -contains $Step) {
    return [string]$profileObject.$Step
  }
  return 'codex-yolo'
}

function Test-PresetInfraBlocked {
  param([string]$Preset)
  if ([string]::IsNullOrWhiteSpace($Preset)) { return $false }
  if (!(Test-Path $ModelSmokeSummaryPath)) { return $false }

  try {
    $summary = Get-Content -LiteralPath $ModelSmokeSummaryPath -Encoding UTF8 -Raw | ConvertFrom-Json
  } catch {
    return $false
  }

  $entries = @(ConvertTo-Array $summary)
  foreach ($entry in $entries) {
    if ([string]$entry.preset -ne $Preset) { continue }
    if ([string]$entry.status -ne 'infra-blocked') { continue }
    if (!$entry.ended_at) { return $true }

    try {
      $endedAt = [DateTimeOffset]::Parse([string]$entry.ended_at)
      $ageMinutes = ([DateTimeOffset]::Now - $endedAt).TotalMinutes
      return $ageMinutes -le $ModelSmokeFreshMinutes
    } catch {
      return $true
    }
  }

  return $false
}

function Get-PresetProvider {
  param([string]$Preset)
  if ([string]::IsNullOrWhiteSpace($Preset)) { return 'unknown' }
  if ($Preset -match '^codex') { return 'codex' }
  if ($Preset -eq 'anthropic') { return 'anthropic' }
  if ($Preset -eq 'deepseek') { return 'deepseek' }
  if ($Preset -match '^ollama') { return 'ollama' }
  return 'unknown'
}

function Get-PresetFallbackChain {
  param([string]$Preset)
  $provider = Get-PresetProvider -Preset $Preset
  switch ($provider) {
    'codex' { return @($Preset, 'anthropic') }
    'anthropic' { return @($Preset, 'codex-yolo') }
    default { return @($Preset, 'codex-yolo', 'anthropic') }
  }
}

function Resolve-StepPreset {
  param(
    [string]$Step,
    [string]$Name
  )
  return Get-StepPreset -Step $Step
}

function New-FastTrackPrompt {
  param(
    [string]$Prompt,
    [string]$TargetInstruction
  )
  if ([string]::IsNullOrWhiteSpace($TargetInstruction)) { return $Prompt }
  $promptPath = Join-Path $Root $Prompt
  if (!(Test-Path -LiteralPath $promptPath)) {
    throw "Fast-track prompt file not found: $promptPath"
  }
  $originalContent = Get-Content -LiteralPath $promptPath -Encoding UTF8 -Raw
  $injectedContent = "$TargetInstruction`n`n$originalContent"
  $tempDir = Join-Path $Root '.loop-tmp'
  if (!(Test-Path -LiteralPath $tempDir)) { New-Item -ItemType Directory -Path $tempDir -Force | Out-Null }
  $tempName = ".loop-tmp\fast-track-$($Prompt -replace '[^a-zA-Z0-9.-]', '_')"
  $tempPath = Join-Path $Root $tempName
  [System.IO.File]::WriteAllText($tempPath, $injectedContent, [System.Text.UTF8Encoding]::new($false))
  return $tempName
}

function Invoke-LoopStep {
  param(
    [string]$Name,
    [string]$Step,
    [string]$Prompt,
    [int]$Count,
    [string]$TargetInstruction = ''
  )
  if (Test-OrchestratorStopDue) {
    Write-Host "Stop requested; skipping $Name and ending recipe." -ForegroundColor Yellow
    return $false
  }
  if ($Count -lt 0) {
    $Count = Resolve-AllCount -Step $Step -Name $Name
    Write-Host ("All mode resolved {0} to {1} eligible iteration(s)." -f $Name, $Count) -ForegroundColor Cyan
  } elseif ($Step -in @('discussion_triage', 'discussion_promote', 'issue_roast', 'issue_work', 'pr_verify', 'changelog_roast')) {
    $eligibleCount = Resolve-AllCount -Step $Step -Name $Name
    if ($eligibleCount -lt $Count) {
      Write-Host ("Adjusted {0} from {1} requested iteration(s) to {2} currently eligible iteration(s)." -f $Name, $Count, $eligibleCount) -ForegroundColor Yellow
      $Count = $eligibleCount
    }
  }
  if ($Count -le 0) {
    Write-Host "Skipping $Name; count is 0." -ForegroundColor DarkGray
    return $true
  }
  $effectivePrompt = New-FastTrackPrompt -Prompt $Prompt -TargetInstruction $TargetInstruction
  $preset = Resolve-StepPreset -Step $Step -Name $Name
  Write-Host ''
  Write-Host ("== {0}: {1} iteration(s), preset {2} ==" -f $Name, $Count, $preset) -ForegroundColor Cyan
  $stepStartedAt = Get-Date
  & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'loop.ps1') $preset $effectivePrompt -MaxIterations $Count
  if ($LASTEXITCODE -ne 0) {
    if ($Step -eq 'deploy' -and (Test-VerifiedDeployEvidence -Path $Root -StartedAt $stepStartedAt)) {
      Write-Host "Loop step '$Name' exited $LASTEXITCODE after verified deploy evidence; continuing recipe." -ForegroundColor Yellow
    } else {
      throw "Loop step '$Name' failed with exit code $LASTEXITCODE."
    }
  }
  Restore-OrchestratorWorktree -AfterStep $Name
  if (Test-OrchestratorStopDue) {
    Write-Host "Stop requested after $Name; ending recipe." -ForegroundColor Yellow
    return $false
  }
  return $true
}

function Restore-OrchestratorWorktree {
  param([string]$AfterStep)
  if ([string]::IsNullOrWhiteSpace($script:WorkflowBranch)) { return }

  $currentBranch = Get-GitBranchName
  if ($currentBranch -eq $script:WorkflowBranch) { return }

  $status = @(git status --short)
  if ($status.Count -gt 0) {
    $uncommittedFragments = @($status | Where-Object { $_ -match '^\?\?\s+changelog/unreleased/issue-\d+\.md' } | ForEach-Object { ($_ -replace '^\?\?\s+', '').Trim() })
    if ($uncommittedFragments.Count -gt 0) {
      Write-Host ("Restore-OrchestratorWorktree: auto-committing {0} missing changelog fragment(s) left by '{1}'." -f $uncommittedFragments.Count, $AfterStep) -ForegroundColor Yellow
      foreach ($f in $uncommittedFragments) { git add $f | Out-Null }
      git commit -m "chore(changelog): add missing fragment(s) left uncommitted by issue work" | Out-Null
      git push | Out-Null
    }
    $status = @(git status --short)
  }
  if ($status.Count -gt 0) {
    throw "Workflow step '$AfterStep' left the worktree on '$currentBranch' with dirty paths; refusing to switch back to '$($script:WorkflowBranch)'. Dirty paths:`n$($status -join "`n")"
  }

  Write-Host ("Restoring workflow worktree to branch '{0}' after {1}; current branch was '{2}'." -f $script:WorkflowBranch, $AfterStep, $(if ($currentBranch) { $currentBranch } else { 'detached HEAD' })) -ForegroundColor Yellow
  git switch $script:WorkflowBranch | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to restore workflow branch '$($script:WorkflowBranch)' after $AfterStep." }
}

function Test-VerifiedDeployEvidence {
  # Look for a recent Cloudflare Pages deploy log written by the release lane.
  # The deploy lane is expected to write `.loop-tmp/wrangler-deploy.last.log`
  # with at least two markers after a successful `wrangler pages deploy`:
  #   DEPLOY_VERIFIED_REF_MATCH=1
  #   DEPLOY_VERIFIED_REF=<git tag or branch>
  param(
    [string]$Path,
    [DateTime]$StartedAt
  )
  foreach ($name in @('wrangler-deploy.last.log')) {
    $logPath = Join-Path $Path ".loop-tmp\$name"
    if (!(Test-Path $logPath)) { continue }
    $item = Get-Item -LiteralPath $logPath -ErrorAction SilentlyContinue
    if ($null -eq $item) { continue }
    if ($item.LastWriteTime -lt $StartedAt.AddMinutes(-1)) { continue }
    try {
      $text = Get-Content -LiteralPath $logPath -Encoding UTF8 -Raw
    } catch {
      continue
    }
    if ($text -match 'DEPLOY_VERIFIED_REF_MATCH=1') {
      Write-Host ("Deploy step produced fresh verified deploy evidence in {0}; treating wrapper exit as non-fatal." -f $logPath) -ForegroundColor Yellow
      return $true
    }
  }
  return $false
}

function Invoke-MainLoopStep {
  param(
    [string]$Name,
    [string]$Step,
    [string]$Prompt,
    [int]$Count
  )
  if (Test-OrchestratorStopDue) {
    Write-Host "Stop requested; skipping $Name and ending recipe." -ForegroundColor Yellow
    return $false
  }
  if ($Count -lt 0) {
    $Count = 1
    Write-Host ("Main handoff resolved {0} to {1} iteration(s)." -f $Name, $Count) -ForegroundColor Cyan
  }
  if ($Count -le 0) {
    Write-Host "Skipping $Name; count is 0." -ForegroundColor DarkGray
    return $true
  }
  Sync-WorkflowMainWorktree -Path $PrimaryRoot -Context $Name
  $preset = Resolve-StepPreset -Step $Step -Name $Name
  Write-Host ''
  Write-Host ("== {0}: {1} iteration(s), preset {2}, worktree {3} ==" -f $Name, $Count, $preset, $PrimaryRoot) -ForegroundColor Cyan
  $stepStartedAt = Get-Date
  & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PrimaryRoot 'loop.ps1') $preset $Prompt -MaxIterations $Count
  if ($LASTEXITCODE -ne 0) {
    if ($Step -eq 'deploy' -and (Test-VerifiedDeployEvidence -Path $PrimaryRoot -StartedAt $stepStartedAt)) {
      Write-Host "Main loop step '$Name' exited $LASTEXITCODE after verified deploy evidence; continuing recipe." -ForegroundColor Yellow
    } else {
      throw "Main loop step '$Name' failed with exit code $LASTEXITCODE."
    }
  }
  if (Test-OrchestratorStopDue) {
    Write-Host "Stop requested after $Name; ending recipe." -ForegroundColor Yellow
    return $false
  }
  return $true
}

function Get-LabelNames {
  param($Item)
  return @($Item.labels | ForEach-Object { $_.name })
}

function Get-DiscussionWorkCount {
  param([string]$Mode)
  $query = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){discussions(first:100){nodes{number closed labels(first:20){nodes{name}}}}}}'
  $result = & $Gh api graphql -f "query=$query" -F owner=radialmonster -F name=bigbsky-dev | ConvertFrom-Json
  $discussions = @(ConvertTo-Array $result.data.repository.discussions.nodes | Where-Object { !$_.closed })
  if ($Mode -eq 'triage') {
    return @($discussions | Where-Object {
      $labels = @($_.labels.nodes | ForEach-Object { $_.name })
      (($labels.Count -eq 0) -or ($labels -contains 'ai:needs-triage')) -and
      -not ($labels -contains 'ai:claimed') -and
      -not ($labels -contains 'ai:needs-user-answer')
    }).Count
  }
  return @($discussions | Where-Object {
    $labels = @($_.labels.nodes | ForEach-Object { $_.name })
    ($labels -contains 'ai:ready-to-promote') -and
    -not ($labels -contains 'ai:claimed')
  }).Count
}

function Resolve-AllCount {
  param([string]$Step, [string]$Name)
  switch ($Step) {
    'discussion_triage' { return Get-DiscussionWorkCount -Mode 'triage' }
    'discussion_promote' { return Get-DiscussionWorkCount -Mode 'promote' }
    'issue_roast' {
      $rows = @(ConvertTo-Array (Invoke-GhJson @('issue', 'list', '--repo', $Repo, '--state', 'open', '--json', 'number,labels', '--limit', '200')))
      return @($rows | Where-Object {
        $labels = Get-LabelNames $_
        -not (@('ai:claimed','ai:fully-roasted','ai:blocked','ai:infra-blocked','ai:needs-user-answer') | Where-Object { $labels -contains $_ })
      }).Count
    }
    'issue_work' {
      $rows = @(ConvertTo-Array (Invoke-GhJson @('issue', 'list', '--repo', $Repo, '--state', 'open', '--label', 'ai:fully-roasted', '--json', 'number,labels', '--limit', '200')))
      return @($rows | Where-Object {
        $labels = Get-LabelNames $_
        -not (@('ai:claimed','ai:blocked','ai:infra-blocked','ai:needs-user-answer','ai:implemented') | Where-Object { $labels -contains $_ })
      }).Count
    }
    'pr_verify' {
      $rows = @(ConvertTo-Array (Invoke-GhJson @('issue', 'list', '--repo', $Repo, '--state', 'open', '--label', 'ai:needs-verify', '--json', 'number,labels', '--limit', '200')))
      return @($rows | Where-Object {
        $labels = Get-LabelNames $_
        ($labels -contains 'ai:pr-open') -and
          -not (@('ai:needs-roast','ai:claimed','ai:blocked','ai:infra-blocked','ai:needs-user-answer') | Where-Object { $labels -contains $_ })
      }).Count
    }
    'changelog_roast' {
      $fragmentRoot = Join-Path $Root 'changelog\unreleased'
      if (!(Test-Path $fragmentRoot)) { return 0 }
      return @(Get-ChildItem -Path $fragmentRoot -Filter 'issue-*.md' -File | Where-Object {
        (Get-Content -LiteralPath $_.FullName -Encoding UTF8 -Raw) -match '"status"\s*:\s*"needs-roast"'
      }).Count
    }
    'release' { return 1 }
    default { return 0 }
  }
}

function Invoke-ReleaseFragmentAutoRoast {
  param([switch]$UsePrimary)

  if ($Release -eq 0) { return $true }
  $releaseRoot = if ($UsePrimary) { $PrimaryRoot } else { $Root }
  if ($UsePrimary) {
    Sync-WorkflowMainWorktree -Path $PrimaryRoot -Context 'release fragment auto-roast'
  }

  $maxPasses = 10
  for ($pass = 1; $pass -le $maxPasses; $pass++) {
    if (Test-OrchestratorStopDue) {
      Write-Host 'Stop requested before release fragment auto-roast; ending recipe.' -ForegroundColor Yellow
      return $false
    }

    $releasePrepareOutput = & (Join-Path $releaseRoot 'scripts\github-loop\release.ps1') -Mode Prepare 2>&1
    if ($LASTEXITCODE -ne 0) {
      if (($releasePrepareOutput -join "`n") -match 'No closed issues labeled ai:ready-for-release are available') {
        Write-Host ''
        Write-Host 'Release fragment auto-roast: no release candidates are available.' -ForegroundColor Cyan
        return $true
      }
      throw 'Release preparation failed while checking changelog fragment readiness.'
    }

    $planPath = Join-Path $releaseRoot 'out\release\release-plan.json'
    if (!(Test-Path $planPath)) {
      throw "Release preparation did not write expected plan: $planPath"
    }

    $plan = Get-Content -LiteralPath $planPath -Encoding UTF8 -Raw | ConvertFrom-Json
    $blockingFragments = @(ConvertTo-Array $plan.blocking_fragments)
    if ($blockingFragments.Count -eq 0) {
      Write-Host ''
      Write-Host 'Release fragment auto-roast: no unroasted release fragments remain.' -ForegroundColor Cyan
      return $true
    }

    Write-Host ''
    Write-Host ("Release fragment auto-roast pass {0}: {1} fragment(s) still need roast." -f $pass, $blockingFragments.Count) -ForegroundColor Cyan
    $missingFragments = @($blockingFragments | Where-Object {
      !(Test-Path -LiteralPath ([string]$_.fragment_path))
    })
    if ($missingFragments.Count -gt 0) {
      foreach ($mf in $missingFragments) {
        Write-Host ("  Fragment file missing: {0} (issue #{1}). The work step should create this file." -f [string]$mf.fragment_path, [int]$mf.number) -ForegroundColor Yellow
      }
      Write-Host ("Release fragment auto-roast: {0} fragment file(s) are missing and cannot be roasted here. Stopping auto-roast." -f $missingFragments.Count) -ForegroundColor Yellow
      return $true
    }
    foreach ($fragment in ($blockingFragments | Select-Object -First 5)) {
      if (Test-OrchestratorStopDue) {
        Write-Host 'Stop requested during release fragment auto-roast; ending recipe.' -ForegroundColor Yellow
        return $false
      }

      $fragmentPath = [string]$fragment.fragment_path
      $issueNumber = [int]$fragment.number
      $previousFragmentPath = $env:BIGBSKY_CHANGELOG_FRAGMENT_PATH
      $env:BIGBSKY_CHANGELOG_FRAGMENT_PATH = $fragmentPath
      try {
        if ($UsePrimary) {
          $continued = Invoke-MainLoopStep -Name "Release fragment auto-roast #$issueNumber" -Step 'changelog_roast' -Prompt 'prompt-roast-changelog.txt' -Count 1
        } else {
          $continued = Invoke-LoopStep -Name "Release fragment auto-roast #$issueNumber" -Step 'changelog_roast' -Prompt 'prompt-roast-changelog.txt' -Count 1
        }
      } finally {
        if ($null -eq $previousFragmentPath) {
          Remove-Item Env:\BIGBSKY_CHANGELOG_FRAGMENT_PATH -ErrorAction SilentlyContinue
        } else {
          $env:BIGBSKY_CHANGELOG_FRAGMENT_PATH = $previousFragmentPath
        }
      }
      if (!$continued) { return $false }
    }
  }

  throw "Release fragment auto-roast exceeded $maxPasses passes; inspect changelog fragments and follow-up issues before release."
}

function Test-ReleaseCandidatesAvailable {
  $rows = @(ConvertTo-Array (Invoke-GhJson @(
    'issue', 'list',
    '--repo', $Repo,
    '--state', 'closed',
    '--label', 'ai:ready-for-release',
    '--json', 'number,labels',
    '--limit', '20'
  )))
  foreach ($row in $rows) {
    $labels = Get-LabelNames $row
    if ($labels -notcontains 'ai:released') { return $true }
  }
  return $false
}

function Resolve-PromotedIssueNumber {
  param([int]$DiscussionNumber)
  $query = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){discussion(number:$number){comments(first:20){nodes{body}}}}}'
  $result = Invoke-GhJson @('api', 'graphql', '-f', "query=$query", '-F', 'owner=radialmonster', '-F', 'name=bigbsky-dev', '-F', "number=$DiscussionNumber")
  if ($result -and $result.data -and $result.data.repository -and $result.data.repository.discussion) {
    $comments = @(ConvertTo-Array $result.data.repository.discussion.comments.nodes)
    foreach ($comment in $comments) {
      if ([string]$comment.body -match '(?:promoted to issue|created issue).*?#(\d+)') {
        return [int]$Matches[1]
      }
      if ([string]$comment.body -match 'https://github\.com/[^/]+/[^/]+/issues/(\d+)') {
        return [int]$Matches[1]
      }
    }
  }
  $issues = @(ConvertTo-Array (Invoke-GhJson @('issue', 'list', '--repo', $Repo, '--state', 'all', '--json', 'number,body', '--limit', '50')))
  foreach ($issue in $issues) {
    if ([string]$issue.body -match "Discussion #$DiscussionNumber") {
      return [int]$issue.number
    }
  }
  throw "Could not find the issue promoted from discussion #$DiscussionNumber. The discussion may not have been promoted yet."
}

function Set-RecipeDefaults {
  if ($NoDefaults) { return }

  switch ($Recipe) {
    'DiscussionsToIssues' {
      if ($DiscussionTriage -eq 0) { $script:DiscussionTriage = 5 }
      if ($DiscussionPromote -eq 0) { $script:DiscussionPromote = 5 }
      if ($IssueRoast -eq 0) { $script:IssueRoast = 5 }
    }
    'BlockerRecovery' {
      if ($IssueRoast -eq 0) { $script:IssueRoast = 3 }
      if ($IssueWork -eq 0) { $script:IssueWork = 2 }
      if ($PrVerifyPreflight -eq 0) { $script:PrVerifyPreflight = 1 }
      if ($PrVerify -eq 0) { $script:PrVerify = 2 }
      if ($ChangelogRoast -eq 0) { $script:ChangelogRoast = 2 }
      if ($Release -eq 0) { $script:Release = 1 }
    }
    'IssuesToPr' {
      if ($IssueRoast -eq 0) { $script:IssueRoast = 5 }
      if ($IssueWork -eq 0) { $script:IssueWork = 5 }
      if ($PrVerify -eq 0) { $script:PrVerify = 5 }
    }
    'FullShip' {
      if ($DiscussionTriage -eq 0) { $script:DiscussionTriage = 5 }
      if ($DiscussionPromote -eq 0) { $script:DiscussionPromote = 5 }
      if ($PrVerifyPreflight -eq 0) { $script:PrVerifyPreflight = 1 }
      if ($IssueRoast -eq 0) { $script:IssueRoast = 5 }
      if ($IssueWork -eq 0) { $script:IssueWork = 5 }
      if ($PrVerify -eq 0) { $script:PrVerify = 5 }
      if ($ChangelogRoast -eq 0) { $script:ChangelogRoast = 5 }
      if ($Release -eq 0) { $script:Release = 1 }
    }
    'DeployFocused' {
      if ($PrVerifyPreflight -eq 0) { $script:PrVerifyPreflight = 1 }
      if ($PrVerify -eq 0) { $script:PrVerify = 5 }
      if ($ChangelogRoast -eq 0) { $script:ChangelogRoast = 5 }
      if ($Release -eq 0) { $script:Release = 1 }
      if ($IssueRoast -eq 0) { $script:IssueRoast = 5 }
      if ($IssueWork -eq 0) { $script:IssueWork = 5 }
      if ($DiscussionPromote -eq 0) { $script:DiscussionPromote = 5 }
      if ($DiscussionTriage -eq 0) { $script:DiscussionTriage = 5 }
    }
    'FastTrackIssue' {
      if ($IssueRoast -eq 0) { $script:IssueRoast = 1 }
      if ($IssueWork -eq 0) { $script:IssueWork = 1 }
      if ($PrVerify -eq 0) { $script:PrVerify = 1 }
      if ($ChangelogRoast -eq 0) { $script:ChangelogRoast = 1 }
      if ($Release -eq 0) { $script:Release = 1 }
    }
    'FastTrackDiscussion' {
      if ($DiscussionTriage -eq 0) { $script:DiscussionTriage = 1 }
      if ($DiscussionPromote -eq 0) { $script:DiscussionPromote = 1 }
      if ($IssueRoast -eq 0) { $script:IssueRoast = 1 }
      if ($IssueWork -eq 0) { $script:IssueWork = 1 }
      if ($PrVerify -eq 0) { $script:PrVerify = 1 }
      if ($ChangelogRoast -eq 0) { $script:ChangelogRoast = 1 }
      if ($Release -eq 0) { $script:Release = 1 }
    }
    default {
      if ($PrVerifyPreflight -eq 0) { $script:PrVerifyPreflight = 1 }
      if ($IssueRoast -eq 0) { $script:IssueRoast = 2 }
      if ($IssueWork -eq 0) { $script:IssueWork = 2 }
      if ($PrVerify -eq 0) { $script:PrVerify = 2 }
      if ($ChangelogRoast -eq 0) { $script:ChangelogRoast = 2 }
      if ($Release -eq 0) { $script:Release = 1 }
    }
  }
}

function Set-ReleaseBlockersUrgent {
  if ($Recipe -notin @('SafeCycle', 'FullShip', 'DeployFocused', 'BlockerRecovery', 'FastTrackIssue', 'FastTrackDiscussion')) { return }
  Write-Host ''
  Write-Host 'Checking release blockers for urgent priority...' -ForegroundColor Cyan
  $raw = & $Gh issue list --repo $Repo --state open --label ai:blocks-release --limit 50 --json number,labels
  $issues = @(ConvertTo-Array ($raw | ConvertFrom-Json))
  foreach ($issue in $issues) {
    $labels = @($issue.labels | ForEach-Object { $_.name })
    if ($labels -notcontains 'priority:urgent') {
      & $Gh issue edit $issue.number --repo $Repo --add-label 'priority:urgent'
      Write-Host ("  marked #{0} priority:urgent" -f $issue.number)
    }
  }
  if ($issues.Count -eq 0) {
    Write-Host '  none'
  }
}

function Test-CanReleaseFromThisWorktree {
  $branch = Get-GitBranchName
  if ($branch -eq 'main') { return $true }
  Write-Host ''
  Write-Host "Skipping release/deploy in lane worktree on branch '$branch'; release apply must run from main." -ForegroundColor Yellow
  return $false
}

function Get-WorkflowOwnerName {
  $branch = Get-GitBranchName
  if ($branch -match '^lane/(.+)$') { return $Matches[1] }
  if (![string]::IsNullOrWhiteSpace($branch)) { return $branch }
  return "pid-$PID"
}

function Get-DeployStatePath {
  return Join-Path $PrimaryRoot '.loop-tmp\last-deploy.json'
}

function Test-DeployThrottleAllows {
  # Returns $true if the current cycle is allowed to run the deploy step.
  # Either both thresholds are 0 (no throttling) or at least one is satisfied.
  if ($DeployAfterReleases -le 0 -and $DeployAfterHours -le 0) { return $true }
  $statePath = Get-DeployStatePath
  if (!(Test-Path $statePath)) {
    Write-Host "Deploy throttle: no last-deploy state at $statePath; allowing first deploy." -ForegroundColor DarkGray
    return $true
  }
  try {
    $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
    $lastDeployedAt = [DateTimeOffset]::Parse([string]$state.deployedAt)
  } catch {
    Write-Host "Deploy throttle: state file unreadable ($_); allowing deploy this cycle." -ForegroundColor Yellow
    return $true
  }
  $now = [DateTimeOffset]::UtcNow
  $reasons = New-Object System.Collections.Generic.List[string]
  $hoursSince = ($now - $lastDeployedAt).TotalHours
  if ($DeployAfterHours -gt 0 -and $hoursSince -ge $DeployAfterHours) {
    $reasons.Add(("hours-since-last-deploy={0:n1}>={1}" -f $hoursSince, $DeployAfterHours)) | Out-Null
  }
  $releasesSince = 0
  if ($DeployAfterReleases -gt 0) {
    try {
      $rels = & $Gh release list --repo $Repo --limit 50 --json publishedAt
      if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($rels)) {
        $parsed = $rels | ConvertFrom-Json
        $newer = @($parsed | Where-Object {
          $pa = [string]$_.publishedAt
          if ([string]::IsNullOrWhiteSpace($pa)) { return $false }
          return [DateTimeOffset]::Parse($pa) -gt $lastDeployedAt
        })
        $releasesSince = $newer.Count
        if ($releasesSince -ge $DeployAfterReleases) {
          $reasons.Add(("releases-since-last-deploy={0}>={1}" -f $releasesSince, $DeployAfterReleases)) | Out-Null
        }
      }
    } catch {
      Write-Host "Deploy throttle: release count query failed ($_); not gating on release count this cycle." -ForegroundColor Yellow
    }
  }
  if ($reasons.Count -gt 0) {
    Write-Host ("Deploy throttle: threshold met ({0}); allowing deploy." -f ($reasons -join ', ')) -ForegroundColor Cyan
    return $true
  }
  $msg = "Deploy throttle: skipping deploy this cycle. Last deployed {0:n1}h ago" -f $hoursSince
  if ($DeployAfterHours -gt 0) { $msg += " (need {0}h)" -f $DeployAfterHours }
  if ($DeployAfterReleases -gt 0) { $msg += "; {0} releases since (need {1})" -f $releasesSince, $DeployAfterReleases }
  Write-Host $msg -ForegroundColor Yellow
  return $false
}

function Get-VerifiedDeployRef {
  # Parse the most recent deploy log for the verified ref so Record-DeployState
  # can save which tag was actually deployed. Empty string if not parseable.
  param([string]$EvidencePath)
  if ([string]::IsNullOrWhiteSpace($EvidencePath)) { $EvidencePath = $PrimaryRoot }
  foreach ($name in @('wrangler-deploy.last.log')) {
    $logPath = Join-Path $EvidencePath ".loop-tmp\$name"
    if (!(Test-Path $logPath)) { continue }
    try {
      $text = Get-Content -LiteralPath $logPath -Encoding UTF8 -Raw -ErrorAction SilentlyContinue
    } catch { continue }
    if ([string]::IsNullOrWhiteSpace($text)) { continue }
    if ($text -match '(?m)^DEPLOY_VERIFIED_REF=(?<ref>\S+)') {
      return [string]$Matches.ref
    }
  }
  return ''
}

function Record-DeployState {
  # Records the most recent successful deploy: timestamp and (when parseable
  # from the deploy log) the verified release tag. The tag is what
  # Test-UndeployedReleaseExists compares against the latest GitHub release.
  param([string]$EvidencePath = '')
  $deployedTag = Get-VerifiedDeployRef -EvidencePath $EvidencePath
  $statePath = Get-DeployStatePath
  $stateDir = Split-Path -Parent $statePath
  if (!(Test-Path $stateDir)) { New-Item -ItemType Directory -Force -Path $stateDir | Out-Null }
  $state = [ordered]@{
    deployedAt = [DateTimeOffset]::UtcNow.ToString('o')
    deployedTag = $deployedTag
  } | ConvertTo-Json
  Set-Content -LiteralPath $statePath -Value $state -Encoding UTF8
  $tagText = if ([string]::IsNullOrWhiteSpace($deployedTag)) { '<unknown tag>' } else { $deployedTag }
  Write-Host "Deploy throttle: recorded successful deploy at $(Get-Date -Format o) (tag=$tagText) in $statePath" -ForegroundColor DarkGray
}

function Test-UndeployedReleaseExists {
  # Returns $true when GitHub has a release tag newer than what
  # last-deploy.json says was deployed. This catches the case where an issue
  # lane tagged a release but the deploy lane never ran a deploy for it -- the
  # release sits as a tag without code reaching production. Returns $false if
  # last-deploy.json is missing (the throttle/candidate logic handles the
  # first-deploy case).
  $statePath = Get-DeployStatePath
  if (!(Test-Path $statePath)) { return $false }
  try {
    $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
    $lastDeployedTag = [string]$state.deployedTag
  } catch {
    return $false
  }
  if ([string]::IsNullOrWhiteSpace($lastDeployedTag)) { return $false }
  try {
    $rels = & $Gh release list --repo $Repo --limit 1 --json tagName
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($rels)) { return $false }
    $latest = ($rels | ConvertFrom-Json) | Select-Object -First 1
    $latestTag = [string]$latest.tagName
    if ([string]::IsNullOrWhiteSpace($latestTag)) { return $false }
    if ($latestTag -eq $lastDeployedTag) { return $false }
    Write-Host "Undeployed release detected: latest tag=$latestTag, last deployed tag=$lastDeployedTag. Deploy step will run even without new release candidates." -ForegroundColor Cyan
    return $true
  } catch {
    return $false
  }
}

function Invoke-ThrottledDeployStep {
  # Wraps the deploy loop step with throttle check + state-write-on-success.
  # Returns $true if a deploy attempt ran (regardless of outcome), $false if skipped by throttle.
  param(
    [string]$Name,
    [bool]$UseMainWorktreeStep,
    [string]$EvidencePath
  )
  if (!(Test-DeployThrottleAllows)) { return $false }
  $deployStart = Get-Date
  if ($UseMainWorktreeStep) {
    [void](Invoke-MainLoopStep -Name $Name -Step 'deploy' -Prompt 'prompt-github-release-deploy.txt' -Count 1)
  } else {
    [void](Invoke-LoopStep -Name $Name -Step 'deploy' -Prompt 'prompt-github-release-deploy.txt' -Count 1)
  }
  if (Test-VerifiedDeployEvidence -Path $EvidencePath -StartedAt $deployStart) {
    Record-DeployState -EvidencePath $EvidencePath
  }
  return $true
}

function Invoke-ReleaseDeployPhase {
  param([string]$Suffix = '')
  $hasCandidates = Test-ReleaseCandidatesAvailable
  $hasUndeployedTag = $false
  if ($Deploy -and -not $hasCandidates) { $hasUndeployedTag = Test-UndeployedReleaseExists }
  if (-not $hasCandidates -and -not $hasUndeployedTag) {
    Write-Host ''
    Write-Host "Skipping release/deploy$Suffix; no closed ai:ready-for-release issues are available and no undeployed release tag detected." -ForegroundColor DarkGray
    return $true
  }

  $lock = Enter-WorkflowReleaseDeployLock -Root $PrimaryRoot -Lane (Get-WorkflowOwnerName) -Worktree $Root -Step "release/deploy$Suffix" -TimeoutSeconds 0
  if (!$lock.Acquired) {
    $owner = if ($lock.Status -and $lock.Status.Lane) { $lock.Status.Lane } else { 'another workflow' }
    $pidText = if ($lock.Status -and $lock.Status.Pid) { " PID $($lock.Status.Pid)" } else { '' }
    Write-Host ''
    Write-Host "Skipping release/deploy$Suffix; release/deploy lock is held by $owner$pidText. This lane will continue with backlog work." -ForegroundColor Yellow
    Exit-WorkflowReleaseDeployLock -Lock $lock -Root $PrimaryRoot
    return $true
  }

  try {
    $hasCandidates = Test-ReleaseCandidatesAvailable
    $hasUndeployedTag = $false
    if ($Deploy -and -not $hasCandidates) { $hasUndeployedTag = Test-UndeployedReleaseExists }
    if (-not $hasCandidates -and -not $hasUndeployedTag) {
      Write-Host ''
      Write-Host "Skipping release/deploy$Suffix; candidates were consumed and no undeployed tag detected after lock acquisition." -ForegroundColor DarkGray
      return $true
    }

    $branch = Get-GitBranchName
    if ($branch -eq 'main') {
      $continue = $true
      if ($hasCandidates) {
        $continue = Invoke-ReleaseFragmentAutoRoast
        if ($continue) { $continue = Invoke-LoopStep -Name "Release creation$Suffix" -Step 'release' -Prompt 'prompt-github-release.txt' -Count $Release }
      } else {
        Write-Host ''
        Write-Host "Release/deploy${Suffix}: no new release candidates this cycle, but an undeployed release tag exists. Running deploy step only." -ForegroundColor Cyan
      }
      if ($continue -and $Deploy -and ($hasCandidates -or $hasUndeployedTag)) { [void](Invoke-ThrottledDeployStep -Name "Release deploy$Suffix" -UseMainWorktreeStep $false -EvidencePath $Root) }
      return $continue
    }

    if ($Recipe -eq 'DeployFocused') {
      $handoffLabel = if ($Deploy) { 'release/deploy' } else { 'release' }
      Write-Host ''
      Write-Host "Release/deploy handoff: lane branch '$branch' cannot apply releases directly; running $handoffLabel from primary main worktree $PrimaryRoot." -ForegroundColor Cyan
      $continue = $true
      if ($hasCandidates) {
        $continue = Invoke-ReleaseFragmentAutoRoast -UsePrimary
        if ($continue) { $continue = Invoke-MainLoopStep -Name "Release creation$Suffix" -Step 'release' -Prompt 'prompt-github-release.txt' -Count $Release }
      } else {
        Write-Host ''
        Write-Host "Release/deploy$Suffix handoff: no new release candidates this cycle, but an undeployed release tag exists. Running deploy step only from primary main worktree." -ForegroundColor Cyan
      }
      if ($continue -and $Deploy -and ($hasCandidates -or $hasUndeployedTag)) { [void](Invoke-ThrottledDeployStep -Name "Release deploy$Suffix" -UseMainWorktreeStep $true -EvidencePath $PrimaryRoot) }
      return $continue
    }
  } finally {
    Exit-WorkflowReleaseDeployLock -Lock $lock -Root $PrimaryRoot
  }

  [void](Test-CanReleaseFromThisWorktree)
  return $true
}

function Invoke-DeployFocusedBacklog {
  $readyIssueCount = 0
  if ($IssueWork -gt 0) {
    $readyIssueCount = Resolve-AllCount -Step 'issue_work' -Name 'Issue implementation'
  }
  if (($IssueWork -gt 0) -and ($readyIssueCount -gt 0)) {
    Write-Host ''
    Write-Host ("Deploy-focused repair round: {0} fully-roasted issue(s) are ready. Repairing one highest-priority issue, then immediately retrying PR verification/release." -f $readyIssueCount) -ForegroundColor Cyan
    $continue = Invoke-LoopStep -Name 'Issue repair' -Step 'issue_work' -Prompt 'prompt-github-issue-work.txt' -Count $IssueWork
    if ($continue) { $continue = Invoke-LoopStep -Name 'PR verification after issue repair' -Step 'pr_verify' -Prompt 'prompt-github-pr-verify.txt' -Count $PrVerify }
    if ($continue) { $continue = Invoke-ReleaseDeployPhase -Suffix ' after issue repair' }
    return $continue
  }

  $roastIssueCount = 0
  if ($IssueRoast -gt 0) {
    $roastIssueCount = Resolve-AllCount -Step 'issue_roast' -Name 'Issue roast'
  }
  if (($IssueRoast -gt 0) -and ($roastIssueCount -gt 0)) {
    Write-Host ''
    Write-Host ("Deploy-focused backlog: no ready issue work; roasting one eligible issue, then attempting one repair and retrying PR verification/release." -f $roastIssueCount) -ForegroundColor Cyan
    $continue = Invoke-LoopStep -Name 'Issue roast' -Step 'issue_roast' -Prompt 'prompt-github-issue-roast.txt' -Count $IssueRoast
    if ($continue -and ($IssueWork -gt 0)) { $continue = Invoke-LoopStep -Name 'Issue repair after roast' -Step 'issue_work' -Prompt 'prompt-github-issue-work.txt' -Count $IssueWork }
    if ($continue) { $continue = Invoke-LoopStep -Name 'PR verification after roasted issue repair' -Step 'pr_verify' -Prompt 'prompt-github-pr-verify.txt' -Count $PrVerify }
    if ($continue) { $continue = Invoke-ReleaseDeployPhase -Suffix ' after roasted issue repair' }
    return $continue
  }

  $readyDiscussionCount = 0
  if ($DiscussionPromote -gt 0) {
    $readyDiscussionCount = Resolve-AllCount -Step 'discussion_promote' -Name 'Discussion promotion'
  }
  if (($DiscussionPromote -gt 0) -and ($readyDiscussionCount -gt 0)) {
    Write-Host ''
    Write-Host ("Deploy-focused backlog: no eligible issue backlog; promoting {0} ready discussion(s)." -f $readyDiscussionCount) -ForegroundColor Cyan
    $continue = Invoke-LoopStep -Name 'Discussion promotion fallback' -Step 'discussion_promote' -Prompt 'prompt-github-discussion-promote.txt' -Count $DiscussionPromote
    if ($continue -and ($IssueRoast -gt 0)) { $continue = Invoke-LoopStep -Name 'Issue roast after discussion promotion' -Step 'issue_roast' -Prompt 'prompt-github-issue-roast.txt' -Count $IssueRoast }
    return $continue
  }

  $triageDiscussionCount = 0
  if ($DiscussionTriage -gt 0) {
    $triageDiscussionCount = Resolve-AllCount -Step 'discussion_triage' -Name 'Discussion triage'
  }
  if (($DiscussionTriage -gt 0) -and ($triageDiscussionCount -gt 0)) {
    Write-Host ''
    Write-Host ("Deploy-focused backlog: no ready discussions to promote; triaging {0} discussion(s)." -f $triageDiscussionCount) -ForegroundColor Cyan
    return Invoke-LoopStep -Name 'Discussion triage fallback' -Step 'discussion_triage' -Prompt 'prompt-github-discussion-triage.txt' -Count $DiscussionTriage
  }

  Write-Host ''
  Write-Host 'Deploy-focused backlog: no eligible PR, release, issue, or discussion work found this cycle.' -ForegroundColor DarkGray
  return $true
}

function Invoke-OrchestratorCycle {
  param([int]$Cycle)

  Write-Host ''
  Write-Host ("===== Orchestrator cycle {0} =====" -f $Cycle) -ForegroundColor Cyan
  Write-Host ("Workflow recipe: {0}" -f $Recipe) -ForegroundColor Cyan
  Write-Host ("Model profile: {0}" -f $Profile) -ForegroundColor Cyan
  Write-Host ("Deploy enabled: {0}" -f [bool]$Deploy) -ForegroundColor Cyan
  Write-Host ("Repeat until stopped: {0}" -f [bool]$RepeatUntilStop) -ForegroundColor Cyan
  if ($TargetIssueNumber -gt 0) { Write-Host "Target issue: #$TargetIssueNumber" -ForegroundColor Cyan }
  if ($TargetDiscussionNumber -gt 0) { Write-Host "Target discussion: #$TargetDiscussionNumber" -ForegroundColor Cyan }
  if ($null -ne $script:StopDeadline) {
    Write-Host ("Stop deadline: {0} Eastern" -f (Format-EasternTime -Value $script:StopDeadline)) -ForegroundColor Cyan
  }

  Sync-WorkflowLaneWorktreeIfSafe -Path $Root -LaneBranch $script:WorkflowBranch

  & .\scripts\github-loop\retry-infra-blocked.ps1 -CooldownMinutes $InfraRetryCooldownMinutes
  & .\scripts\github-loop\unblock-resolved-followups.ps1
  & .\scripts\github-loop\unblock-resolved-dependencies.ps1
  & .\scripts\github-loop\sync-pr-issue-state.ps1
  $currentBranch = Get-GitBranchName
  if ($currentBranch -eq 'main') {
    try {
      & .\scripts\github-loop\workflow-cleanup.ps1 -Apply
    } catch {
      Write-Host ("Workflow cleanup skipped: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    }
  } else {
    Write-Host "Skipping workflow cleanup in lane worktree on branch '$currentBranch'." -ForegroundColor DarkGray
  }
  Set-ReleaseBlockersUrgent
  & .\scripts\github-loop\workflow-health.ps1

  if ($Recipe -eq 'DeployFocused') {
    $continue = $true
    if ($continue) { $continue = Invoke-LoopStep -Name 'PR verification preflight' -Step 'pr_verify' -Prompt 'prompt-github-pr-verify.txt' -Count $PrVerifyPreflight }
    if ($continue) { $continue = Invoke-LoopStep -Name 'PR verification' -Step 'pr_verify' -Prompt 'prompt-github-pr-verify.txt' -Count $PrVerify }
    if ($continue) { $continue = Invoke-ReleaseDeployPhase }
    if ($continue) { $continue = Invoke-DeployFocusedBacklog }

    Write-Host ''
    Write-Host 'Workflow health after cycle:' -ForegroundColor Cyan
    & .\scripts\github-loop\workflow-health.ps1
    return $continue
  }

  if ($Recipe -eq 'FastTrackDiscussion') {
    if ($TargetDiscussionNumber -le 0) {
      throw 'FastTrackDiscussion recipe requires -TargetDiscussionNumber to be set.'
    }
    $continue = $true
    $discussionTarget = "FAST-TRACK TARGET: You must target discussion #$TargetDiscussionNumber for this step. Pass -DiscussionNumber $TargetDiscussionNumber to the discussion script. Do not select or work on any other discussion."
    if ($continue) { $continue = Invoke-LoopStep -Name 'Discussion triage (fast-track)' -Step 'discussion_triage' -Prompt 'prompt-github-discussion-triage.txt' -Count $DiscussionTriage -TargetInstruction $discussionTarget }
    if ($continue) { $continue = Invoke-LoopStep -Name 'Discussion promotion (fast-track)' -Step 'discussion_promote' -Prompt 'prompt-github-discussion-promote.txt' -Count $DiscussionPromote -TargetInstruction $discussionTarget }

    Write-Host ''
    Write-Host ("Fast-track: resolving issue created from discussion #$TargetDiscussionNumber...") -ForegroundColor Cyan
    $script:TargetIssueNumber = Resolve-PromotedIssueNumber -DiscussionNumber $TargetDiscussionNumber
    Write-Host ("Fast-track: discussion #$TargetDiscussionNumber promoted to issue #$($script:TargetIssueNumber). Continuing pipeline.") -ForegroundColor Cyan
  }

  if ($Recipe -in @('FastTrackIssue', 'FastTrackDiscussion')) {
    if ($script:TargetIssueNumber -le 0 -and $TargetIssueNumber -le 0) {
      if ($Recipe -eq 'FastTrackIssue') {
        throw 'FastTrackIssue recipe requires -TargetIssueNumber to be set.'
      } else {
        throw 'Fast-track pipeline stopped: could not resolve the issue number from the promoted discussion.'
      }
    }
    $effectiveIssueNumber = if ($script:TargetIssueNumber -gt 0) { $script:TargetIssueNumber } else { $TargetIssueNumber }
    $issueTarget = "FAST-TRACK TARGET: You must target issue #$effectiveIssueNumber for this step. Pass -IssueNumber $effectiveIssueNumber to the step script (issue-roast, work-issue, etc.). Do not select or work on any other issue."
    $prTarget = "FAST-TRACK TARGET: You must target the pull request linked to issue #$effectiveIssueNumber for this step. First run: gh pr list --repo $Repo --state open --json number,title,headRefName to find the PR that references issue #$effectiveIssueNumber. Then pass -PullRequestNumber <number> to the pr-verify script. Do not select or work on any other PR."
    $changelogTarget = "FAST-TRACK TARGET: You must target the changelog fragment for issue #$effectiveIssueNumber. Set the environment variable BIGBSKY_CHANGELOG_FRAGMENT_PATH to changelog/unreleased/issue-$effectiveIssueNumber.md before running the changelog-fragment script, or pass -FragmentPath changelog/unreleased/issue-$effectiveIssueNumber.md. Do not select or work on any other fragment."

    $continue = $true
    if ($continue) { $continue = Invoke-LoopStep -Name 'Issue roast (fast-track)' -Step 'issue_roast' -Prompt 'prompt-github-issue-roast.txt' -Count $IssueRoast -TargetInstruction $issueTarget }
    if ($continue) { $continue = Invoke-LoopStep -Name 'Issue implementation (fast-track)' -Step 'issue_work' -Prompt 'prompt-github-issue-work.txt' -Count $IssueWork -TargetInstruction $issueTarget }
    if ($continue) { $continue = Invoke-LoopStep -Name 'PR verification (fast-track)' -Step 'pr_verify' -Prompt 'prompt-github-pr-verify.txt' -Count $PrVerify -TargetInstruction $prTarget }
    if ($continue) { $continue = Invoke-LoopStep -Name 'Changelog roast (fast-track)' -Step 'changelog_roast' -Prompt 'prompt-roast-changelog.txt' -Count $ChangelogRoast -TargetInstruction $changelogTarget }
    if ($continue -and (Test-CanReleaseFromThisWorktree)) {
      $continue = Invoke-ReleaseFragmentAutoRoast
      if ($continue) { $continue = Invoke-LoopStep -Name 'Release creation' -Step 'release' -Prompt 'prompt-github-release.txt' -Count $Release }
      if ($continue) {
        if ($Deploy) {
          [void](Invoke-ThrottledDeployStep -Name 'Release deploy' -UseMainWorktreeStep $false -EvidencePath $Root)
        } else {
          Write-Host ''
          Write-Host 'Skipping deploy; pass -Deploy or use the deploy menu recipe when ready.' -ForegroundColor Yellow
        }
      }
    }

    Write-Host ''
    Write-Host 'Workflow health after cycle:' -ForegroundColor Cyan
    & .\scripts\github-loop\workflow-health.ps1
    return $continue
  }

  $continue = $true
  if ($continue) { $continue = Invoke-LoopStep -Name 'PR verification preflight' -Step 'pr_verify' -Prompt 'prompt-github-pr-verify.txt' -Count $PrVerifyPreflight }
  if ($continue) { $continue = Invoke-LoopStep -Name 'Discussion triage' -Step 'discussion_triage' -Prompt 'prompt-github-discussion-triage.txt' -Count $DiscussionTriage }
  if ($continue) { $continue = Invoke-LoopStep -Name 'Discussion promotion' -Step 'discussion_promote' -Prompt 'prompt-github-discussion-promote.txt' -Count $DiscussionPromote }
  if ($continue) { $continue = Invoke-LoopStep -Name 'Issue roast' -Step 'issue_roast' -Prompt 'prompt-github-issue-roast.txt' -Count $IssueRoast }
  if ($continue) { $continue = Invoke-LoopStep -Name 'Issue implementation' -Step 'issue_work' -Prompt 'prompt-github-issue-work.txt' -Count $IssueWork }
  if ($continue) { $continue = Invoke-LoopStep -Name 'PR verification' -Step 'pr_verify' -Prompt 'prompt-github-pr-verify.txt' -Count $PrVerify }
  if ($continue) { $continue = Invoke-LoopStep -Name 'Changelog roast' -Step 'changelog_roast' -Prompt 'prompt-roast-changelog.txt' -Count $ChangelogRoast }
  if ($continue -and (Test-CanReleaseFromThisWorktree)) {
    $continue = Invoke-ReleaseFragmentAutoRoast
    if ($continue) { $continue = Invoke-LoopStep -Name 'Release creation' -Step 'release' -Prompt 'prompt-github-release.txt' -Count $Release }
    if ($continue) {
      if ($Deploy) {
        [void](Invoke-LoopStep -Name 'Release deploy' -Step 'deploy' -Prompt 'prompt-github-release-deploy.txt' -Count 1)
      } else {
        Write-Host ''
        Write-Host 'Skipping deploy; pass -Deploy or use the deploy menu recipe when ready.' -ForegroundColor Yellow
      }
    }
  }

  Write-Host ''
  Write-Host 'Workflow health after cycle:' -ForegroundColor Cyan
  & .\scripts\github-loop\workflow-health.ps1
  return $continue
}

Set-Location $Root
$script:WorkflowBranch = Get-GitBranchName
if ([string]::IsNullOrWhiteSpace($script:WorkflowBranch)) {
  Write-Host 'Warning: orchestrator started from detached HEAD. Steps that detach the worktree cannot be auto-restored.' -ForegroundColor Yellow
} else {
  Write-Host ("Orchestrator worktree branch: {0}" -f $script:WorkflowBranch) -ForegroundColor DarkGray
}
Set-RecipeDefaults
$StopDeadline = Resolve-StopDeadline -Value $StopAt
if ($RepeatUntilStop -and $SleepBetweenCyclesSec -lt 5) { $SleepBetweenCyclesSec = 5 }

$cycle = 1
while ($true) {
  if (Test-OrchestratorStopDue) {
    Write-Host 'Stop requested before next orchestrator cycle.' -ForegroundColor Yellow
    break
  }

  $cycleFailed = $false
  try {
    $cycleContinued = Invoke-OrchestratorCycle -Cycle $cycle
  } catch {
    Write-Host ("Orchestrator cycle {0} threw an unhandled exception: {1}" -f $cycle, $_.Exception.Message) -ForegroundColor Red
    Write-Host $_.ScriptStackTrace -ForegroundColor Red
    $cycleContinued = $false
    $cycleFailed = $true
  }

  # Stop signals (flag or Eastern-time deadline) always win. Outside continuous
  # mode, a single recipe run exits as before. Inside continuous mode (ON/CD/SS),
  # a failed or no-work cycle must not kill the lane -- back off and try again
  # so the lane keeps working until the user-visible stop signal fires.
  if (Test-OrchestratorStopDue) {
    Write-Host 'Stop requested after orchestrator cycle.' -ForegroundColor Yellow
    break
  }
  if (!$RepeatUntilStop) {
    if (!$cycleContinued) { break }
    break
  }

  $sleep = $SleepBetweenCyclesSec
  if ($cycleFailed) {
    $sleep = [Math]::Max($SleepBetweenCyclesSec, 60)
    Write-Host ''
    Write-Host ("Cycle {0} ended with an unhandled error; backing off {1}s before next cycle. Continuous lane keeps running until the stop flag or deadline." -f $cycle, $sleep) -ForegroundColor Yellow
  } elseif (!$cycleContinued) {
    Write-Host ''
    Write-Host ("Cycle {0} reported no continuing work or a non-fatal stop. Sleeping {1}s before next cycle." -f $cycle, $sleep) -ForegroundColor DarkGray
  } else {
    Write-Host ''
    Write-Host ("Sleeping {0} second(s) before next cycle. Stop with the lane stop menu option or .loop-tmp\orchestrator-stop.flag." -f $sleep) -ForegroundColor DarkGray
  }
  Start-Sleep -Seconds $sleep
  $cycle++
}

Write-Host ''
Write-Host 'Final workflow health:' -ForegroundColor Cyan
& .\scripts\github-loop\workflow-health.ps1
