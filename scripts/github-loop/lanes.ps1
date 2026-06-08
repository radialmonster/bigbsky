param(
  [ValidateSet('Ensure', 'Start', 'List', 'Stop', 'StopAll', 'Remove', 'PruneStopped')]
  [string]$Mode = 'List',
  [string]$Lane = '',
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
  [string]$LanesRoot = '',
  [int]$TargetIssueNumber = 0,
  [int]$TargetDiscussionNumber = 0,
  [int]$DeployAfterReleases = 0,
  [int]$DeployAfterHours = 0
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
if ([string]::IsNullOrWhiteSpace($PrimaryRoot)) {
  if ($env:BIGBSKY_PRIMARY_ROOT) { $PrimaryRoot = $env:BIGBSKY_PRIMARY_ROOT }
  else { $PrimaryRoot = [string]$Root }
}
if ([string]::IsNullOrWhiteSpace($LanesRoot)) {
  if ($env:BIGBSKY_LANES_ROOT) { $LanesRoot = $env:BIGBSKY_LANES_ROOT }
  else { $LanesRoot = [System.IO.Path]::GetFullPath((Join-Path $PrimaryRoot '..\bigbsky-github-lanes')) }
}
$StateRoot = Join-Path $Root '.loop-tmp\lanes'
. (Join-Path $PSScriptRoot 'git-sync.ps1')
. (Join-Path $PSScriptRoot 'workflow-lock.ps1')

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Get-LaneName {
  if ([string]::IsNullOrWhiteSpace($Lane)) {
    throw '-Lane is required for this mode.'
  }
  if ($Lane -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,48}$') {
    throw "Invalid lane name '$Lane'. Use letters, numbers, dot, underscore, or dash."
  }
  return $Lane.ToLowerInvariant()
}

function Get-LanePath {
  param([string]$Name)
  return Join-Path $LanesRoot $Name
}

function Test-LaneNameExists {
  param([string]$Name)
  if (Test-Path (Get-LanePath -Name $Name)) { return $true }
  if (Test-Path (Get-StatePath -Name $Name)) { return $true }
  $existingBranch = git -C $Root branch --list "lane/$Name"
  if ($existingBranch) { return $true }
  $existingRemoteBranch = git -C $Root branch -r --list "origin/lane/$Name"
  if ($existingRemoteBranch) { return $true }
  return $false
}

function Get-NewLaneName {
  param([string]$BaseName)
  if (!(Test-LaneNameExists -Name $BaseName)) { return $BaseName }
  for ($i = 2; $i -lt 1000; $i++) {
    $candidate = "$BaseName-$i"
    if (!(Test-LaneNameExists -Name $candidate)) { return $candidate }
  }
  throw "Could not find an unused lane name for '$BaseName'."
}

function Get-StatePath {
  param([string]$Name)
  return Join-Path $StateRoot "$Name.json"
}

function Test-ProcessAlive {
  param(
    [int]$Id,
    [string]$Worktree = ''
  )
  if ($Id -le 0) { return $false }
  $process = Get-Process -Id $Id -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $false }
  if ($process.ProcessName -ne 'pwsh') { return $false }
  if ([string]::IsNullOrWhiteSpace($Worktree)) { return $true }

  try {
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$Id" -ErrorAction Stop
    $cmd = [string]$cim.CommandLine
    $normalizedWorktree = $Worktree.TrimEnd('\', '/')
    return ($cmd -like "*$normalizedWorktree*") -and ($cmd -like '*orchestrate.ps1*')
  } catch {
    return $false
  }
}

function Read-LaneState {
  param([string]$Path)
  if (!(Test-Path $Path)) { return $null }
  try { return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json } catch { return $null }
}

function Get-ShortSha {
  param([string]$Sha)
  if ([string]::IsNullOrWhiteSpace($Sha)) { return 'unknown' }
  if ($Sha.Length -lt 7) { return $Sha }
  return $Sha.Substring(0, 7)
}

function Get-LaneHeadSha {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path) -or !(Test-Path $Path)) { return '' }
  try { return Get-WorkflowGitCommit -Path $Path } catch { return '' }
}

function Get-OriginMainSha {
  param([string]$Path = $Root)
  try { return Get-WorkflowGitCommit -Path $Path -Ref 'origin/main' } catch { return '' }
}

function Limit-ReasonText {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
  $normalized = ($Text -replace '\s+', ' ').Trim()
  if ($normalized.Length -le 180) { return $normalized }
  return $normalized.Substring(0, 177) + '...'
}

function Get-RecentLogText {
  param(
    [string]$Path,
    [int]$Tail = 120
  )
  if ([string]::IsNullOrWhiteSpace($Path) -or !(Test-Path -LiteralPath $Path)) { return '' }
  try { return ((Get-Content -LiteralPath $Path -Tail $Tail -ErrorAction Stop) -join "`n") } catch { return '' }
}

function Get-LaneStopReason {
  param([string]$Worktree)
  if ([string]::IsNullOrWhiteSpace($Worktree) -or !(Test-Path -LiteralPath $Worktree)) { return '' }

  $paths = @(
    (Join-Path $Worktree 'orchestrator.err.log'),
    (Join-Path $Worktree 'loop.log'),
    (Join-Path $Worktree 'orchestrator.log')
  )
  $text = ($paths | ForEach-Object { Get-RecentLogText -Path $_ -Tail 160 }) -join "`n"
  if ([string]::IsNullOrWhiteSpace($text)) { return '' }

  $patterns = @(
    @{ Prefix = 'provider limit'; Pattern = '(?im)^(.*(?:usage limit|usage cap|hit your limit|rate limit|quota|try again at|model is at capacity|provider capacity|temporarily unavailable|overloaded).*)$' },
    @{ Prefix = 'infra-block'; Pattern = '(?im)^(.*infra-block detected.*)$' },
    @{ Prefix = 'failed step'; Pattern = '(?im)^(.*Loop step ''.*'' failed with exit code \d+\.)$' },
    @{ Prefix = 'exception'; Pattern = '(?im)^(.*(?:UnknownDependenciesException|NativeCommandError|Exception|failed with exit code \d+).*)$' }
  )
  foreach ($entry in $patterns) {
    $match = [regex]::Match($text, [string]$entry.Pattern)
    if ($match.Success) {
      return ("{0}: {1}" -f $entry.Prefix, (Limit-ReasonText -Text $match.Groups[1].Value))
    }
  }
  return ''
}

function Assert-LaneFreshFromOriginMain {
  param(
    [string]$Path,
    [string]$Name
  )
  $head = Get-LaneHeadSha -Path $Path
  $originMain = Get-OriginMainSha -Path $path
  if ([string]::IsNullOrWhiteSpace($head) -or [string]::IsNullOrWhiteSpace($originMain)) {
    throw "Lane '$Name' could not determine HEAD/origin-main freshness at $Path."
  }
  if ($head -ne $originMain) {
    throw "Lane '$Name' is not fresh after setup. HEAD $(Get-ShortSha $head), origin/main $(Get-ShortSha $originMain). Remove/recreate this lane before starting."
  }
  return $head
}

function Get-LaneStateRecords {
  New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
  $originMain = ''
  try {
    Invoke-WorkflowGitChecked -Path $Root -GitArgs @('fetch', 'origin') | Out-Null
    $originMain = Get-OriginMainSha -Path $Root
  } catch {}
  return @(Get-ChildItem -Path $StateRoot -Filter '*.json' -File -ErrorAction SilentlyContinue | ForEach-Object {
    $state = Read-LaneState -Path $_.FullName
    if ($state) {
      $worktree = [string]$state.worktree
      $alive = Test-ProcessAlive -Id ([int]$state.pid) -Worktree $worktree
      $headSha = Get-LaneHeadSha -Path $worktree
      $baseSha = if ($state.PSObject.Properties.Name -contains 'base_sha') { [string]$state.base_sha } else { '' }
      $branch = ''
      if (![string]::IsNullOrWhiteSpace($worktree) -and (Test-Path $worktree)) {
        try { $branch = Get-WorkflowGitBranchName -Path $worktree } catch { $branch = '' }
      }
      $freshness = 'unknown'
      if (![string]::IsNullOrWhiteSpace($originMain) -and ![string]::IsNullOrWhiteSpace($headSha)) {
        if ($branch -match '^work/') {
          $freshness = 'active-work'
        } elseif ($branch -match '^lane/' -or [string]::IsNullOrWhiteSpace($branch)) {
          $freshness = if ($headSha -eq $originMain) { 'current' } else { 'stale' }
        } else {
          $freshness = 'non-lane'
        }
      }
      [pscustomobject]@{
        Lane = [string]$state.lane
        Pid = [int]$state.pid
        Alive = $alive
        Status = if ($alive) { 'running' } else { 'stopped' }
        Recipe = [string]$state.recipe
        Worktree = $worktree
        Branch = $branch
        StatePath = $_.FullName
        BaseSha = $baseSha
        HeadSha = $headSha
        OriginMainSha = $originMain
        Freshness = $freshness
        StopReason = if ($alive) { '' } else { Get-LaneStopReason -Worktree $worktree }
      }
    }
  } | Where-Object { $_ })
}

function Ensure-Lane {
  param([string]$Name)
  New-Item -ItemType Directory -Force -Path $LanesRoot | Out-Null
  $path = Get-LanePath -Name $Name
  Write-Host "Ensuring lane '$Name' at $path" -ForegroundColor Cyan
  Invoke-WorkflowGitChecked -Path $Root -GitArgs @('fetch', 'origin') | ForEach-Object { Write-Host $_ }
  if (!(Test-Path $path)) {
    Invoke-WorkflowGitChecked -Path $Root -GitArgs @('worktree', 'add', '-B', "lane/$Name", $path, 'origin/main') | ForEach-Object { Write-Host $_ }
  } else {
    if (!(Test-Path -LiteralPath (Join-Path $path '.git'))) {
      throw "Lane '$Name' exists at $path but is not a Git worktree. Remove it from the lane menu or delete/recreate that folder before starting it."
    }
    Invoke-WorkflowGitChecked -Path $path -GitArgs @('fetch', 'origin') | ForEach-Object { Write-Host $_ }
    $dirty = Invoke-WorkflowGitChecked -Path $path -GitArgs @('status', '--porcelain')
    if ($dirty) {
      throw "Lane '$Name' has local changes in $path. Commit, clean, or remove the lane before starting it again."
    }
    Invoke-WorkflowGitChecked -Path $path -GitArgs @('switch', '-C', "lane/$Name", 'origin/main') | ForEach-Object { Write-Host $_ }
  }
  Invoke-WorkflowGitChecked -Path $path -GitArgs @('config', "branch.lane/$Name.remote", 'origin') | Out-Null
  Invoke-WorkflowGitChecked -Path $path -GitArgs @('config', "branch.lane/$Name.merge", "refs/heads/lane/$Name") | Out-Null
  [void](Assert-LaneFreshFromOriginMain -Path $path -Name $Name)
  return $path
}

function Start-Lane {
  $requestedName = Get-LaneName
  $name = Get-NewLaneName -BaseName $requestedName
  if ($name -ne $requestedName) {
    Write-Host "Lane '$requestedName' already exists. Starting new lane '$name' instead." -ForegroundColor Yellow
  }
  $path = Ensure-Lane -Name $name | Select-Object -Last 1
  $statePath = Get-StatePath -Name $name
  $prior = Read-LaneState -Path $statePath
  if ($prior -and (Test-ProcessAlive -Id ([int]$prior.pid) -Worktree ([string]$prior.worktree))) {
    throw "Lane '$name' is already running as PID $($prior.pid)."
  }
  $baseSha = Assert-LaneFreshFromOriginMain -Path $path -Name $name
  $tmp = Join-Path $path '.loop-tmp'
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  Remove-Item -LiteralPath (Join-Path $tmp 'stop-after.flag') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $tmp 'orchestrator-stop.flag') -Force -ErrorAction SilentlyContinue

  $args = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', (Join-Path $path 'scripts\github-loop\orchestrate.ps1'),
    '-Recipe', $Recipe,
    '-Profile', $Profile
  )
  if ($NoDefaults) { $args += '-NoDefaults' }
  if ($Deploy) { $args += '-Deploy' }
  if ($RepeatUntilStop) { $args += '-RepeatUntilStop' }
  if (![string]::IsNullOrWhiteSpace($StopAt)) {
    $args += '-StopAt'
    $args += $StopAt
  }
  if ($SleepBetweenCyclesSec -ne 60) {
    $args += '-SleepBetweenCyclesSec'
    $args += [string]$SleepBetweenCyclesSec
  }
  if ($InfraRetryCooldownMinutes -ne 30) {
    $args += '-InfraRetryCooldownMinutes'
    $args += [string]$InfraRetryCooldownMinutes
  }
  if (![string]::IsNullOrWhiteSpace($PrimaryRoot)) {
    $args += '-PrimaryRoot'
    $args += $PrimaryRoot
  }
  foreach ($pair in @(
    @('DiscussionTriage', $DiscussionTriage),
    @('DiscussionPromote', $DiscussionPromote),
    @('IssueRoast', $IssueRoast),
    @('IssueWork', $IssueWork),
    @('PrVerifyPreflight', $PrVerifyPreflight),
    @('PrVerify', $PrVerify),
    @('ChangelogRoast', $ChangelogRoast),
    @('Release', $Release)
  )) {
    if ([int]$pair[1] -ne 0) {
      $args += "-$($pair[0])"
      $args += [string]$pair[1]
    }
  }
  if ($TargetIssueNumber -gt 0) {
    $args += '-TargetIssueNumber'
    $args += [string]$TargetIssueNumber
  }
  if ($TargetDiscussionNumber -gt 0) {
    $args += '-TargetDiscussionNumber'
    $args += [string]$TargetDiscussionNumber
  }
  if ($DeployAfterReleases -gt 0) {
    $args += '-DeployAfterReleases'
    $args += [string]$DeployAfterReleases
  }
  if ($DeployAfterHours -gt 0) {
    $args += '-DeployAfterHours'
    $args += [string]$DeployAfterHours
  }

  $stdoutPath = Join-Path $path 'orchestrator.log'
  $stderrPath = Join-Path $path 'orchestrator.err.log'
  $process = Start-Process -FilePath 'pwsh.exe' -ArgumentList $args -WorkingDirectory $path -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  $monitorArgs = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command',
    "Wait-Process -Id $($process.Id) -ErrorAction SilentlyContinue; Set-Location '$Root'; & '$Root\scripts\github-loop\workflow-cleanup.ps1' -Apply *>> '$Root\.loop-tmp\lane-cleanup.log'"
  )
  Start-Process -FilePath 'pwsh.exe' -ArgumentList $monitorArgs -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
  $state = [ordered]@{
    lane = $name
    pid = $process.Id
    started_at = (Get-Date -Format o)
    worktree = $path
    base_ref = 'origin/main'
    base_sha = $baseSha
    script_sync_sha = $baseSha
    recipe = $Recipe
    profile = $Profile
    deploy = [bool]$Deploy
    no_defaults = [bool]$NoDefaults
    repeat_until_stop = [bool]$RepeatUntilStop
    stop_at = $StopAt
    sleep_between_cycles_sec = $SleepBetweenCyclesSec
    infra_retry_cooldown_minutes = $InfraRetryCooldownMinutes
    primary_root = $PrimaryRoot
    stdout = $stdoutPath
    stderr = $stderrPath
    cleanup_monitor = $true
    counts = [ordered]@{
      discussion_triage = $DiscussionTriage
      discussion_promote = $DiscussionPromote
      issue_roast = $IssueRoast
      issue_work = $IssueWork
      pr_verify_preflight = $PrVerifyPreflight
      pr_verify = $PrVerify
      changelog_roast = $ChangelogRoast
      release = $Release
    }
    target_issue_number = $TargetIssueNumber
    target_discussion_number = $TargetDiscussionNumber
    deploy_after_releases = $DeployAfterReleases
    deploy_after_hours = $DeployAfterHours
  } | ConvertTo-Json -Depth 8
  Write-Utf8NoBom -Path $statePath -Content $state
  Write-Host "Started lane '$name' as PID $($process.Id) in $path"
}

function List-Lanes {
  $records = @(Get-LaneStateRecords)
  $releaseLock = Get-WorkflowReleaseDeployLockStatus -Root $PrimaryRoot
  if ($releaseLock) {
    $aliveText = if ($releaseLock.Alive) { 'alive' } else { 'stale' }
    $owner = if ($releaseLock.Lane) { $releaseLock.Lane } else { 'unknown' }
    Write-Host ("Release/deploy lock: {0} PID {1} {2} step={3}" -f $owner, $releaseLock.Pid, $aliveText, $releaseLock.Step) -ForegroundColor Yellow
    if ($releaseLock.Worktree) {
      Write-Host ("  {0}" -f $releaseLock.Worktree) -ForegroundColor DarkGray
    }
    Write-Host ''
  }
  if ($records.Count -eq 0) {
    Write-Host 'Running lanes: 0'
    Write-Host '  none'
    Write-Host ''
    Write-Host 'Stopped lane history: 0'
    return
  }

  $running = @($records | Where-Object { $_.Alive } | Sort-Object Lane)
  $stopped = @($records | Where-Object { -not $_.Alive } | Sort-Object Lane)

  Write-Host ("Running lanes: {0}" -f $running.Count)
  if ($running.Count -eq 0) {
    Write-Host '  none'
  } else {
    foreach ($record in $running) {
      $shaText = "head=$(Get-ShortSha $record.HeadSha) base=$(Get-ShortSha $record.BaseSha) origin=$(Get-ShortSha $record.OriginMainSha)"
      $branchText = if ([string]::IsNullOrWhiteSpace($record.Branch)) { '(unknown-branch)' } else { $record.Branch }
      Write-Host ("  {0,-18} PID {1,-7} {2,-14} {3,-11} {4} {5} {6}" -f $record.Lane, $record.Pid, $record.Recipe, $record.Freshness, $shaText, $branchText, $record.Worktree)
    }
  }

  Write-Host ''
  Write-Host ("Stopped lane history: {0}" -f $stopped.Count)
  if ($stopped.Count -gt 0) {
    $stopped | Select-Object -First 8 | ForEach-Object {
      Write-Host ("  {0,-18} PID {1,-7} {2}" -f $_.Lane, $_.Pid, $_.Recipe)
      if (![string]::IsNullOrWhiteSpace($_.StopReason)) {
        Write-Host ("      last: {0}" -f $_.StopReason) -ForegroundColor Yellow
      }
    }
    if ($stopped.Count -gt 8) {
      Write-Host ("  ... {0} more stopped records" -f ($stopped.Count - 8))
    }
    Write-Host ''
    Write-Host 'Use menu option JU or run lanes.ps1 -Mode PruneStopped to clear stopped lane history.'
  }
}

function Prune-StoppedLaneStates {
  $records = @(Get-LaneStateRecords)
  if ($records.Count -eq 0) {
    Write-Host 'No lane state records found.'
    return
  }

  $running = @($records | Where-Object { $_.Alive })
  $stopped = @($records | Where-Object { -not $_.Alive })
  foreach ($record in $stopped) {
    Remove-Item -LiteralPath $record.StatePath -Force -ErrorAction Stop
    Write-Host ("Removed stopped lane state '{0}'." -f $record.Lane)
  }
  Write-Host ("Pruned {0} stopped lane state records; kept {1} running records." -f $stopped.Count, $running.Count)
  Write-Host 'Lane worktree folders and logs were left in place. Run CL (Full tidy) from the menu to remove stopped clean worktrees.'
}

function Stop-Lane {
  param([string]$Name)
  $path = Get-LanePath -Name $Name
  $tmp = Join-Path $path '.loop-tmp'
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  New-Item -ItemType File -Force -Path (Join-Path $tmp 'stop-after.flag') | Out-Null
  New-Item -ItemType File -Force -Path (Join-Path $tmp 'orchestrator-stop.flag') | Out-Null
  Write-Host "Stop flag written for lane '$Name'. It will stop after its current session."
}

function Remove-Lane {
  $name = Get-LaneName
  $state = Read-LaneState -Path (Get-StatePath -Name $name)
  if ($state -and (Test-ProcessAlive -Id ([int]$state.pid) -Worktree ([string]$state.worktree))) {
    throw "Lane '$name' is still running. Stop it before removing the worktree."
  }
  $path = Get-LanePath -Name $name
  if (Test-Path $path) {
    $resolvedRoot = (Resolve-Path -LiteralPath $LanesRoot).Path.TrimEnd('\')
    $resolvedPath = (Resolve-Path -LiteralPath $path).Path
    if (!$resolvedPath.StartsWith($resolvedRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove lane path outside lanes root: $resolvedPath"
    }
    if (Test-Path -LiteralPath (Join-Path $path '.git')) {
      git -C $Root worktree remove $path
    } else {
      Remove-Item -LiteralPath $path -Recurse -Force
      Write-Host "Removed non-worktree lane folder '$path'."
    }
  }
  $branch = "lane/$name"
  $existingBranch = git -C $Root branch --list $branch
  if ($existingBranch) {
    git -C $Root branch -D $branch | ForEach-Object { Write-Host $_ }
  }
  Remove-Item -LiteralPath (Get-StatePath -Name $name) -Force -ErrorAction SilentlyContinue
  Write-Host "Removed lane '$name'."
}

New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null

switch ($Mode) {
  'Ensure' { [void](Ensure-Lane -Name (Get-LaneName)) }
  'Start' { Start-Lane }
  'List' { List-Lanes }
  'Stop' { Stop-Lane -Name (Get-LaneName) }
  'StopAll' {
    $names = @(Get-ChildItem -Path $StateRoot -Filter '*.json' -File -ErrorAction SilentlyContinue | ForEach-Object { $_.BaseName })
    if ($names.Count -eq 0) { Write-Host 'No known lanes to stop.' }
    foreach ($name in $names) { Stop-Lane -Name $name }
  }
  'Remove' { Remove-Lane }
  'PruneStopped' { Prune-StoppedLaneStates }
}
