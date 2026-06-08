param(
  [switch]$Apply,
  [switch]$Overwrite,
  [ValidateSet('open', 'closed', 'all')]
  [string]$State = 'all',
  [string]$Repository = 'radialmonster/bigbsky-dev'
)

$ErrorActionPreference = 'Stop'
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }

function Invoke-GhJson {
  param([string[]]$CliArgs)
  $raw = & $Gh @CliArgs
  if ($LASTEXITCODE -ne 0) { throw "gh failed: $($CliArgs -join ' ')" }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

function Get-RepositoryParts {
  $parts = $Repository -split '/', 2
  if ($parts.Length -ne 2) { throw "Repository must be owner/name: $Repository" }
  return [pscustomobject]@{ Owner = $parts[0]; Name = $parts[1] }
}

function Get-Issues {
  $repo = Get-RepositoryParts
  $raw = & $Gh api "repos/$($repo.Owner)/$($repo.Name)/issues?state=$State&per_page=100"
  if ($LASTEXITCODE -ne 0) { throw 'Failed to list repository issues.' }
  $all = $raw | ConvertFrom-Json
  $all | Where-Object {
    $properties = @($_.PSObject.Properties.Name)
    -not ($properties -contains 'pull_request')
  }
}

function Get-IssueText {
  param([object]$Issue)
  $labelText = ($Issue.labels | ForEach-Object { $_.name }) -join ' '
  return "$($Issue.title)`n$($Issue.body)`n$labelText"
}

function Resolve-IssueType {
  param([object]$Issue)
  $title = [string]$Issue.title
  $text = Get-IssueText -Issue $Issue

  if ($title -match '(?i)\b(define|spec|docs?|adr|decision|planning|workflow|automation|refactor|cleanup|chore|test|coverage|migration|investigate|research|api access)\b') {
    return 'Task'
  }
  if ($title -match '(?i)\b(bug|fix|patch|regression|broken|fails?|error|exception|not working|incorrect|failed verification|incomplete acceptance)\b') {
    return 'Bug'
  }
  if ($title -match '(?i)\b(add|allow|build|create|enable|expand|implement|introduce|new|support|configure|custom|manage)\b') {
    return 'Feature'
  }
  if ($text -match '(?i)\b(failed verification|incomplete acceptance)\b') { return 'Bug' }
  if ($text -match '(?i)\b(spec|docs?|adr|decision|planning|workflow|automation|refactor|cleanup|chore|test|coverage|migration|investigate|research|api access)\b') { return 'Task' }
  return 'Task'
}

function Set-GitHubIssueType {
  param(
    [int]$IssueNumber,
    [ValidateSet('Bug', 'Feature', 'Task')]
    [string]$Type
  )
  $repo = Get-RepositoryParts
  & $Gh api `
    --method PATCH `
    --header 'Accept: application/vnd.github+json' `
    --header 'X-GitHub-Api-Version: 2026-03-10' `
    "repos/$($repo.Owner)/$($repo.Name)/issues/$IssueNumber" `
    -f "type=$Type" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to set issue #$IssueNumber type to $Type."
  }
}

$issues = @(Get-Issues | Sort-Object number)
Write-Host "Issues considered: $($issues.Count)"
$changes = New-Object System.Collections.Generic.List[object]

foreach ($issue in $issues) {
  $currentType = if ($issue.type) { [string]$issue.type.name } else { '' }
  $inferredType = Resolve-IssueType -Issue $issue
  $shouldSet = $Overwrite -or [string]::IsNullOrWhiteSpace($currentType)
  $changes.Add([pscustomobject]@{
    Number = [int]$issue.number
    Title = [string]$issue.title
    CurrentType = $currentType
    InferredType = $inferredType
    Action = if ($shouldSet) { 'set' } else { 'skip' }
  })
}

$changes | Format-Table Number, CurrentType, InferredType, Action, Title -AutoSize

if (!$Apply) {
  Write-Host 'Dry run only. Re-run with -Apply to update issues without a type, or -Apply -Overwrite to reset existing types too.'
  exit 0
}

foreach ($change in $changes | Where-Object { $_.Action -eq 'set' }) {
  Set-GitHubIssueType -IssueNumber $change.Number -Type $change.InferredType
  Write-Host "Set issue #$($change.Number) type to $($change.InferredType)."
}
