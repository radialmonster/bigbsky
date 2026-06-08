param(
  [string]$Repository = 'radialmonster/bigbsky-dev',
  [switch]$NoComment
)

$ErrorActionPreference = 'Stop'
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

function Add-Label {
  param([int]$IssueNumber, [string]$Label)
  & $Gh issue edit $IssueNumber --repo $Repository --add-label $Label 2>$null | Out-Null
}

function Set-Labels {
  param(
    [int]$IssueNumber,
    [string[]]$Add = @(),
    [string[]]$Remove = @()
  )
  $args = @('issue', 'edit', "$IssueNumber", '--repo', $Repository)
  $addLabels = @($Add | Where-Object { ![string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
  $removeLabels = @($Remove | Where-Object { ![string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
  if ($addLabels.Count -gt 0) { $args += @('--add-label', ($addLabels -join ',')) }
  if ($removeLabels.Count -gt 0) { $args += @('--remove-label', ($removeLabels -join ',')) }
  if ($args.Count -le 4) { return }
  & $Gh @args 2>$null | Out-Null
}

function Remove-Label {
  param([int]$IssueNumber, [string]$Label)
  & $Gh issue edit $IssueNumber --repo $Repository --remove-label $Label 2>$null | Out-Null
}

function Add-PrLabel {
  param([int]$PullRequestNumber, [string]$Label)
  & $Gh issue edit $PullRequestNumber --repo $Repository --add-label $Label 2>$null | Out-Null
}

function Remove-PrLabel {
  param([int]$PullRequestNumber, [string]$Label)
  & $Gh issue edit $PullRequestNumber --repo $Repository --remove-label $Label 2>$null | Out-Null
}

function Sync-PrLabelsFromIssue {
  param(
    [int]$PullRequestNumber,
    [string[]]$IssueLabels,
    [string[]]$CurrentPrLabels,
    [string[]]$LabelsToMirror
  )
  $changed = $false
  foreach ($label in $LabelsToMirror) {
    if (($IssueLabels -contains $label) -and ($CurrentPrLabels -notcontains $label)) {
      Add-PrLabel -PullRequestNumber $PullRequestNumber -Label $label
      $changed = $true
    }
  }
  return $changed
}

# Cleanup pass: closed-but-not-merged PRs that still carry workflow verification
# labels. The merge path strips these labels but the close-without-merge path
# (e.g. superseded duplicate PRs for the same issue) does not, so the stale
# labels accumulate on dead PRs forever and pollute label-based queries.
$staleClosedLabels = @('ai:pr-open', 'ai:needs-verify', 'ai:claimed', 'ai:implemented')
$closedStaleSeen = @{}
$closedStale = @()
foreach ($lbl in @('ai:pr-open', 'ai:needs-verify')) {
  $batch = @(Invoke-GhJson @(
    'pr', 'list',
    '--repo', $Repository,
    '--state', 'closed',
    '--label', $lbl,
    '--json', 'number,labels,mergedAt',
    '--limit', '100'
  ))
  foreach ($pr in $batch) {
    if ($null -ne $pr.mergedAt) { continue }
    if ($closedStaleSeen.ContainsKey([int]$pr.number)) { continue }
    $closedStaleSeen[[int]$pr.number] = $true
    $closedStale += $pr
  }
}

$cleanedClosed = 0
foreach ($pr in $closedStale) {
  $prLabels = @($pr.labels | ForEach-Object { $_.name })
  $remove = @($staleClosedLabels | Where-Object { $prLabels -contains $_ })
  if ($remove.Count -eq 0) { continue }
  Set-Labels -IssueNumber ([int]$pr.number) -Remove $remove
  Write-Host "Cleared stale workflow labels from closed PR #$($pr.number): $($remove -join ', ')"
  $cleanedClosed++
}

$prs = @(Invoke-GhJson @(
  'pr', 'list',
  '--repo', $Repository,
  '--state', 'open',
  '--json', 'number,title,body,headRefName,isDraft,url,labels,mergeStateStatus',
  '--limit', '100'
))

$synced = 0
$skipped = 0
$closed = 0
foreach ($pr in ($prs | Sort-Object number)) {
  if ([bool]$pr.isDraft) {
    $skipped++
    continue
  }

  $issueNumber = Get-IssueNumberFromText -Text "$($pr.title)`n$($pr.body)`n$($pr.headRefName)"
  if ($issueNumber -le 0) {
    Write-Host "PR #$($pr.number): no linked issue found in title/body/branch  -  skipping." -ForegroundColor Yellow
    $skipped++
    continue
  }

  $issue = Invoke-GhJson @(
    'issue', 'view', "$issueNumber",
    '--repo', $Repository,
    '--json', 'number,state,labels'
  )
  if ([string]$issue.state -ne 'OPEN') {
    $body = "Workflow update: linked issue #$issueNumber is closed but this PR is still open. Closing as stale  -  reopen if work should continue under a new issue."
    & $Gh pr comment $pr.number --repo $Repository --body $body | Out-Null
    & $Gh pr close $pr.number --repo $Repository | Out-Null
    Write-Host "Closed PR #$($pr.number): linked issue #$issueNumber is closed." -ForegroundColor Yellow
    $closed++
    continue
  }

  $labels = @($issue.labels | ForEach-Object { $_.name })
  $prLabels = @($pr.labels | ForEach-Object { $_.name })
  $prIsClean = [string]$pr.mergeStateStatus -eq 'CLEAN'

  # ai:needs-roast on the issue while an open PR exists.
  # Two sub-cases now (auto-promotion case removed -- see history below):
  #   1. PR is CLEAN: post-verification-failure repair state, OR a roast loop still
  #      working the issue. Either way the workflow is mid-cycle; the roast loop
  #      will mark ai:fully-roasted when ready and work-issue will pick it up for
  #      a repair commit. Do NOT auto-promote to ai:needs-verify -- the previous
  #      auto-promote was unsafe because it bypassed the repair step entirely,
  #      sending the same un-extended PR back to pr-verify, which failed it on
  #      the same ACs, which sent it back to roast, looping forever (see #50/#250).
  #   2. PR is DIRTY (conflicts): strip verify labels and let roast proceed.
  if ($labels -contains 'ai:needs-roast') {
    if ($prIsClean) {
      Write-Host "Issue #$issueNumber has ai:needs-roast with CLEAN PR #$($pr.number)  -  repair/roast cycle in progress, leaving for the roast and work-issue loops." -ForegroundColor DarkGray
      $skipped++
    } else {
      $issueChanged = $false
      $issueRemove = @('ai:fully-roasted','ai:implemented','ai:needs-verify','ai:pr-open','ai:claimed') | Where-Object { $labels -contains $_ }
      if ($issueRemove.Count -gt 0) { Set-Labels -IssueNumber $issueNumber -Remove $issueRemove; $issueChanged = $true }
      $prChanged = $false
      $prRemove = @('ai:fully-roasted','ai:claimed','ai:implemented','ai:needs-verify','ai:pr-open') | Where-Object { $prLabels -contains $_ }
      if ($prRemove.Count -gt 0) { Set-Labels -IssueNumber ([int]$pr.number) -Remove $prRemove; $prChanged = $true }
      if ($issueChanged -or $prChanged) {
        Write-Host "Cleared verify labels from issue #$issueNumber / PR #$($pr.number); PR has conflicts and issue needs roast."
        $synced++
      } else { $skipped++ }
    }
    continue
  }

  $hasAnyBlock = ($labels -contains 'ai:blocked') -or ($labels -contains 'ai:infra-blocked') -or ($labels -contains 'ai:needs-user-answer')
  if ($hasAnyBlock) {
    $hasHardBlock = ($labels -contains 'ai:infra-blocked') -or ($labels -contains 'ai:needs-user-answer')
    if ($prIsClean -and ($labels -contains 'ai:blocked') -and !$hasHardBlock) {
      $lock = Enter-WorkflowIssueClaim -IssueNumber $issueNumber -TimeoutSeconds 20
      try {
        $fresh = Invoke-GhJson @('issue', 'view', "$issueNumber", '--repo', $Repository, '--json', 'labels')
        $freshLabels = @($fresh.labels | ForEach-Object { $_.name })
        if ($freshLabels -contains 'ai:blocked') {
          Write-Host "Issue #$issueNumber has ai:blocked but PR #$($pr.number) is CLEAN  -  likely a resolved merge conflict, auto-resolving." -ForegroundColor Cyan
          Set-Labels -IssueNumber $issueNumber -Add @('ai:implemented','ai:needs-verify','ai:pr-open') -Remove @('ai:blocked','ai:claimed')
          Set-Labels -IssueNumber ([int]$pr.number) -Add @('ai:needs-verify','ai:pr-open') -Remove @('ai:blocked','ai:claimed')
          if (!$NoComment) {
            $msg = "Workflow update: PR #$($pr.number) is now CLEAN so ai:blocked was auto-resolved. Promoted to ai:needs-verify."
            & $Gh issue comment $issueNumber --repo $Repository --body $msg | Out-Null
          }
          $synced++
        } else {
          Write-Host "Issue #$issueNumber ai:blocked already cleared before lock  -  skipping." -ForegroundColor DarkGray
          $skipped++
        }
      } finally {
        Exit-WorkflowIssueClaim -Lock $lock
      }
    } else {
      $prChanged = $false
      $blockedMirrorAdds = @('ai:blocked','ai:infra-blocked','ai:needs-user-answer','priority:urgent','ai:blocks-release','short-term','long-term') | Where-Object { ($labels -contains $_) -and ($prLabels -notcontains $_) }
      $blockedPrRemoves = @('ai:needs-verify','ai:pr-open','ai:implemented') | Where-Object { $prLabels -contains $_ }
      if ($blockedMirrorAdds.Count -gt 0 -or $blockedPrRemoves.Count -gt 0) {
        Set-Labels -IssueNumber ([int]$pr.number) -Add $blockedMirrorAdds -Remove $blockedPrRemoves
        $prChanged = $true
      }
      if ($blockedMirrorAdds.Count -gt 0 -or $prChanged) {
        Write-Host "Mirrored blocked/waiting labels from issue #$issueNumber to PR #$($pr.number)."
        $synced++
      } else { $skipped++ }
    }
    continue
  }

  if (($labels -contains 'ai:fully-roasted') -and
      ($labels -notcontains 'ai:implemented') -and
      ($labels -notcontains 'ai:needs-verify') -and
      ($labels -notcontains 'ai:pr-open')) {
    $prChanged = $false
    $prRemove = @('ai:claimed', 'ai:implemented', 'ai:needs-verify', 'ai:pr-open') | Where-Object { $prLabels -contains $_ }
    if ($prRemove.Count -gt 0) {
      Set-Labels -IssueNumber ([int]$pr.number) -Remove $prRemove
      $prChanged = $true
    }
    if ($prChanged) {
      Write-Host "Cleared stale PR verification labels from PR #$($pr.number); issue #$issueNumber is back in implementation-ready state."
      $synced++
    } else {
      $skipped++
    }
    continue
  }

  $lock = Enter-WorkflowIssueClaim -IssueNumber $issueNumber -TimeoutSeconds 20
  try {
    $fresh = Invoke-GhJson @('issue', 'view', "$issueNumber", '--repo', $Repository, '--json', 'labels')
    $freshLabels = @($fresh.labels | ForEach-Object { $_.name })

    $issueChanged = $false
    if (!(($freshLabels -contains 'ai:needs-verify') -and ($freshLabels -contains 'ai:pr-open'))) {
      $issueAdd = @('ai:implemented', 'ai:needs-verify', 'ai:pr-open') | Where-Object { $freshLabels -notcontains $_ }
      $issueRemove = @('ai:fully-roasted', 'ai:claimed') | Where-Object { $freshLabels -contains $_ }
      if ($issueAdd.Count -gt 0 -or $issueRemove.Count -gt 0) {
        Set-Labels -IssueNumber $issueNumber -Add $issueAdd -Remove $issueRemove
        $issueChanged = $true
      }
    }

    $prChanged = $false
    $prAdd = @('ai:needs-verify', 'ai:pr-open') | Where-Object { $prLabels -notcontains $_ }
    $prAdd += @('priority:urgent', 'ai:blocks-release', 'short-term', 'long-term') | Where-Object { ($freshLabels -contains $_) -and ($prLabels -notcontains $_) }
    $prRemove = @('ai:fully-roasted', 'ai:claimed') | Where-Object { $prLabels -contains $_ }
    if ($prAdd.Count -gt 0 -or $prRemove.Count -gt 0) {
      Set-Labels -IssueNumber ([int]$pr.number) -Add $prAdd -Remove $prRemove
      $prChanged = $true
    }

    if (!$issueChanged -and !$prChanged) {
      $skipped++
    } else {
      if (!$NoComment -and $issueChanged) {
        $body = "Workflow update: Open PR #$($pr.number) is linked to this issue, so labels were synchronized for PR verification (``ai:implemented``, ``ai:needs-verify``, ``ai:pr-open``)."
        & $Gh issue comment $issueNumber --repo $Repository --body $body | Out-Null
      }
      Write-Host "Synced issue #$issueNumber / PR #$($pr.number)."
      $synced++
    }
  } finally {
    Exit-WorkflowIssueClaim -Lock $lock
  }
}

Write-Host "PR/issue state sync complete. Synced: $synced. Closed stale: $closed. Skipped: $skipped. Closed-PR labels cleared: $cleanedClosed."
