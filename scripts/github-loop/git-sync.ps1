function Invoke-WorkflowGitChecked {
  param(
    [string[]]$GitArgs,
    [string]$Path
  )
  if ([string]::IsNullOrWhiteSpace($Path)) { $Path = (Get-Location).Path }
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & git -C $Path @GitArgs 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw "git failed in ${Path}: git $($GitArgs -join ' ')`n$($output -join "`n")"
  }
  return @($output)
}

function Get-WorkflowGitBranchName {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { $Path = (Get-Location).Path }
  $branch = Invoke-WorkflowGitChecked -Path $Path -GitArgs @('branch', '--show-current') | Select-Object -First 1
  if ($null -eq $branch) { return '' }
  return ([string]$branch).Trim()
}

function Get-WorkflowGitCommit {
  param(
    [string]$Path,
    [string]$Ref = 'HEAD'
  )
  if ([string]::IsNullOrWhiteSpace($Path)) { $Path = (Get-Location).Path }
  $commit = Invoke-WorkflowGitChecked -Path $Path -GitArgs @('rev-parse', $Ref) | Select-Object -First 1
  return ([string]$commit).Trim()
}

function Assert-WorkflowCleanWorktree {
  param(
    [string]$Path,
    [string]$Context
  )
  if ([string]::IsNullOrWhiteSpace($Path)) { $Path = (Get-Location).Path }
  if ([string]::IsNullOrWhiteSpace($Context)) { $Context = 'Workflow operation' }
  $status = @(Invoke-WorkflowGitChecked -Path $Path -GitArgs @('status', '--short'))
  if ($status.Count -gt 0) {
    throw "$Context requires a clean worktree at $Path. Dirty paths:`n$($status -join "`n")"
  }
}

function Sync-WorkflowLaneWorktreeIfSafe {
  param(
    [string]$Path,
    [string]$LaneBranch
  )
  if ([string]::IsNullOrWhiteSpace($Path)) { $Path = (Get-Location).Path }
  if ([string]::IsNullOrWhiteSpace($LaneBranch)) { return }
  if ($LaneBranch -notmatch '^lane/') { return }

  $currentBranch = Get-WorkflowGitBranchName -Path $Path
  if ($currentBranch -ne $LaneBranch) {
    Write-Host ("Skipping lane sync; current branch is '{0}', expected '{1}'." -f $currentBranch, $LaneBranch) -ForegroundColor DarkGray
    return
  }

  $status = @(Invoke-WorkflowGitChecked -Path $Path -GitArgs @('status', '--short'))
  if ($status.Count -gt 0) {
    Write-Host ("Skipping lane sync; worktree has local changes on {0}." -f $LaneBranch) -ForegroundColor Yellow
    return
  }

  Invoke-WorkflowGitChecked -Path $Path -GitArgs @('fetch', 'origin') | Out-Null
  $head = Get-WorkflowGitCommit -Path $Path
  $originMain = Get-WorkflowGitCommit -Path $Path -Ref 'origin/main'
  if ($head -eq $originMain) {
    Write-Host ("Lane sync: {0} already at origin/main {1}." -f $LaneBranch, $head.Substring(0, 7)) -ForegroundColor DarkGray
    return
  }

  Write-Host ("Lane sync: refreshing {0} from {1} to origin/main {2}." -f $LaneBranch, $head.Substring(0, 7), $originMain.Substring(0, 7)) -ForegroundColor Cyan
  Invoke-WorkflowGitChecked -Path $Path -GitArgs @('switch', '-C', $LaneBranch, 'origin/main') | Out-Null
}

function Sync-WorkflowMainWorktree {
  # Syncs the primary main worktree with origin/main. Handles three states:
  #   1. HEAD == origin/main             -> no-op
  #   2. HEAD is an ancestor of origin   -> fast-forward (pull --ff-only)
  #   3. origin is an ancestor of HEAD   -> HEAD has local-only commits, push them
  #   4. Diverged                        -> rebase local onto origin, then push
  #
  # State 4 is the real-world failure mode: two lanes both commit to the primary
  # main worktree (release fragment auto-roast, release creation, etc.) near
  # simultaneously. One lane's push wins; the other lane is left with a local
  # commit that diverges from origin. The old --ff-only sync blew up forever
  # in that state. Now we rebase the local commit on top of origin and push.
  param(
    [string]$Path,
    [string]$Context = 'Workflow operation'
  )
  if ([string]::IsNullOrWhiteSpace($Path)) { $Path = (Get-Location).Path }
  if (!(Test-Path $Path)) { throw "$Context requires worktree path that does not exist: $Path" }

  $branch = Get-WorkflowGitBranchName -Path $Path
  if ($branch -ne 'main') {
    throw "$Context requires worktree on main; currently on '$branch' at $Path."
  }
  Assert-WorkflowCleanWorktree -Path $Path -Context $Context

  $maxAttempts = 3
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    Invoke-WorkflowGitChecked -Path $Path -GitArgs @('fetch', 'origin') | Out-Null
    $head = Get-WorkflowGitCommit -Path $Path
    $originMain = Get-WorkflowGitCommit -Path $Path -Ref 'origin/main'

    if ($head -eq $originMain) {
      Write-Host ("Main sync: main already at origin/main {0}." -f $head.Substring(0, 7)) -ForegroundColor DarkGray
      return
    }

    & git -C $Path merge-base --is-ancestor $head $originMain 2>&1 | Out-Null
    $headIsAncestor = ($LASTEXITCODE -eq 0)
    & git -C $Path merge-base --is-ancestor $originMain $head 2>&1 | Out-Null
    $originIsAncestor = ($LASTEXITCODE -eq 0)

    if ($headIsAncestor) {
      Write-Host ("Main sync: fast-forwarding main from {0} to origin/main {1} before {2}." -f $head.Substring(0, 7), $originMain.Substring(0, 7), $Context) -ForegroundColor Cyan
      Invoke-WorkflowGitChecked -Path $Path -GitArgs @('pull', '--ff-only', 'origin', 'main') | Out-Null
      Assert-WorkflowCleanWorktree -Path $Path -Context $Context
      return
    }

    if ($originIsAncestor) {
      Write-Host ("Main sync: HEAD {0} is ahead of origin/main {1}; pushing local commits before {2}." -f $head.Substring(0, 7), $originMain.Substring(0, 7), $Context) -ForegroundColor Cyan
      try {
        Invoke-WorkflowGitChecked -Path $Path -GitArgs @('push', 'origin', 'main') | Out-Null
        return
      } catch {
        if ($attempt -ge $maxAttempts) { throw }
        Write-Host ("Main sync: push rejected on attempt {0}/{1}; another lane pushed first. Refetching and retrying." -f $attempt, $maxAttempts) -ForegroundColor Yellow
        continue
      }
    }

    # Diverged.
    $aheadCount = (@(Invoke-WorkflowGitChecked -Path $Path -GitArgs @('rev-list', '--count', "$originMain..HEAD")) -join '').Trim()
    $behindCount = (@(Invoke-WorkflowGitChecked -Path $Path -GitArgs @('rev-list', '--count', "HEAD..$originMain")) -join '').Trim()
    Write-Host ("Main sync: diverged on attempt {0}/{1}. HEAD {2} has {3} local commit(s) not on origin; origin/main {4} has {5} commit(s) not on HEAD. Rebasing local onto origin before {6}." -f $attempt, $maxAttempts, $head.Substring(0, 7), $aheadCount, $originMain.Substring(0, 7), $behindCount, $Context) -ForegroundColor Yellow

    $rebased = $false
    try {
      Invoke-WorkflowGitChecked -Path $Path -GitArgs @('rebase', 'origin/main') | Out-Null
      $rebased = $true
    } catch {
      & git -C $Path rebase --abort 2>&1 | Out-Null
      throw "$Context could not rebase local main commits onto origin/main at $Path (conflict). Resolve manually:`n  git -C $Path rebase origin/main"
    }
    if (!$rebased) { continue }

    Assert-WorkflowCleanWorktree -Path $Path -Context $Context
    try {
      Invoke-WorkflowGitChecked -Path $Path -GitArgs @('push', 'origin', 'main') | Out-Null
      Write-Host ("Main sync: rebased and pushed. Main now at {0}." -f (Get-WorkflowGitCommit -Path $Path).Substring(0, 7)) -ForegroundColor Green
      return
    } catch {
      if ($attempt -ge $maxAttempts) { throw }
      Write-Host ("Main sync: push after rebase rejected on attempt {0}/{1}; origin moved during rebase. Refetching and retrying." -f $attempt, $maxAttempts) -ForegroundColor Yellow
      continue
    }
  }

  throw "${Context}: could not sync main worktree at $Path after $maxAttempts attempts. Resolve manually."
}
