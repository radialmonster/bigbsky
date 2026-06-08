$script:WorkflowReleaseDeployMutexName = 'bigbsky-github-release-deploy'
$script:WorkflowWorkSelectionMutexName = 'bigbsky-github-work-issue-selection'

function Enter-WorkflowWorkSelectionLock {
  # Cross-process mutex that serializes work-issue.ps1's selection+claim step.
  # Without this, SS-startup races where N parallel lanes all read the
  # ai:fully-roasted candidate list before any of them has claimed, then all
  # pick the same top issue and open duplicate PRs against it. Holding the
  # lock around list -> pick -> add-label -> poll-until-visible ensures the
  # next lane sees the previous claim and skips that issue.
  param([int]$TimeoutSeconds = 120)
  $mutex = New-Object System.Threading.Mutex($false, $script:WorkflowWorkSelectionMutexName)
  $acquired = $false
  try {
    try {
      $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds($TimeoutSeconds))
    } catch [System.Threading.AbandonedMutexException] {
      $acquired = $true
    }
    return [pscustomobject]@{ Acquired = $acquired; Mutex = $mutex }
  } catch {
    if ($acquired) { try { $mutex.ReleaseMutex() | Out-Null } catch {} }
    try { $mutex.Dispose() } catch {}
    throw
  }
}

function Exit-WorkflowWorkSelectionLock {
  param([Parameter(Mandatory = $true)]$Lock)
  if ($Lock.Acquired) { try { $Lock.Mutex.ReleaseMutex() | Out-Null } catch {} }
  try { $Lock.Mutex.Dispose() } catch {}
}

function Enter-WorkflowIssueClaim {
  param([int]$IssueNumber, [int]$TimeoutSeconds = 15)
  $mutexName = "bigbsky-github-issue-claim-$IssueNumber"
  $mutex = New-Object System.Threading.Mutex($false, $mutexName)
  $acquired = $false
  try {
    try {
      $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds($TimeoutSeconds))
    } catch [System.Threading.AbandonedMutexException] {
      $acquired = $true
    }
    return [pscustomobject]@{ Acquired = $acquired; Mutex = $mutex }
  } catch {
    if ($acquired) { try { $mutex.ReleaseMutex() | Out-Null } catch {} }
    try { $mutex.Dispose() } catch {}
    throw
  }
}

function Exit-WorkflowIssueClaim {
  param([Parameter(Mandatory = $true)]$Lock)
  if ($Lock.Acquired) { try { $Lock.Mutex.ReleaseMutex() | Out-Null } catch {} }
  try { $Lock.Mutex.Dispose() } catch {}
}

function Write-Utf8NoBomFile {
  param([string]$Path, [string]$Content)
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Get-WorkflowReleaseDeployLockPath {
  param([string]$Root)
  return Join-Path $Root '.loop-tmp\release-deploy.lock.json'
}

function Test-WorkflowProcessAlive {
  param([int]$ProcessId)
  if ($ProcessId -le 0) { return $false }
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Get-WorkflowReleaseDeployLockStatus {
  param([string]$Root)
  $path = Get-WorkflowReleaseDeployLockPath -Root $Root
  if (!(Test-Path -LiteralPath $path)) { return $null }
  try {
    $metadata = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    $ownerPid = if ($metadata.pid) { [int]$metadata.pid } else { 0 }
    return [pscustomobject]@{
      Path = $path
      Lane = [string]$metadata.lane
      Pid = $ownerPid
      Alive = Test-WorkflowProcessAlive -ProcessId $ownerPid
      Worktree = [string]$metadata.worktree
      Step = [string]$metadata.step
      AcquiredAt = [string]$metadata.acquired_at
    }
  } catch {
    return [pscustomobject]@{
      Path = $path
      Lane = 'unknown'
      Pid = 0
      Alive = $false
      Worktree = ''
      Step = 'unreadable metadata'
      AcquiredAt = ''
    }
  }
}

function Enter-WorkflowReleaseDeployLock {
  param(
    [string]$Root,
    [string]$Lane,
    [string]$Worktree,
    [string]$Step = 'release/deploy',
    [int]$TimeoutSeconds = 0
  )

  $mutex = New-Object System.Threading.Mutex($false, $script:WorkflowReleaseDeployMutexName)
  $acquired = $false
  try {
    try {
      $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds($TimeoutSeconds))
    } catch [System.Threading.AbandonedMutexException] {
      $acquired = $true
    }

    if (!$acquired) {
      $status = Get-WorkflowReleaseDeployLockStatus -Root $Root
      return [pscustomobject]@{
        Acquired = $false
        Mutex = $mutex
        Status = $status
      }
    }

    $path = Get-WorkflowReleaseDeployLockPath -Root $Root
    $metadata = [ordered]@{
      lane = $Lane
      pid = $PID
      worktree = $Worktree
      step = $Step
      acquired_at = (Get-Date -Format o)
    } | ConvertTo-Json -Depth 4
    Write-Utf8NoBomFile -Path $path -Content $metadata

    return [pscustomobject]@{
      Acquired = $true
      Mutex = $mutex
      Status = Get-WorkflowReleaseDeployLockStatus -Root $Root
    }
  } catch {
    if ($acquired) {
      try { $mutex.ReleaseMutex() | Out-Null } catch {}
    }
    try { $mutex.Dispose() } catch {}
    throw
  }
}

function Exit-WorkflowReleaseDeployLock {
  param(
    [Parameter(Mandatory = $true)]$Lock,
    [string]$Root
  )
  if ($Lock.Acquired) {
    try { Remove-Item -LiteralPath (Get-WorkflowReleaseDeployLockPath -Root $Root) -Force -ErrorAction SilentlyContinue } catch {}
    try { $Lock.Mutex.ReleaseMutex() | Out-Null } catch {}
  }
  try { $Lock.Mutex.Dispose() } catch {}
}
