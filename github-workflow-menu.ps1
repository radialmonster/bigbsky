param()

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }
. (Join-Path $Root 'scripts\github-loop\git-sync.ps1')

function Test-CancelInput {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
  # '0' used to be in the cancel set, but several prompts legitimately accept
  # 0 as a numeric input (SS deploy lane mode, CDT thresholds, lane counts,
  # custom step counts in option O). Use q/quit/back/cancel to abort instead.
  return @('q', 'quit', 'back', 'cancel') -contains $Value.Trim().ToLowerInvariant()
}

function Invoke-MenuCommand {
  param(
    [string]$Description,
    [scriptblock]$Command
  )
  Write-Host ''
  Write-Host "== $Description ==" -ForegroundColor Cyan
  & $Command
  Write-Host ''
  Write-Host 'Done. Press Enter to return to menu.'
  [void](Read-Host)
}

function Sync-MenuMainWorktree {
  param([string]$Context)
  Sync-WorkflowMainWorktree -Path $Root -Context $Context
}

function Invoke-LocalWorkflowScript {
  param(
    [string]$Context,
    [scriptblock]$Command
  )
  Sync-MenuMainWorktree -Context $Context
  & $Command
}

function Invoke-LoopWithBranchRestore {
  param(
    [string]$Preset,
    [string]$Prompt,
    [int]$MaxIterations
  )

  Sync-MenuMainWorktree -Context "Loop '$Prompt'"
  $startingBranchRaw = git branch --show-current
  $startingBranch = if ($null -eq $startingBranchRaw) { '' } else { ([string]$startingBranchRaw).Trim() }
  & .\loop.ps1 $Preset $Prompt -MaxIterations $MaxIterations

  if ([string]::IsNullOrWhiteSpace($startingBranch)) { return }
  $currentBranchRaw = git branch --show-current
  $currentBranch = if ($null -eq $currentBranchRaw) { '' } else { ([string]$currentBranchRaw).Trim() }
  if ($currentBranch -eq $startingBranch) { return }

  $status = @(git status --short)
  if ($status.Count -gt 0) {
    throw "Loop '$Prompt' left the worktree on '$currentBranch' with dirty paths; refusing to switch back to '$startingBranch'. Dirty paths:`n$($status -join "`n")"
  }

  Write-Host ("Restoring menu worktree to branch '{0}' after {1}; current branch was '{2}'." -f $startingBranch, $Prompt, $(if ($currentBranch) { $currentBranch } else { 'detached HEAD' })) -ForegroundColor Yellow
  git switch $startingBranch | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to restore menu branch '$startingBranch' after $Prompt." }
}

function Get-MenuActionDescription {
  param([string]$Choice)
  $descriptions = @{
    '2' = @('Shows Issues and Discussions labeled ai:needs-user-answer. This is read-only.')
    'H' = @('Shows workflow health buckets: waiting, blocked, needs roast, ready for implementation, PR verify, release, claimed, and stale states. This is read-only.')
    'Q' = @('Runs a workflow hygiene report for worktrees, branches, lanes, stale state, and cleanup candidates. This is read-only.')
    'PL' = @('Fetches from origin and fast-forward-merges main to match origin/main.', 'Requires a clean worktree on main. Equivalent to git pull --ff-only origin main.')
    'LG' = @('Prints the last 80 lines of loop.log. This is read-only.')
    'A' = @('Runs ONE bounded pass through the workflow pipeline (SafeCycle recipe), then exits. Not for overnight use.', 'Covers discussion triage/promote, issue roast, issue work, PR verify, changelog roast, and GitHub Release creation -- each step runs a fixed number of times and the script exits when done. Skips the deploy step. Use ON or SS for continuous overnight operation.')
    'G' = @('Runs ONE bounded pass through the full pipeline including deploy, then exits. Not for overnight use.', 'Same as A but deploys to production if a safe release tag is reached. Use CD or SS for continuous overnight operation with deploy.')
    'B' = @('Runs ONE bounded blocker-recovery pass, then exits.', 'Prioritizes open release-blocking Issues and the verification needed to clear them. Exits when done.')
    'O' = @('Runs ONE custom orchestrator pass with counts you set, then exits.', 'You choose how many iterations to run for each step: discussion triage, promotion, issue roast, issue work, PR verify, changelog roast, and release. Exits when done.')
    'FT' = @('Fast-tracks one issue or discussion through the entire pipeline.', 'Enter a GitHub issue/discussion URL or bare number.', 'For discussions: triage, promote to issue, then roast, implement, verify, changelog, release, and optionally deploy.', 'For issues: roast, implement, verify, changelog, release, and optionally deploy.')
    'M' = @('Prints the model profile configuration JSON. This is read-only.')
    'F' = @('Creates or edits a model profile.', 'You choose which model preset each workflow step uses, then the profile is saved to config/github-workflow-profiles.json.')
    'K' = @('Starts one or more discussion lanes in separate Git worktrees. NOT CONTINUOUS -- each lane runs ONE DiscussionsToIssues cycle (5 triage, 5 promote, 5 roast by default) and exits.', 'For continuous discussion work in parallel use ON or SS (which include discussion triage/promote in their pipelines).')
    'N' = @('Starts one or more issue lanes in separate Git worktrees. NOT CONTINUOUS -- each lane runs ONE cycle (5 roast, 5 implement, 5 verify by default) and then exits. Use ON or ONN for continuous lanes.', 'IssuesToPr recipe: roast, implement, verify PRs only. No preflight, no changelog roast, no release, no discussion handling, no deploy. Good for short batch runs; relaunch when finished or use ONN for the continuous parallel equivalent.')
    'ON' = @('Starts a CONTINUOUS issue ship lane that runs until stopped. Same priority as CD (drain in-flight PRs/releases first, then work backlog) but does not deploy. Best for daytime/overnight throughput when you do not want to wait 30+ minutes per deploy.', 'Verifies and ships ready PRs, creates GitHub Releases, then falls back to issue work, roast, discussion promote, and discussion triage when idle. Tagged releases can be deployed later with L or a CD lane. Set an Eastern-time stop deadline (e.g. 06:30) to stop automatically. Does not deploy.')
    'ONN' = @('Starts multiple CONTINUOUS issue ship lanes in parallel. Each lane runs the same DeployFocused recipe as ON/CD but does not deploy.', 'Like running ON N times. Asks for a base lane name and count. Release/deploy is process-locked so only one lane at a time will tag a GitHub Release; other lanes keep working backlog. Use SS instead if you also want blocker/discussion specialty lanes or a deploy lane.')
    'CD' = @('Starts a CONTINUOUS deploy lane that runs until stopped. Deploys on EVERY cycle (~30 min per deploy).', 'Verifies and ships ready PRs, creates releases, and deploys each cycle. When idle, works Issues in priority order. Set a stop deadline to stop automatically. Requires typing DEPLOY to confirm. Use CDT instead if you want to batch deploys (deploy only after N releases or N hours have accumulated).')
    'CDT' = @('Starts a CONTINUOUS throttled-deploy lane. Same recipe as CD, but the deploy step is gated on either (a) N releases since last deploy or (b) N hours since last deploy (OR semantics).', 'Use when you want continuous PR verify and release tagging, but only periodic deploys to amortize the 30-min deploy cost across multiple releases. Defaults: 3 releases OR 4 hours. State at PrimaryRoot/.loop-tmp/last-deploy.json. Requires typing DEPLOY to confirm. Set either threshold to 0 to disable that one.')
    'SS' = @('Starts MULTIPLE CONTINUOUS lanes in parallel for maximum overnight throughput. Asks for a deploy lane mode plus counts of issue/blocker/discussion lanes.', 'Deploy lane mode 2 = full deploy. Deploys whenever a closed ai:ready-for-release issue is waiting. ~30+ min per deploy. With active issue lanes, expect a deploy every 15-60 min. Pick when you want every merged change live in prod fast.', 'Deploy lane mode 1 = release tags created but NOT deployed. Pick when you want continuous PR/release work but will deploy manually with G or L (or alongside CDT) on your own schedule.', 'Deploy lane mode 0 = no dedicated deploy lane. Issue lanes still verify, merge, and tag releases on their own. Pick when you just want issue throughput and will handle deploys separately later.', 'All modes ALWAYS produce GitHub Release tags as PRs merge. The mode only controls whether code reaches production.', 'Issue lanes (default 3) implement and verify in parallel. Blocker lane focuses on ai:blocks-release work. Discussion lane triages/promotes discussions to issues.', 'Best choice for leaving the system running all night. Set a stop deadline (e.g. 06:30) to stop everything automatically.')
    'E' = @('Starts one or more blocker lanes in separate Git worktrees. NOT CONTINUOUS -- each lane runs ONE BlockerRecovery cycle (3 roast, 2 implement, 2 verify, 2 changelog, 1 release by default) and exits.', 'For continuous blocker work alongside other parallel lanes, use SS which includes a configurable count of blocker lanes.')
    'J' = @('Lists running parallel lanes first and summarizes stopped lane history. This is read-only.')
    'JU' = @('Clears stopped lane history records from the menu.', 'It does not stop running lanes or delete lane worktrees/logs; run CL (Full tidy) to remove stopped clean worktrees.')
    'Z' = @('Writes stop flags for one lane.', 'The lane is asked to stop after its current session, instead of being killed mid-work.')
    'X' = @('Writes stop flags for all known lanes.', 'Each running lane is asked to stop after its current session, instead of being killed mid-work.')
    'KL' = @('Force-kills a lane process immediately using taskkill /T.', 'Use when a lane is stuck and Z (graceful stop) is not progressing. Reads the PID from the lane state file.')
    'L' = @('Creates a GitHub Release from closed ready-for-release Issues, then optionally deploys it.', 'Type DEPLOY at the prompt to also deploy to production; press Enter to create the release only.')
    'R' = @('Prepares one issue-roast bundle only.', 'It selects and claims one eligible Issue and writes the prompt bundle, but does not run the model.')
    'W' = @('Prepares one issue-work bundle only.', 'It selects one eligible fully-roasted Issue and writes the implementation prompt bundle, but does not run the model.')
    'V' = @('Prepares one PR verification bundle only.', 'It selects one eligible PR and writes the verification prompt bundle, but does not run the model.')
    'P' = @('Prepares one discussion promotion only.', 'It previews which ready Discussion would become an Issue, without applying unless the script itself is run in apply mode.')
    'C' = @('Prepares one changelog-fragment roast.', 'It selects a changelog/unreleased fragment needing roast and writes the review bundle.')
    'K9' = @('Runs one random code roast.', 'It picks a random file, route, URL, function, class, or script, deeply reviews it, and creates or updates GitHub Issues labeled ai:needs-roast for concrete findings.')
    'UC' = @('Lists open issues with ai:claimed and removes the label from one or all of them.', 'Use when a loop died mid-session and left an issue stuck with ai:claimed.')
    'CL' = @('Full tidy: fixes labels, syncs PR/issue state, retries infra-blocked, unblocks resolved deps and follow-ups, closes duplicate discussions, and removes stale lane worktrees.', 'Runs all non-interactive cleanup tasks in order. Worktree cleanup is skipped gracefully if the worktree is not on a clean main.')
    'S' = @('Requests the current loop in this worktree to stop after its current session.', 'It writes a local stop flag and does not kill running work.')
  }
  if ($descriptions.ContainsKey($Choice)) { return @($descriptions[$Choice]) }
  return @()
}

function Confirm-MenuAction {
  param([string]$Choice)
  $description = @(Get-MenuActionDescription -Choice $Choice)
  if ($description.Count -eq 0) { return }
  Write-Host ''
  Write-Host "Selected $Choice" -ForegroundColor Cyan
  foreach ($line in $description) {
    Write-Host "  $line"
  }
  Write-Host ''
  $raw = Read-Host 'Press Enter to continue, or q/back/cancel to return to menu'
  if (Test-CancelInput -Value $raw) { throw '__MENU_CANCEL__' }
}

function Read-IterationCount {
  param([int]$Default = 1)
  $raw = Read-Host "Max iterations [$Default]"
  if (Test-CancelInput -Value $raw) { throw '__MENU_CANCEL__' }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
  $value = 0
  if ([int]::TryParse($raw, [ref]$value) -and $value -gt 0) { return $value }
  Write-Host "Invalid count; using $Default." -ForegroundColor Yellow
  return $Default
}

function Read-PositiveInt {
  param([string]$Prompt, [int]$Default)
  $raw = Read-Host "$Prompt [$Default]"
  if (Test-CancelInput -Value $raw) { throw '__MENU_CANCEL__' }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
  $value = 0
  if ([int]::TryParse($raw, [ref]$value) -and $value -gt 0) { return $value }
  Write-Host "Invalid number; using $Default." -ForegroundColor Yellow
  return $Default
}

function Read-NonNegativeInt {
  param([string]$Prompt, [int]$Default)
  $raw = Read-Host "$Prompt [$Default]"
  if (Test-CancelInput -Value $raw) { throw '__MENU_CANCEL__' }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
  $value = 0
  if ([int]::TryParse($raw, [ref]$value) -and $value -ge 0) { return $value }
  Write-Host "Invalid number; using $Default." -ForegroundColor Yellow
  return $Default
}

function Read-TextDefault {
  param([string]$Prompt, [string]$Default)
  $raw = Read-Host "$Prompt [$Default]"
  if (Test-CancelInput -Value $raw) { throw '__MENU_CANCEL__' }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
  return $raw
}

function Show-ModelProfiles {
  $path = Join-Path $Root 'config\github-workflow-profiles.json'
  if (!(Test-Path $path)) {
    Write-Host 'No model profile file found.' -ForegroundColor Yellow
    return
  }
  Get-Content -Raw $path | Write-Host
}

function Get-WorkflowProfiles {
  $path = Join-Path $Root 'config\github-workflow-profiles.json'
  if (!(Test-Path $path)) { return $null }
  $parsed = Get-Content -Raw $path | ConvertFrom-Json
  return $parsed
}

function Format-WorkflowProfileSummary {
  param([object]$Profile)
  if ($null -eq $Profile) { return '' }
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($step in Get-WorkflowProfileSteps) {
    if ($Profile.PSObject.Properties.Name -contains $step) {
      $parts.Add(('{0}={1}' -f $step, [string]$Profile.$step))
    }
  }
  return ($parts -join ', ')
}

function Read-WorkflowProfile {
  param([string]$Default = 'default')

  $profileConfig = Get-WorkflowProfiles
  if ($null -eq $profileConfig) {
    Write-Host 'No model profile file found; using default.' -ForegroundColor Yellow
    return $Default
  }
  $profiles = @($profileConfig.PSObject.Properties.Name)
  if ($profiles.Count -eq 0) {
    Write-Host 'No model profiles configured; using default.' -ForegroundColor Yellow
    return $Default
  }

  Write-Host ''
  Write-Host 'Model profiles and step presets:' -ForegroundColor Cyan
  for ($i = 0; $i -lt $profiles.Count; $i++) {
    $name = $profiles[$i]
    $marker = ''
    if ($name -eq $Default) { $marker = ' (default)' }
    Write-Host ("  {0}. {1}{2}" -f ($i + 1), $name, $marker)
    Write-Host ("     {0}" -f (Format-WorkflowProfileSummary -Profile $profileConfig.$name)) -ForegroundColor DarkGray
  }

  while ($true) {
    $raw = Read-Host "Choose profile number or name [$Default]"
    if (Test-CancelInput -Value $raw) { throw '__MENU_CANCEL__' }
    if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
    $value = $raw.Trim()
    $number = 0
    if ([int]::TryParse($value, [ref]$number) -and $number -ge 1 -and $number -le $profiles.Count) {
      return $profiles[$number - 1]
    }
    if ($profiles -contains $value) { return $value }
    Write-Host "Unknown profile '$value'. Choose a listed number or profile name." -ForegroundColor Yellow
  }
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Get-ModelPresets {
  return @(
    [pscustomobject]@{ Key = 'codex-yolo';                   Label = 'Codex CLI / OpenAI gpt-5.5 medium' },
    [pscustomobject]@{ Key = 'codex-spark';                  Label = 'Codex CLI / OpenAI gpt-5.3-codex spark' },
    [pscustomobject]@{ Key = 'anthropic-opus';               Label = 'Claude Code / Anthropic claude-opus-4-7 1M' },
    [pscustomobject]@{ Key = 'anthropic-sonnet';             Label = 'Claude Code / Anthropic claude-sonnet-4-6' },
    [pscustomobject]@{ Key = 'deepseek-api';                 Label = 'Claude Code / DeepSeek API deepseek-v4-pro 1M' },
    [pscustomobject]@{ Key = 'ollama-deepseek-v4-pro-cloud'; Label = 'Ollama Cloud / DeepSeek deepseek-v4-pro:cloud' },
    [pscustomobject]@{ Key = 'ollama-deepseek-v4-flash-cloud'; Label = 'Ollama Cloud / DeepSeek deepseek-v4-flash:cloud' },
    [pscustomobject]@{ Key = 'ollama-gemma4-31b-cloud';      Label = 'Ollama Cloud / Google gemma4:31b-cloud' },
    [pscustomobject]@{ Key = 'ollama-glm';                   Label = 'Ollama Cloud / Zhipu GLM glm-5.1:cloud' },
    [pscustomobject]@{ Key = 'ollama-kimi';                  Label = 'Ollama Cloud / Moonshot Kimi kimi-k2.6:cloud' }
  )
}

function Get-ModelPresetKeys {
  return @(Get-ModelPresets | ForEach-Object { $_.Key })
}

function Get-ModelPresetLabel {
  param([string]$Key)
  $preset = Get-ModelPresets | Where-Object { $_.Key -eq $Key } | Select-Object -First 1
  if ($preset) { return "$($preset.Key) - $($preset.Label)" }
  return $Key
}

function Show-ModelPresetChoices {
  Write-Host 'Known presets:' -ForegroundColor Cyan
  $presets = @(Get-ModelPresets)
  for ($i = 0; $i -lt $presets.Count; $i++) {
    Write-Host ("  {0,2}. {1,-18} {2}" -f ($i + 1), $presets[$i].Key, $presets[$i].Label)
  }
}

function Get-WorkflowProfileSteps {
  return @(
    'discussion_triage',
    'discussion_promote',
    'issue_roast',
    'issue_work',
    'pr_verify',
    'changelog_roast',
    'release',
    'deploy'
  )
}

function Read-PresetKey {
  param([string]$Step, [string]$Default)
  $presets = @(Get-ModelPresets)
  $keys = @($presets | ForEach-Object { $_.Key })
  while ($true) {
    Write-Host ''
    Write-Host "$Step preset choices:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $presets.Count; $i++) {
      $marker = if ($presets[$i].Key -eq $Default) { ' (current)' } else { '' }
      Write-Host ("  {0,2}. {1,-18} {2}{3}" -f ($i + 1), $presets[$i].Key, $presets[$i].Label, $marker)
    }
    $raw = Read-Host "$Step preset number or key [$Default]"
    if (Test-CancelInput -Value $raw) { throw '__MENU_CANCEL__' }
    if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
    $value = $raw.Trim()
    $number = 0
    if ([int]::TryParse($value, [ref]$number) -and $number -ge 1 -and $number -le $presets.Count) {
      return $presets[$number - 1].Key
    }
    if ($keys -contains $value) { return $value }
    Write-Host "Unknown preset '$value'. Choose a listed number or preset key." -ForegroundColor Yellow
  }
}

function Confirm-ProductionDeploy {
  Write-Host ''
  Write-Host 'This can deploy to production when the workflow reaches a safe release.' -ForegroundColor Yellow
  $raw = Read-Host 'Type DEPLOY to continue'
  return $raw -eq 'DEPLOY'
}

function Get-LaneNamesForStart {
  param([string]$BaseName, [int]$Count)
  $name = $BaseName.Trim().ToLowerInvariant()
  if ($Count -eq 1 -and $name -match '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,48}$') {
    return @($name)
  }

  $prefix = $name -replace '[-_.]?\d+$', ''
  if ([string]::IsNullOrWhiteSpace($prefix)) { $prefix = $name }
  $names = New-Object System.Collections.Generic.List[string]
  for ($i = 1; $i -le $Count; $i++) {
    $laneName = ('{0}-{1}' -f $prefix, $i)
    if ($laneName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,48}$') {
      throw "Invalid generated lane name '$laneName'. Use letters, numbers, dot, underscore, or dash."
    }
    $names.Add($laneName)
  }
  return $names.ToArray()
}

function Get-RecipeDefaultCounts {
  param([string]$Recipe)
  $counts = [ordered]@{
    DiscussionTriage = 0
    DiscussionPromote = 0
    IssueRoast = 0
    IssueWork = 0
    PrVerifyPreflight = 0
    PrVerify = 0
    ChangelogRoast = 0
    Release = 0
  }
  switch ($Recipe) {
    'DiscussionsToIssues' {
      $counts.DiscussionTriage = 5
      $counts.DiscussionPromote = 5
      $counts.IssueRoast = 5
    }
    'BlockerRecovery' {
      $counts.IssueRoast = 3
      $counts.IssueWork = 2
      $counts.PrVerifyPreflight = 1
      $counts.PrVerify = 2
      $counts.ChangelogRoast = 2
      $counts.Release = 1
    }
    'IssuesToPr' {
      $counts.IssueRoast = 5
      $counts.IssueWork = 5
      $counts.PrVerify = 5
    }
  }
  return $counts
}

function Show-RecipeCounts {
  param($Counts)
  foreach ($key in $Counts.Keys) {
    if ([int]$Counts[$key] -gt 0) {
      Write-Host ("  {0}: {1}" -f $key, $Counts[$key])
    }
  }
}

function Read-CountOrAll {
  param([string]$Prompt, [int]$Default)
  while ($true) {
    $raw = Read-Host "$Prompt [$Default, all]"
    if (Test-CancelInput -Value $raw) { throw '__MENU_CANCEL__' }
    if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
    $value = $raw.Trim().ToLowerInvariant()
    if (@('all', '*', 'until-none', 'until-done') -contains $value) { return -1 }
    $number = 0
    if ([int]::TryParse($value, [ref]$number) -and $number -ge 0) { return $number }
    Write-Host 'Enter a number, all, or q/back/cancel.' -ForegroundColor Yellow
  }
}

function Get-RecipePromptKeys {
  param([string]$Recipe)
  switch ($Recipe) {
    'DiscussionsToIssues' { return @('DiscussionTriage', 'DiscussionPromote', 'IssueRoast') }
    'IssuesToPr' { return @('IssueRoast', 'IssueWork', 'PrVerify') }
    'BlockerRecovery' { return @('IssueRoast', 'IssueWork', 'PrVerifyPreflight', 'PrVerify', 'ChangelogRoast', 'Release') }
    default { return @('DiscussionTriage', 'DiscussionPromote', 'IssueRoast', 'IssueWork', 'PrVerify', 'ChangelogRoast', 'Release') }
  }
}

function Format-CountValue {
  param([int]$Value)
  if ($Value -lt 0) { return 'all' }
  return [string]$Value
}

function Show-SelectedRecipeCounts {
  param($Counts)
  foreach ($key in $Counts.Keys) {
    if ([int]$Counts[$key] -ne 0) {
      Write-Host ("  {0}: {1}" -f $key, (Format-CountValue -Value ([int]$Counts[$key])))
    }
  }
}

function Read-LaneRecipeCounts {
  param([string]$Recipe)
  $defaults = Get-RecipeDefaultCounts -Recipe $Recipe
  Write-Host ''
  Write-Host "Default $Recipe lane counts:" -ForegroundColor Cyan
  Show-RecipeCounts -Counts $defaults

  $custom = [ordered]@{}
  foreach ($key in $defaults.Keys) { $custom[$key] = 0 }
  foreach ($key in @(Get-RecipePromptKeys -Recipe $Recipe)) {
    $custom[$key] = Read-CountOrAll -Prompt $key -Default ([int]$defaults[$key])
  }
  Write-Host ''
  Write-Host 'Selected lane counts:' -ForegroundColor Cyan
  Show-SelectedRecipeCounts -Counts $custom
  return [pscustomobject]@{
    Counts = $custom
    NoDefaults = $true
  }
}

function Start-LaneGroup {
  param(
    [string]$Label,
    [string]$DefaultBaseName,
    [string]$Recipe
  )

  $baseName = Read-TextDefault -Prompt 'Lane base name' -Default $DefaultBaseName
  $count = Read-PositiveInt -Prompt 'Number of lanes to start' -Default 1
  $profile = Read-WorkflowProfile -Default 'default'
  $recipeCounts = Read-LaneRecipeCounts -Recipe $Recipe
  $laneNames = @(Get-LaneNamesForStart -BaseName $baseName -Count $count)

  Invoke-MenuCommand "Start $Label lane(s): $($laneNames -join ', ')" {
    foreach ($lane in $laneNames) {
      $laneParams = @{
        Mode = 'Start'
        Lane = $lane
        Recipe = $Recipe
        Profile = $profile
      }
      if ($recipeCounts.NoDefaults) { $laneParams.NoDefaults = $true }
      foreach ($key in $recipeCounts.Counts.Keys) {
        $value = [int]$recipeCounts.Counts[$key]
        if ($value -ne 0) {
          $laneParams[$key] = $value
        }
      }
      & .\scripts\github-loop\lanes.ps1 @laneParams
    }
  }
}

function Read-OptionalStopAtEastern {
  $raw = Read-Host 'Stop at Eastern time, for example 06:30 or 2026-05-08 06:30; blank means run until stopped'
  if (Test-CancelInput -Value $raw) { throw '__MENU_CANCEL__' }
  return $raw.Trim()
}

function Start-ContinuousIssueShipLaneGroup {
  # Multiple continuous ON-style lanes in parallel. Each lane runs DeployFocused
  # without deploy (release only). Like SS but without the deploy lane and
  # without the opinionated blocker/discussion lanes -- just N parallel issue
  # ship lanes.
  $baseName = Read-TextDefault -Prompt 'Lane base name' -Default 'issue-ship'
  $count = Read-PositiveInt -Prompt 'Number of continuous lanes to start' -Default 2
  $profile = Read-WorkflowProfile -Default 'default'
  $stopAt = Read-OptionalStopAtEastern
  $sleepSeconds = Read-PositiveInt -Prompt 'Seconds to wait between cycles' -Default 60
  $laneNames = @(Get-LaneNamesForStart -BaseName $baseName -Count $count)

  Invoke-MenuCommand "Start $count continuous issue ship lane(s): $($laneNames -join ', ')" {
    foreach ($lane in $laneNames) {
      $laneParams = @{
        Mode = 'Start'
        Lane = $lane
        Recipe = 'DeployFocused'
        Profile = $profile
        NoDefaults = $true
        RepeatUntilStop = $true
        SleepBetweenCyclesSec = $sleepSeconds
        PrVerifyPreflight = 1
        PrVerify = 1
        ChangelogRoast = 1
        Release = 1
        IssueRoast = 1
        IssueWork = 1
        DiscussionPromote = 1
        DiscussionTriage = 1
      }
      if (![string]::IsNullOrWhiteSpace($stopAt)) {
        $laneParams.StopAt = $stopAt
      }
      & .\scripts\github-loop\lanes.ps1 @laneParams
    }
    Write-Host ''
    Write-Host "Started $count continuous lane(s). Each runs the same DeployFocused recipe as CD (verify -> release -> backlog fallback through issue work, roast, discussion promote, discussion triage) but does not deploy. Stop with X for all lanes or Z per lane. Release/deploy is process-locked, so only one lane at a time will create GitHub Releases."
    if (![string]::IsNullOrWhiteSpace($stopAt)) {
      Write-Host "Stop time is interpreted as Eastern time: $stopAt"
    }
  }
}

function Start-ContinuousIssueShipLane {
  $lane = Read-TextDefault -Prompt 'Lane name' -Default 'issue-ship'
  $profile = Read-WorkflowProfile -Default 'default'
  $stopAt = Read-OptionalStopAtEastern
  $sleepSeconds = Read-PositiveInt -Prompt 'Seconds to wait between cycles' -Default 60

  Invoke-MenuCommand "Start continuous issue ship lane: $lane" {
    # Same parameters as the CD (continuous deploy) lane, except Deploy is not
    # set. This means ON drains in-flight PR verify/release/discussion work the
    # same way CD does, but stops after GitHub Release creation -- it does not
    # push the release to production. Lets ON and CD share the same step
    # priority (DeployFocused recipe: verify -> release -> backlog) without
    # paying for the 30+ minute deploy step on every cycle.
    $laneParams = @{
      Mode = 'Start'
      Lane = $lane
      Recipe = 'DeployFocused'
      Profile = $profile
      NoDefaults = $true
      RepeatUntilStop = $true
      SleepBetweenCyclesSec = $sleepSeconds
      PrVerifyPreflight = 1
      PrVerify = 1
      ChangelogRoast = 1
      Release = 1
      IssueRoast = 1
      IssueWork = 1
      DiscussionPromote = 1
      DiscussionTriage = 1
    }
    if (![string]::IsNullOrWhiteSpace($stopAt)) {
      $laneParams.StopAt = $stopAt
    }
    & .\scripts\github-loop\lanes.ps1 @laneParams
    Write-Host ''
    Write-Host 'This lane runs the same DeployFocused recipe as CD (verify -> release -> backlog fallback through issue work, roast, discussion promote, discussion triage), but does not deploy. GitHub Releases are still tagged; deploy them later with the L menu option or a CD lane. Stop it with X for all lanes or Z for this lane.'
    if (![string]::IsNullOrWhiteSpace($stopAt)) {
      Write-Host "Stop time is interpreted as Eastern time: $stopAt"
    }
  }
}

function Start-ContinuousThrottledDeployLane {
  # CD with deploy throttling. Same recipe and parameters as CD, but the deploy
  # step at the end of each cycle is gated on (releases-since-last-deploy) and
  # (hours-since-last-deploy). The lane still does PR verify, release creation,
  # and backlog fallback on every cycle -- only the actual deploy step skips
  # when neither threshold is met. State persists at
  # PrimaryRoot/.loop-tmp/last-deploy.json so the throttle survives lane
  # restarts.
  $lane = Read-TextDefault -Prompt 'Lane name' -Default 'deploy-throttled'
  $profile = Read-WorkflowProfile -Default 'default'
  Write-Host ''
  Write-Host 'Deploy throttle thresholds. The deploy step is allowed when EITHER threshold is satisfied (OR semantics).' -ForegroundColor DarkGray
  Write-Host '  Use 0 to disable one of the thresholds (set both to 0 to deploy every cycle, equivalent to CD).' -ForegroundColor DarkGray
  $afterReleases = Read-NonNegativeInt -Prompt 'Deploy after N releases since last deploy (0=disable)' -Default 3
  $afterHours = Read-NonNegativeInt -Prompt 'Deploy after N hours since last deploy (0=disable)' -Default 4
  $stopAt = Read-OptionalStopAtEastern
  $sleepSeconds = Read-PositiveInt -Prompt 'Seconds to wait between cycles' -Default 60

  Invoke-MenuCommand "Start continuous throttled deploy lane: $lane" {
    if (!(Confirm-ProductionDeploy)) {
      Write-Host 'Throttled deploy lane cancelled.'
      return
    }
    $laneParams = @{
      Mode = 'Start'
      Lane = $lane
      Recipe = 'DeployFocused'
      Profile = $profile
      NoDefaults = $true
      RepeatUntilStop = $true
      SleepBetweenCyclesSec = $sleepSeconds
      Deploy = $true
      PrVerifyPreflight = 1
      PrVerify = 1
      ChangelogRoast = 1
      Release = 1
      IssueRoast = 1
      IssueWork = 1
      DiscussionPromote = 1
      DiscussionTriage = 1
    }
    if ($afterReleases -gt 0) { $laneParams.DeployAfterReleases = $afterReleases }
    if ($afterHours -gt 0) { $laneParams.DeployAfterHours = $afterHours }
    if (![string]::IsNullOrWhiteSpace($stopAt)) { $laneParams.StopAt = $stopAt }
    & .\scripts\github-loop\lanes.ps1 @laneParams
    Write-Host ''
    $thresholdText = @()
    if ($afterReleases -gt 0) { $thresholdText += "after $afterReleases release(s)" }
    if ($afterHours -gt 0) { $thresholdText += "after $afterHours hour(s)" }
    if ($thresholdText.Count -eq 0) { $thresholdText += 'EVERY CYCLE (no throttle set)' }
    Write-Host ("This lane verifies and releases on every cycle but only deploys $($thresholdText -join ' or '). When neither threshold is met, the deploy step is skipped and the lane keeps working backlog. State at PrimaryRoot/.loop-tmp/last-deploy.json. Stop it with X for all lanes or Z for this lane.")
    if (![string]::IsNullOrWhiteSpace($stopAt)) {
      Write-Host "Stop time is interpreted as Eastern time: $stopAt"
    }
  }
}

function Start-ContinuousDeployLane {
  $lane = Read-TextDefault -Prompt 'Lane name' -Default 'deploy-ship'
  $profile = Read-WorkflowProfile -Default 'default'
  $stopAt = Read-OptionalStopAtEastern
  $sleepSeconds = Read-PositiveInt -Prompt 'Seconds to wait between cycles' -Default 60

  Invoke-MenuCommand "Start continuous deploy-focused lane: $lane" {
    if (!(Confirm-ProductionDeploy)) {
      Write-Host 'Deploy-focused lane cancelled.'
      return
    }
    $laneParams = @{
      Mode = 'Start'
      Lane = $lane
      Recipe = 'DeployFocused'
      Profile = $profile
      NoDefaults = $true
      RepeatUntilStop = $true
      SleepBetweenCyclesSec = $sleepSeconds
      Deploy = $true
      PrVerifyPreflight = 1
      PrVerify = 1
      ChangelogRoast = 1
      Release = 1
      IssueRoast = 1
      IssueWork = 1
      DiscussionPromote = 1
      DiscussionTriage = 1
    }
    if (![string]::IsNullOrWhiteSpace($stopAt)) {
      $laneParams.StopAt = $stopAt
    }
    & .\scripts\github-loop\lanes.ps1 @laneParams
    Write-Host ''
    Write-Host 'This lane deploys only releases made from verified merged work. When no PR/release work is ready, it falls back to ready Issues, issue roast, discussion promotion, then discussion triage. Stop it with X for all lanes or Z for this lane.'
    if (![string]::IsNullOrWhiteSpace($stopAt)) {
      Write-Host "Stop time is interpreted as Eastern time: $stopAt"
    }
  }
}

function Start-SuperSpeedMode {
  $profile = Read-WorkflowProfile -Default 'fast-roast'
  Write-Host ''
  Write-Host 'Deploy lane mode -- what does the dedicated deploy lane do?' -ForegroundColor Cyan
  Write-Host '  2 = FULL DEPLOY. The dedicated deploy lane verifies PRs, tags releases, and deploys to production.' -ForegroundColor Gray
  Write-Host '      The deploy step runs whenever there is at least one closed ai:ready-for-release issue waiting.' -ForegroundColor DarkGray
  Write-Host '      ~30+ min per deploy. With active issue lanes, expect a deploy every 15-60 min.' -ForegroundColor DarkGray
  Write-Host '      Asks DEPLOY confirmation. Pick when you want every merged change live fast.' -ForegroundColor DarkGray
  Write-Host '  1 = RELEASE-ONLY. The dedicated deploy lane verifies and tags GitHub releases, but does NOT deploy.' -ForegroundColor Gray
  Write-Host '      Pick when you want continuous shipping but will deploy manually with G or L on your own schedule.' -ForegroundColor DarkGray
  Write-Host '      Code stays on the last manual deploy until you ship it.' -ForegroundColor DarkGray
  Write-Host '  0 = SKIP. No dedicated deploy lane is started at all.' -ForegroundColor Gray
  Write-Host '      Issue lanes still verify, merge, and tag releases on their own. Pick when you want pure issue throughput.' -ForegroundColor DarkGray
  Write-Host ''
  Write-Host 'In every mode, GitHub release tags are created as PRs merge -- the mode only controls whether code reaches prod.' -ForegroundColor DarkGray
  Write-Host 'A "cycle" is one pass through the recipe (verify -> release -> backlog -> sleep). Each step only runs if there is work for it; an idle cycle is just ~30 seconds.' -ForegroundColor DarkGray
  Write-Host ''
  $deployMode = Read-NonNegativeInt -Prompt 'Deploy lane mode (0=skip, 1=release-only, 2=full deploy)' -Default 2
  $issueCount = Read-NonNegativeInt -Prompt 'Issue lanes' -Default 3
  $blockerCount = Read-NonNegativeInt -Prompt 'Blocker lanes' -Default 1
  $discussionCount = Read-NonNegativeInt -Prompt 'Discussion lanes' -Default 1
  $stopAt = Read-OptionalStopAtEastern
  $sleepSeconds = Read-PositiveInt -Prompt 'Seconds to wait between cycles' -Default 10

  Invoke-MenuCommand 'Start super speed mode' {
    if ($deployMode -ge 2) {
      if (!(Confirm-ProductionDeploy)) {
        Write-Host 'Super speed mode cancelled.'
        return
      }
    }

    $started = New-Object System.Collections.Generic.List[string]

    if ($deployMode -ge 1) {
      $deployParams = @{
        Mode = 'Start'
        Lane = 'super-deploy'
        Recipe = 'DeployFocused'
        Profile = $profile
        NoDefaults = $true
        RepeatUntilStop = $true
        SleepBetweenCyclesSec = $sleepSeconds
        PrVerifyPreflight = 1
        PrVerify = 1
        ChangelogRoast = 1
        Release = 1
        IssueRoast = 0
        IssueWork = 0
        DiscussionPromote = 0
        DiscussionTriage = 0
      }
      if ($deployMode -ge 2) { $deployParams.Deploy = $true }
      if (![string]::IsNullOrWhiteSpace($stopAt)) { $deployParams.StopAt = $stopAt }
      & .\scripts\github-loop\lanes.ps1 @deployParams
      $started.Add('super-deploy') | Out-Null
    } else {
      Write-Host 'Skipping super-deploy lane (deploy mode 0). Releases will only be tagged if an issue lane reaches the release step.' -ForegroundColor Yellow
    }

    foreach ($lane in (Get-LaneNamesForStart -BaseName 'super-issue' -Count $issueCount)) {
      # SS issue lanes use the same DeployFocused-no-deploy recipe as ON so each
      # lane is independently capable of: PR verify, release creation, and the
      # backlog fallback (work -> roast -> promote -> triage). Release/deploy
      # lock serializes release tag creation across lanes. With deploy mode 0
      # this means ai:ready-for-release issues still get tagged; without this
      # switch they would accumulate forever.
      $params = @{
        Mode = 'Start'
        Lane = $lane
        Recipe = 'DeployFocused'
        Profile = $profile
        NoDefaults = $true
        RepeatUntilStop = $true
        SleepBetweenCyclesSec = $sleepSeconds
        PrVerifyPreflight = 1
        PrVerify = 1
        ChangelogRoast = 1
        Release = 1
        IssueRoast = 1
        IssueWork = 1
        DiscussionPromote = 1
        DiscussionTriage = 1
      }
      if (![string]::IsNullOrWhiteSpace($stopAt)) { $params.StopAt = $stopAt }
      & .\scripts\github-loop\lanes.ps1 @params
      $started.Add($lane) | Out-Null
    }

    foreach ($lane in (Get-LaneNamesForStart -BaseName 'super-blocker' -Count $blockerCount)) {
      $params = @{
        Mode = 'Start'
        Lane = $lane
        Recipe = 'BlockerRecovery'
        Profile = $profile
        NoDefaults = $true
        RepeatUntilStop = $true
        SleepBetweenCyclesSec = $sleepSeconds
        PrVerifyPreflight = 1
        IssueRoast = 1
        IssueWork = 1
        PrVerify = 1
        ChangelogRoast = 1
      }
      if (![string]::IsNullOrWhiteSpace($stopAt)) { $params.StopAt = $stopAt }
      & .\scripts\github-loop\lanes.ps1 @params
      $started.Add($lane) | Out-Null
    }

    foreach ($lane in (Get-LaneNamesForStart -BaseName 'super-discussion' -Count $discussionCount)) {
      $params = @{
        Mode = 'Start'
        Lane = $lane
        Recipe = 'DiscussionsToIssues'
        Profile = $profile
        NoDefaults = $true
        RepeatUntilStop = $true
        SleepBetweenCyclesSec = $sleepSeconds
        DiscussionTriage = 1
        DiscussionPromote = 1
      }
      if (![string]::IsNullOrWhiteSpace($stopAt)) { $params.StopAt = $stopAt }
      & .\scripts\github-loop\lanes.ps1 @params
      $started.Add($lane) | Out-Null
    }

    Write-Host ''
    Write-Host "Super speed lanes requested: $($started -join ', ')" -ForegroundColor Cyan
    Write-Host 'Only the deploy-focused lane deploys; release/deploy is protected by a cross-process workflow lock.'
    if (![string]::IsNullOrWhiteSpace($stopAt)) {
      Write-Host "Stop time is interpreted as Eastern time: $stopAt"
    }
  }
}

function Edit-ModelProfile {
  $path = Join-Path $Root 'config\github-workflow-profiles.json'
  $profiles = [ordered]@{}
  if (Test-Path $path) {
    $parsed = Get-Content -Raw $path | ConvertFrom-Json
    foreach ($profileName in $parsed.PSObject.Properties.Name) {
      $profiles[$profileName] = $parsed.$profileName
    }
  }

  Write-Host ''
  Show-ModelPresetChoices
  Write-Host ''
  $existingNames = @($profiles.Keys)
  if ($existingNames.Count -gt 0) {
    Write-Host 'Existing profiles:' -ForegroundColor Cyan
    for ($pi = 0; $pi -lt $existingNames.Count; $pi++) {
      Write-Host ("  {0,2}. {1}" -f ($pi + 1), $existingNames[$pi]) -ForegroundColor Cyan
    }
  }
  Write-Host ''
  Write-Host '  Actions: edit (default), rename, delete' -ForegroundColor DarkGray
  $profileRaw = Read-TextDefault -Prompt 'Profile name or number to create/update' -Default 'default'
  $profileName = $profileRaw
  $pn = 0
  if ([int]::TryParse($profileRaw, [ref]$pn) -and $pn -ge 1 -and $pn -le $existingNames.Count) {
    $profileName = $existingNames[$pn - 1]
  }
  if ($profileName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,48}$') {
    throw "Invalid profile name '$profileName'. Use letters, numbers, dot, underscore, or dash."
  }

  if ($profiles.Contains($profileName)) {
    $action = Read-TextDefault -Prompt "Action for '$profileName' (edit/rename/delete)" -Default 'edit'
    if ($action -eq 'delete') {
      $profiles.Remove($profileName)
      $jsonRoot = [ordered]@{}
      foreach ($name in $profiles.Keys) { $jsonRoot[$name] = $profiles[$name] }
      Write-Utf8NoBom -Path $path -Content (($jsonRoot | ConvertTo-Json -Depth 6) + "`n")
      Write-Host "Deleted profile '$profileName'." -ForegroundColor Yellow
      return
    }
    if ($action -eq 'rename') {
      $newName = Read-TextDefault -Prompt 'New profile name' -Default $profileName
      if ($newName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,48}$') {
        throw "Invalid profile name '$newName'."
      }
      $profiles[$newName] = $profiles[$profileName]
      $profiles.Remove($profileName)
      $jsonRoot = [ordered]@{}
      foreach ($name in $profiles.Keys) { $jsonRoot[$name] = $profiles[$name] }
      Write-Utf8NoBom -Path $path -Content (($jsonRoot | ConvertTo-Json -Depth 6) + "`n")
      Write-Host "Renamed '$profileName' to '$newName'." -ForegroundColor Green
      return
    }
  }

  $base = $null
  if ($profiles.Contains($profileName)) {
    $base = $profiles[$profileName]
  } elseif ($profiles.Contains('default')) {
    $base = $profiles['default']
  }

  $updated = [ordered]@{}
  foreach ($step in Get-WorkflowProfileSteps) {
    $defaultPreset = 'codex-yolo'
    if ($base -and ($base.PSObject.Properties.Name -contains $step)) {
      $defaultPreset = [string]$base.$step
    }
    Write-Host ("Current {0}: {1}" -f $step, (Get-ModelPresetLabel -Key $defaultPreset)) -ForegroundColor DarkGray
    $updated[$step] = Read-PresetKey -Step $step -Default $defaultPreset
  }

  $profiles[$profileName] = [pscustomobject]$updated
  $jsonRoot = [ordered]@{}
  foreach ($name in $profiles.Keys) {
    $jsonRoot[$name] = $profiles[$name]
  }
  Write-Utf8NoBom -Path $path -Content (($jsonRoot | ConvertTo-Json -Depth 6) + "`n")

  Write-Host ''
  Write-Host "Saved profile '$profileName' to config\github-workflow-profiles.json." -ForegroundColor Green
  Write-Host ''
  Get-Content -Raw $path | Write-Host
}


function Show-WaitingOnUser {
  Write-Host ''
  Write-Host 'Issues waiting on you:' -ForegroundColor Cyan
  $issues = & $Gh issue list --repo radialmonster/bigbsky-dev --state open --label ai:needs-user-answer --limit 50 --json number,title,url |
    ConvertFrom-Json
  if ($issues.Count -eq 0) {
    Write-Host '  none'
  } else {
    $issues | ForEach-Object {
      Write-Host ("  Issue #{0}: {1}" -f $_.number, $_.title)
      Write-Host ("    {0}" -f $_.url)
    }
  }

  Write-Host ''
  Write-Host 'Discussions waiting on you:' -ForegroundColor Cyan
  $query = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){discussions(first:100){nodes{number title url labels(first:20){nodes{name}}}}}}'
  $result = & $Gh api graphql -f "query=$query" -F owner=radialmonster -F name=bigbsky-dev | ConvertFrom-Json
  $discussions = @($result.data.repository.discussions.nodes | Where-Object {
    @($_.labels.nodes | ForEach-Object { $_.name }) -contains 'ai:needs-user-answer'
  })
  if ($discussions.Count -eq 0) {
    Write-Host '  none'
  } else {
    $discussions | ForEach-Object {
      Write-Host ("  Discussion #{0}: {1}" -f $_.number, $_.title)
      Write-Host ("    {0}" -f $_.url)
    }
  }
}

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

function Show-WorkflowHealth {
  Write-Host ''
  Write-Host 'Workflow health' -ForegroundColor Cyan

  $issuesRaw = & $Gh issue list --repo radialmonster/bigbsky-dev --state open --limit 200 --json number,title,labels,url,createdAt,updatedAt
  $readyReleaseRaw = & $Gh issue list --repo radialmonster/bigbsky-dev --state closed --label ai:ready-for-release --limit 100 --json number,title,labels,url,createdAt,updatedAt
  $prsRaw = & $Gh pr list --repo radialmonster/bigbsky-dev --state open --limit 100 --json number,title,labels,url
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
      ($labels -contains 'ai:needs-verify') -and ($labels -contains 'ai:pr-open')
    })
    'Ready for release' = @($readyReleaseIssues)
    'Claimed' = @($issues | Where-Object { (Get-LabelNames $_) -contains 'ai:claimed' })
  }

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
}

function Show-Menu {
  Clear-Host
  Write-Host 'Bigbsky GitHub Workflow Menu' -ForegroundColor Cyan
  Write-Host ''
  Write-Host '--- Status ---' -ForegroundColor DarkGray
  Write-Host '2.  Show items waiting on me'
  Write-Host 'H.  Show workflow health dashboard'
  Write-Host 'Q.  Show workflow hygiene report'
  Write-Host 'PL. Pull latest from origin/main'
  Write-Host 'LG. View recent loop output (tail loop.log)'
  Write-Host ''
  Write-Host '--- Single-pass runs (run once then exit) ---' -ForegroundColor DarkGray
  Write-Host 'A.  One pipeline pass: roast, implement, verify, release  [no deploy]'
  Write-Host 'G.  One pipeline pass with deploy'
  Write-Host 'B.  One blocker-recovery pass  [no deploy]'
  Write-Host 'O.  One custom pass, you set iteration counts  [no deploy]'
  Write-Host 'FT. Fast-track one issue or discussion through the full pipeline'
  Write-Host ''
  Write-Host '--- Continuous lanes (run until stopped -- use for overnight) ---' -ForegroundColor DarkGray
  Write-Host 'ON. Continuous issue ship lane (single lane, no deploy, recommended for overnight)'
  Write-Host 'ONN.Multiple continuous issue ship lanes in parallel (N lanes, no deploy)'
  Write-Host 'SS. Super speed: many parallel lanes  [deploy + work, best overnight throughput]'
  Write-Host 'CD. Continuous deploy lane (deploys EVERY cycle, ~30 min per deploy)'
  Write-Host 'CDT.Continuous throttled-deploy lane (deploys only after N releases or N hours since last deploy)'
  Write-Host 'K.  Start discussion lane in separate worktree'
  Write-Host 'N.  Start issue lane in separate worktree (single-cycle batch, exits after one pass)'
  Write-Host 'E.  Start blocker lane in separate worktree'
  Write-Host ''
  Write-Host '--- Release / deploy ---' -ForegroundColor DarkGray
  Write-Host 'L.  Create GitHub Release / deploy to production'
  Write-Host 'J.  List parallel lanes'
  Write-Host 'JU. Clear stopped lane history'
  Write-Host 'Z.  Stop one parallel lane after current session'
  Write-Host 'X.  Stop all parallel lanes after current session'
  Write-Host 'KL. Force-kill one lane now'
  Write-Host ''
  Write-Host '--- Model configuration ---' -ForegroundColor DarkGray
  Write-Host 'M.  Show model profiles'
  Write-Host 'F.  Create or edit model profile'
  Write-Host 'Y.  Run model/provider smoke test across all presets'
  Write-Host ''
  Write-Host '--- Prepare bundles (no model run) ---' -ForegroundColor DarkGray
  Write-Host 'R.  Prepare one issue roast bundle'
  Write-Host 'W.  Prepare one issue work bundle'
  Write-Host 'V.  Prepare one PR verification bundle'
  Write-Host 'P.  Prepare one discussion promotion bundle'
  Write-Host 'C.  Prepare one changelog fragment roast bundle'
  Write-Host ''
  Write-Host '--- Maintenance ---' -ForegroundColor DarkGray
  Write-Host 'K9. Roast random code'
  Write-Host 'I.  Retry infra-blocked issues immediately'
  Write-Host 'CL. Full tidy (labels, PR sync, infra-blocked, unblock, worktree cleanup)'
  Write-Host 'UC. Clear stuck ai:claimed labels'
  Write-Host 'S.  Stop running loop after current session'
  Write-Host '0.  Exit'
  Write-Host ''
}

Set-Location $Root

:menu while ($true) {
  Show-Menu
  $choice = (Read-Host 'Choose').Trim().ToUpperInvariant().Replace(' ', '')
  try {
    if ($choice -ne '0') { Confirm-MenuAction -Choice $choice }
    switch -CaseSensitive ($choice) {
    '2' {
      Invoke-MenuCommand 'Items waiting on me' {
        & .\scripts\github-loop\show-waiting-on-user.ps1
      }
    }
    'H' {
      Invoke-MenuCommand 'Workflow health dashboard' {
        & .\scripts\github-loop\workflow-health.ps1
      }
    }
    'Q' {
      Invoke-MenuCommand 'Workflow hygiene report' {
        & .\scripts\github-loop\workflow-hygiene.ps1
      }
    }
    'PL' {
      Invoke-MenuCommand 'Pull latest from origin/main' {
        Sync-WorkflowMainWorktree -Path $Root -Context 'manual sync'
      }
    }
    'LG' {
      Invoke-MenuCommand 'View recent loop output' {
        $logPath = Join-Path $Root 'loop.log'
        if (!(Test-Path $logPath)) {
          Write-Host 'No loop.log found.' -ForegroundColor Yellow
        } else {
          Get-Content -LiteralPath $logPath -Tail 80 -ErrorAction SilentlyContinue |
            ForEach-Object { Write-Host $_ }
        }
      }
    }
    'A' {
      $profile = Read-WorkflowProfile -Default 'default'
      Invoke-MenuCommand 'Autonomous safe cycle, no deploy' {
        & .\scripts\github-loop\orchestrate.ps1 -Recipe SafeCycle -Profile $profile
      }
    }
    'G' {
      $profile = Read-WorkflowProfile -Default 'default'
      Invoke-MenuCommand 'Autonomous full ship cycle with deploy' {
        & .\scripts\github-loop\orchestrate.ps1 -Recipe FullShip -Profile $profile -Deploy
      }
    }
    'B' {
      $profile = Read-WorkflowProfile -Default 'default'
      Invoke-MenuCommand 'Blocker recovery cycle, no deploy' {
        & .\scripts\github-loop\orchestrate.ps1 -Recipe BlockerRecovery -Profile $profile
      }
    }
    'O' {
      $profile = Read-WorkflowProfile -Default 'default'
      $discussionTriage = Read-NonNegativeInt -Prompt 'Discussion triage iterations' -Default 0
      $discussionPromote = Read-NonNegativeInt -Prompt 'Discussion promotion iterations' -Default 0
      $issueRoast = Read-NonNegativeInt -Prompt 'Issue roast iterations' -Default 2
      $issueWork = Read-NonNegativeInt -Prompt 'Issue work iterations' -Default 2
      $prVerify = Read-NonNegativeInt -Prompt 'PR verify iterations' -Default 2
      $changelogRoast = Read-NonNegativeInt -Prompt 'Changelog roast iterations' -Default 2
      $release = Read-NonNegativeInt -Prompt 'Release creation iterations' -Default 0
      Invoke-MenuCommand 'Custom orchestrator counts, no deploy' {
        & .\scripts\github-loop\orchestrate.ps1 -Recipe SafeCycle -Profile $profile -NoDefaults -DiscussionTriage $discussionTriage -DiscussionPromote $discussionPromote -IssueRoast $issueRoast -IssueWork $issueWork -PrVerify $prVerify -ChangelogRoast $changelogRoast -Release $release
      }
    }
    'FT' {
      $raw = Read-Host 'Enter issue or discussion URL/number (e.g. 278 or https://github.com/radialmonster/bigbsky-dev/issues/278)'
      if (Test-CancelInput -Value $raw) { throw '__MENU_CANCEL__' }
      $targetType = ''
      $targetNumber = 0
      if ($raw -match 'github\.com/[^/]+/[^/]+/issues/(\d+)(?:$|[?#])') {
        $targetType = 'issue'
        $targetNumber = [int]$Matches[1]
      } elseif ($raw -match 'github\.com/[^/]+/[^/]+/discussions/(\d+)(?:$|[?#])') {
        $targetType = 'discussion'
        $targetNumber = [int]$Matches[1]
      } elseif ($raw -match '^\d+$') {
        $targetNumber = [int]$raw
        $issueResult = & $Gh issue view $targetNumber --repo radialmonster/bigbsky-dev --json number 2>$null
        if ($LASTEXITCODE -eq 0 -and ![string]::IsNullOrWhiteSpace($issueResult)) {
          $targetType = 'issue'
        } else {
          $targetType = 'discussion'
        }
      } else {
        Write-Host "Could not parse '$raw' as an issue/discussion URL or number." -ForegroundColor Red
        break
      }
      Write-Host "Target: $targetType #$targetNumber" -ForegroundColor Cyan
      $profile = Read-WorkflowProfile -Default 'default'
      if ($targetType -eq 'discussion') {
        $deploy = Confirm-ProductionDeploy
        if ($deploy) {
          Invoke-MenuCommand "Fast-track discussion #$targetNumber through the full pipeline" {
            & .\scripts\github-loop\orchestrate.ps1 -Recipe FastTrackDiscussion -Profile $profile -TargetDiscussionNumber $targetNumber -Deploy
          }
        } else {
          Invoke-MenuCommand "Fast-track discussion #$targetNumber through the full pipeline (no deploy)" {
            & .\scripts\github-loop\orchestrate.ps1 -Recipe FastTrackDiscussion -Profile $profile -TargetDiscussionNumber $targetNumber
          }
        }
      } else {
        $deploy = Confirm-ProductionDeploy
        if ($deploy) {
          Invoke-MenuCommand "Fast-track issue #$targetNumber through the full pipeline" {
            & .\scripts\github-loop\orchestrate.ps1 -Recipe FastTrackIssue -Profile $profile -TargetIssueNumber $targetNumber -Deploy
          }
        } else {
          Invoke-MenuCommand "Fast-track issue #$targetNumber through the full pipeline (no deploy)" {
            & .\scripts\github-loop\orchestrate.ps1 -Recipe FastTrackIssue -Profile $profile -TargetIssueNumber $targetNumber
          }
        }
      }
    }
    'M' {
      Invoke-MenuCommand 'Model profiles' { Show-ModelProfiles }
    }
    'F' {
      Invoke-MenuCommand 'Create or edit model profile' { Edit-ModelProfile }
    }
    'K' {
      Start-LaneGroup -Label 'discussion' -DefaultBaseName 'discussion' -Recipe 'DiscussionsToIssues'
    }
    'N' {
      Start-LaneGroup -Label 'issue' -DefaultBaseName 'issue' -Recipe 'IssuesToPr'
    }
    'ON' {
      Start-ContinuousIssueShipLane
    }
    'ONN' {
      Start-ContinuousIssueShipLaneGroup
    }
    'CD' {
      Start-ContinuousDeployLane
    }
    'CDT' {
      Start-ContinuousThrottledDeployLane
    }
    'SS' {
      Start-SuperSpeedMode
    }
    'E' {
      Start-LaneGroup -Label 'blocker' -DefaultBaseName 'blocker' -Recipe 'BlockerRecovery'
    }
    'J' {
      Invoke-MenuCommand 'Parallel lanes' {
        & .\scripts\github-loop\lanes.ps1 -Mode List
      }
    }
    'JU' {
      Invoke-MenuCommand 'Clear stopped lane history' {
        & .\scripts\github-loop\lanes.ps1 -Mode PruneStopped
      }
    }
    'Z' {
      $lane = Read-TextDefault -Prompt 'Lane name' -Default 'issue-1'
      Invoke-MenuCommand "Stop lane $lane" {
        & .\scripts\github-loop\lanes.ps1 -Mode Stop -Lane $lane
      }
    }
    'X' {
      Invoke-MenuCommand 'Stop all parallel lanes after current session' {
        & .\scripts\github-loop\lanes.ps1 -Mode StopAll
      }
    }
    'KL' {
      Invoke-MenuCommand 'Force-kill one lane now' {
        $stateRoot = Join-Path $Root '.loop-tmp\lanes'
        if (!(Test-Path $stateRoot)) {
          Write-Host 'No lane state directory found.' -ForegroundColor Yellow
          return
        }
        $stateFiles = @(Get-ChildItem -Path $stateRoot -Filter '*.json' -File -ErrorAction SilentlyContinue)
        if ($stateFiles.Count -eq 0) {
          Write-Host 'No lane state files found.' -ForegroundColor Yellow
          return
        }
        Write-Host ''
        Write-Host 'Lanes with state files:' -ForegroundColor Cyan
        foreach ($f in $stateFiles) {
          try {
            $state = Get-Content -Raw -LiteralPath $f.FullName | ConvertFrom-Json
            $lanePid = [int]$state.pid
            $alive = $lanePid -gt 0 -and ($null -ne (Get-Process -Id $lanePid -ErrorAction SilentlyContinue))
            Write-Host ("  {0,-24} PID={1,-8} alive={2}" -f $f.BaseName, $lanePid, $alive)
          } catch {
            Write-Host ("  {0,-24} (unreadable state)" -f $f.BaseName) -ForegroundColor DarkGray
          }
        }
        Write-Host ''
        $laneName = (Read-Host 'Lane name to force-kill (blank to cancel)').Trim()
        if ([string]::IsNullOrWhiteSpace($laneName)) {
          Write-Host 'Cancelled.' -ForegroundColor Yellow
          return
        }
        $stateFile = Join-Path $stateRoot "$laneName.json"
        if (!(Test-Path $stateFile)) {
          Write-Host "No state file found for lane '$laneName'." -ForegroundColor Red
          return
        }
        $state = Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json
        $lanePid = [int]$state.pid
        if ($lanePid -le 0) {
          Write-Host "Lane '$laneName' has no tracked PID in state file." -ForegroundColor Yellow
          return
        }
        if ($null -eq (Get-Process -Id $lanePid -ErrorAction SilentlyContinue)) {
          Write-Host "PID $lanePid is not running. Lane may have already stopped." -ForegroundColor Yellow
          return
        }
        Write-Host "Force-killing lane '$laneName' (PID $lanePid) and all descendants..." -ForegroundColor Yellow
        & taskkill /T /F /PID $lanePid 2>&1 | Out-Null
        Write-Host "Kill signal sent to lane '$laneName' (PID $lanePid)." -ForegroundColor Green
      }
    }
    'L' {
      Invoke-MenuCommand 'Create GitHub Release / deploy to production' {
        if (Confirm-ProductionDeploy) {
          & .\scripts\github-loop\orchestrate.ps1 -Recipe SafeCycle -Profile default -NoDefaults -Release 1 -Deploy
        } else {
          Write-Host 'Running release creation only (no deploy).'
          & .\scripts\github-loop\orchestrate.ps1 -Recipe SafeCycle -Profile default -NoDefaults -Release 1
        }
      }
    }
    'R' {
      Invoke-MenuCommand 'Prepare one issue roast bundle' {
        Invoke-LocalWorkflowScript -Context 'Prepare one issue roast bundle' {
          & .\scripts\github-loop\issue-roast.ps1 -Mode Prepare
        }
      }
    }
    'W' {
      Invoke-MenuCommand 'Prepare one issue work bundle' {
        Invoke-LocalWorkflowScript -Context 'Prepare one issue work bundle' {
          & .\scripts\github-loop\work-issue.ps1 -Mode Prepare
        }
      }
    }
    'V' {
      Invoke-MenuCommand 'Prepare one PR verification bundle' {
        Invoke-LocalWorkflowScript -Context 'Prepare one PR verification bundle' {
          & .\scripts\github-loop\pr-verify.ps1 -Mode Prepare
        }
      }
    }
    'P' {
      Invoke-MenuCommand 'Prepare one discussion promotion' {
        Invoke-LocalWorkflowScript -Context 'Prepare one discussion promotion' {
          & .\scripts\github-loop\promote-discussion.ps1
        }
      }
    }
    'C' {
      Invoke-MenuCommand 'Prepare one changelog fragment roast' {
        Invoke-LocalWorkflowScript -Context 'Prepare one changelog fragment roast' {
          & .\scripts\github-loop\changelog-fragment.ps1 -Mode Prepare
        }
      }
    }
    'Y' {
      Invoke-MenuCommand 'Model/provider smoke test' {
        Sync-MenuMainWorktree -Context 'Model smoke test'
        & .\scripts\github-loop\model-smoke.ps1 -All
      }
    }
    'K9' {
      Invoke-MenuCommand 'Roast random code' {
        $k9Profile = Read-WorkflowProfile -Default 'default'
        $k9Preset = 'codex-yolo'
        $profileConfig = Get-WorkflowProfiles
        if ($null -ne $profileConfig -and $profileConfig.PSObject.Properties.Name -contains $k9Profile) {
          $k9ProfileObj = $profileConfig.$k9Profile
          if ($k9ProfileObj.PSObject.Properties.Name -contains 'issue_roast') {
            $k9Preset = [string]$k9ProfileObj.issue_roast
          }
        }
        $k9Iterations = Read-PositiveInt -Prompt 'Iterations' -Default 1
        Invoke-LoopWithBranchRestore -Preset $k9Preset -Prompt prompt-github-random-code-roast.txt -MaxIterations $k9Iterations
      }
    }
    'I' {
      Invoke-MenuCommand 'Retry infra-blocked immediately' {
        & .\scripts\github-loop\retry-infra-blocked.ps1 -CooldownMinutes 0
      }
    }
    'CL' {
      Invoke-MenuCommand 'Full tidy' {
        Write-Host 'Step 1/7: Fixing label inconsistencies...' -ForegroundColor Cyan
        & .\scripts\github-loop\label-audit.ps1 -Apply
        Write-Host 'Step 2/7: Syncing PR/issue state...' -ForegroundColor Cyan
        & .\scripts\github-loop\sync-pr-issue-state.ps1
        Write-Host 'Step 3/7: Retrying infra-blocked items...' -ForegroundColor Cyan
        & .\scripts\github-loop\retry-infra-blocked.ps1 -CooldownMinutes 0
        Write-Host 'Step 4/7: Unblocking resolved dependencies...' -ForegroundColor Cyan
        & .\scripts\github-loop\unblock-resolved-dependencies.ps1
        Write-Host 'Step 5/6: Unblocking resolved follow-ups...' -ForegroundColor Cyan
        & .\scripts\github-loop\unblock-resolved-followups.ps1
        Write-Host 'Step 6/7: Closing duplicate discussions...' -ForegroundColor Cyan
        & .\scripts\github-loop\close-duplicate-discussions.ps1 -Apply
        Write-Host 'Step 7/7: Cleaning up stale lane worktrees...' -ForegroundColor Cyan
        try {
          Sync-MenuMainWorktree -Context 'Full tidy worktree cleanup'
          & .\scripts\github-loop\workflow-cleanup.ps1 -Apply
        } catch {
          Write-Host ("Worktree cleanup skipped: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
        }
        Write-Host 'Full tidy complete.' -ForegroundColor Green
      }
    }
    'UC' {
      Invoke-MenuCommand 'Clear stuck ai:claimed labels' {
        & .\scripts\github-loop\unclaim-issue.ps1
      }
    }
    'S' {
      Invoke-MenuCommand 'Request loop stop after current session' {
        New-Item -ItemType Directory -Path .loop-tmp -Force | Out-Null
        New-Item -ItemType File -Path .loop-tmp\stop-after.flag -Force | Out-Null
        Write-Host 'Stop flag created. The running loop will exit after the current session.'
      }
    }
    '0' { break menu }
    default {
      if (Test-CancelInput -Value $choice) { break menu }
      Write-Host 'Unknown choice. Press Enter to try again.' -ForegroundColor Yellow
      [void](Read-Host)
    }
    }
  } catch {
    if ($_.Exception.Message -eq '__MENU_CANCEL__') {
      Write-Host 'Cancelled. Returning to menu.' -ForegroundColor Yellow
      Start-Sleep -Milliseconds 700
    } else {
      throw
    }
  }
}
