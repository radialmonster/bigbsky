param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('export-plan', 'issue-roast', 'discussion-triage', 'discussion-promote', 'pr-verify', 'commit-roast', 'changelog-fragments')]
  [string]$Mode
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')

switch ($Mode) {
  'export-plan' {
    & (Join-Path $PSScriptRoot 'sync-planning.ps1')
  }
  'issue-roast' {
    & (Join-Path $PSScriptRoot 'issue-roast.ps1') -Mode Prepare
  }
  'discussion-triage' {
    Write-Host 'Discussion triage mode: ask focused questions, mark ready-to-promote, or split broad ideas.'
    Write-Host 'Prompt: prompts/github/discussion-triage.txt'
  }
  'discussion-promote' {
    & (Join-Path $PSScriptRoot 'promote-discussion.ps1')
  }
  'pr-verify' {
    & (Join-Path $PSScriptRoot 'pr-verify.ps1') -Mode Prepare
  }
  'commit-roast' {
    Write-Host 'Commit roast mode: review merged PRs/commits against linked issues and create follow-up issues or reopen originals.'
    Write-Host 'Prompt: prompts/github/commit-roast.txt'
  }
  'changelog-fragments' {
    $dir = Join-Path $Root 'changelog\unreleased'
    Write-Host "Changelog fragment mode: compile or review fragments in $dir."
    Write-Host 'Prompt: prompts/github/changelog-fragments.txt'
  }
}
