param(
  [switch]$Apply,
  [int]$DiscussionNumber = 0,
  [string]$Repository = 'radialmonster/bigbsky-dev',
  [string]$ReadyLabel = 'ai:ready-to-promote',
  [string]$PromotedLabel = 'ai:promoted',
  [string]$IssueLabel = 'ai:needs-roast',
  [ValidateSet('Auto', 'Bug', 'Feature', 'Task')]
  [string]$IssueType = 'Auto'
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$OutDir = Join-Path $Root 'out\discussion-promotion'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }

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

function Get-RepositoryParts {
  $parts = $Repository -split '/', 2
  if ($parts.Length -ne 2) { throw "Repository must be owner/name: $Repository" }
  return [pscustomobject]@{ Owner = $parts[0]; Name = $parts[1] }
}

function Get-IssueNumberFromUrl {
  param([string]$Url)
  if ($Url -match '/issues/(?<number>\d+)(?:$|[?#])') {
    return [int]$Matches.number
  }
  throw "Could not parse issue number from issue URL: $Url"
}

function Get-NativeCreateIssueUrl {
  param([int]$DiscussionNumber)
  $repo = Get-RepositoryParts
  return "https://github.com/$($repo.Owner)/$($repo.Name)/issues/new?created_from_discussion_number=$DiscussionNumber"
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

function Resolve-IssueType {
  param([object]$Discussion)
  if ($IssueType -ne 'Auto') { return $IssueType }

  $commentText = ($Discussion.comments.nodes | ForEach-Object { $_.body }) -join "`n"
  $text = "$($Discussion.title)`n$($Discussion.body)`n$commentText"
  if ($text -match '(?i)\b(bug|regression|broken|fails?|error|exception|not working|incorrect|wrong|fix)\b') {
    return 'Bug'
  }
  if ($text -match '(?i)\b(spec|docs?|adr|decision|planning|workflow|automation|refactor|cleanup|chore|test|coverage|migration|investigate|research|api access)\b') {
    return 'Task'
  }
  return 'Feature'
}

function Get-RepoContext {
  $repo = Get-RepositoryParts
  $query = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id labels(first:100){nodes{id name}} discussions(first:100){nodes{id number title url body closed labels(first:20){nodes{name}} comments(first:50){nodes{author{login} createdAt body}}}}}}'
  $result = Invoke-GhJson @(
    'api', 'graphql',
    '-f', "query=$query",
    '-F', "owner=$($repo.Owner)",
    '-F', "name=$($repo.Name)"
  )
  return $result.data.repository
}

function Get-DiscussionByNumber {
  param([int]$Number)
  $repo = Get-RepositoryParts
  $query = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){id labels(first:100){nodes{id name}} discussion(number:$number){id number title url body closed labels(first:20){nodes{name}} comments(first:50){nodes{author{login} createdAt body}}}}}'
  $result = Invoke-GhJson @(
    'api', 'graphql',
    '-f', "query=$query",
    '-F', "owner=$($repo.Owner)",
    '-F', "name=$($repo.Name)",
    '-F', "number=$Number"
  )
  return [pscustomobject]@{
    Labels = $result.data.repository.labels
    Discussion = $result.data.repository.discussion
  }
}

function Get-NextDiscussion {
  $context = Get-RepoContext
  $urgentPendingTriage = @($context.discussions.nodes |
    Where-Object {
      $names = @($_.labels.nodes | ForEach-Object { $_.name })
      !$_.closed -and
      ($names -contains 'priority:urgent') -and
      -not ($names -contains $ReadyLabel) -and
      -not ($names -contains $PromotedLabel) -and
      -not ($names -contains 'ai:claimed') -and
      -not ($names -contains 'ai:blocked') -and
      -not ($names -contains 'ai:needs-user-answer')
    } |
    Sort-Object number)
  if ($urgentPendingTriage.Count -gt 0) {
    $first = $urgentPendingTriage | Select-Object -First 1
    throw "Urgent discussion #$($first.number) is not ready to promote yet. Run discussion triage before promoting non-urgent discussions."
  }

  $candidate = $context.discussions.nodes |
    Where-Object {
      $names = @($_.labels.nodes | ForEach-Object { $_.name })
      !$_.closed -and
      ($names -contains $ReadyLabel) -and
      -not ($names -contains $PromotedLabel) -and
      -not ($names -contains 'ai:claimed')
    } |
    Sort-Object `
      @{ Expression = {
        $names = @($_.labels.nodes | ForEach-Object { $_.name })
        if ($names -contains 'priority:urgent') { 0 } else { 1 }
      } },
      @{ Expression = {
        $names = @($_.labels.nodes | ForEach-Object { $_.name })
        if ($names -contains 'short-term') { 0 }
        elseif ($names -contains 'long-term') { 2 }
        else { 1 }
      } },
      @{ Expression = { $_.number } } |
    Select-Object -First 1
  if (!$candidate) { throw "No discussion labeled $ReadyLabel is available for promotion." }
  return [pscustomobject]@{
    Labels = $context.labels
    Discussion = $candidate
  }
}

function Get-DiscussionPlanningLabel {
  param([object]$Discussion)
  $names = @($Discussion.labels.nodes | ForEach-Object { $_.name })
  foreach ($name in @('short-term', 'long-term')) {
    if ($names -contains $name) { return $name }
  }
  return ''
}

function Add-Labels {
  param([string]$LabelableId, [string[]]$Names, [object]$RepoLabels)
  $ids = @()
  foreach ($name in $Names) {
    $label = @($RepoLabels.nodes | Where-Object { $_.name -eq $name } | Select-Object -First 1)
    if ($label.Count -gt 0) { $ids += [string]$label[0].id }
  }
  if ($ids.Count -eq 0) { return }
  $mutation = 'mutation($id:ID!,$labels:[ID!]!){addLabelsToLabelable(input:{labelableId:$id,labelIds:$labels}){clientMutationId}}'
  $args = @('api', 'graphql', '-f', "query=$mutation", '-F', "id=$LabelableId")
  foreach ($id in $ids) { $args += @('-F', "labels[]=$id") }
  Invoke-GhJson $args | Out-Null
}

function Remove-Labels {
  param([string]$LabelableId, [string[]]$Names, [object]$RepoLabels)
  $ids = @()
  foreach ($name in $Names) {
    $label = @($RepoLabels.nodes | Where-Object { $_.name -eq $name } | Select-Object -First 1)
    if ($label.Count -gt 0) { $ids += [string]$label[0].id }
  }
  if ($ids.Count -eq 0) { return }
  $mutation = 'mutation($id:ID!,$labels:[ID!]!){removeLabelsFromLabelable(input:{labelableId:$id,labelIds:$labels}){clientMutationId}}'
  $args = @('api', 'graphql', '-f', "query=$mutation", '-F', "id=$LabelableId")
  foreach ($id in $ids) { $args += @('-F', "labels[]=$id") }
  Invoke-GhJson $args | Out-Null
}

function Add-DiscussionComment {
  param([string]$DiscussionId, [string]$Body)
  $mutation = 'mutation($id:ID!,$body:String!){addDiscussionComment(input:{discussionId:$id,body:$body}){comment{id}}}'
  Invoke-GhJson @(
    'api', 'graphql',
    '-f', "query=$mutation",
    '-F', "id=$DiscussionId",
    '-F', "body=$Body"
  ) | Out-Null
}

function Close-Discussion {
  param([string]$DiscussionId)
  $mutation = 'mutation($id:ID!){closeDiscussion(input:{discussionId:$id,reason:RESOLVED}){discussion{id closed}}}'
  Invoke-GhJson @(
    'api', 'graphql',
    '-f', "query=$mutation",
    '-F', "id=$DiscussionId"
  ) | Out-Null
}

function Normalize-DiscussionBodyForIssue {
  param([string]$Body)
  $clean = [string]$Body
  $clean = $clean -replace '(?s)^Imported pilot discussion from \$\(@\{.*?\}\.Source\)\.\s*', ''
  $clean = $clean -replace '\^Gi:', 'ai:'
  return $clean.Trim()
}

function New-IssueBody {
  param([object]$Discussion)
  $commentText = ($Discussion.comments.nodes | ForEach-Object {
    "### Comment by $($_.author.login) at $($_.createdAt)`n`n$($_.body)"
  }) -join "`n`n"
  $discussionBody = Normalize-DiscussionBodyForIssue -Body ([string]$Discussion.body)
  return @"
Promoted from GitHub Discussion #$($Discussion.number)

## Discussion Body

$discussionBody

## Discussion Comments

$commentText

## Initial Workflow State

Needs issue roast before implementation.
"@
}

$selection = if ($DiscussionNumber -gt 0) {
  Get-DiscussionByNumber -Number $DiscussionNumber
} elseif (![string]::IsNullOrWhiteSpace($env:BIGBSKY_TARGET_DISCUSSION) -and $env:BIGBSKY_TARGET_DISCUSSION -match '^\d+$') {
  $DiscussionNumber = [int]$env:BIGBSKY_TARGET_DISCUSSION
  Write-Host ("Fast-track: using target discussion #$DiscussionNumber from BIGBSKY_TARGET_DISCUSSION environment variable.") -ForegroundColor Cyan
  Get-DiscussionByNumber -Number $DiscussionNumber
} else {
  Get-NextDiscussion
}

$discussion = $selection.Discussion
if (!$discussion) { throw "Discussion not found: #$DiscussionNumber" }

$planningLabel = Get-DiscussionPlanningLabel -Discussion $discussion
$discussionLabelNames = @($discussion.labels.nodes | ForEach-Object { $_.name })
$issueLabels = @($IssueLabel)
if (![string]::IsNullOrWhiteSpace($planningLabel)) { $issueLabels += $planningLabel }
if ($discussionLabelNames -contains 'priority:urgent') { $issueLabels += 'priority:urgent' }
$resolvedIssueType = Resolve-IssueType -Discussion $discussion
$issueBody = New-IssueBody -Discussion $discussion
$bodyPath = Join-Path $OutDir ("discussion-{0}-issue.md" -f $discussion.number)
Write-Utf8NoBom -Path $bodyPath -Content $issueBody

Write-Host "Promotion candidate:"
Write-Host "  Discussion #$($discussion.number): $($discussion.title)"
Write-Host "  Issue labels: $($issueLabels -join ', ')"
Write-Host "  Issue type: $resolvedIssueType"
Write-Host "  Body file: $bodyPath"
Write-Host "  Native GitHub create-from-discussion URL: $(Get-NativeCreateIssueUrl -DiscussionNumber $discussion.number)"

if (!$Apply) {
  Write-Host 'Dry run only. Re-run with -Apply to create the issue through automation, or open the native GitHub URL above for browser-based conversion.'
  exit 0
}

$existingIssues = Invoke-GhJson @(
  'issue', 'list',
  '--repo', $Repository,
  '--state', 'all',
  '--json', 'number,title,url',
  '--limit', '200'
)
$duplicate = @($existingIssues | Where-Object { $_.title -eq $discussion.title } | Select-Object -First 1)
if ($duplicate.Count -gt 0) {
  $issueUrl = $duplicate[0].url
  Write-Host "Issue already exists: $issueUrl"
} else {
  $labelsArg = $issueLabels -join ','
  $created = & $Gh issue create --repo $Repository --title $discussion.title --body-file $bodyPath --label $labelsArg
  if ($LASTEXITCODE -ne 0) { throw "gh issue create failed for discussion #$($discussion.number)" }
  $issueUrl = [string]$created
  Set-GitHubIssueType -IssueNumber (Get-IssueNumberFromUrl -Url $issueUrl) -Type $resolvedIssueType
  Write-Host "Created issue: $issueUrl"
}

Add-Labels -LabelableId $discussion.id -Names @($PromotedLabel) -RepoLabels $selection.Labels
Remove-Labels -LabelableId $discussion.id -Names @($ReadyLabel, 'ai:claimed', 'ai:needs-roast', 'ai:fully-roasted') -RepoLabels $selection.Labels
Add-DiscussionComment -DiscussionId $discussion.id -Body "Workflow update: promoted to issue $issueUrl for issue roast and implementation planning."
Close-Discussion -DiscussionId $discussion.id
Write-Host "Marked discussion #$($discussion.number) as promoted and closed."
