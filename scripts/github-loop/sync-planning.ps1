param(
  [switch]$Apply,
  [ValidateSet('All', 'Issues', 'Discussions')]
  [string]$Target = 'All',
  [string]$ShortTermLabel = 'short-term',
  [string]$LongTermLabel = 'long-term',
  [ValidateSet('Auto', 'Bug', 'Feature', 'Task')]
  [string]$IssueType = 'Auto',
  [string]$Repository = 'radialmonster/bigbsky-dev'
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$OutDir = Join-Path $Root 'out'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }

function Read-TextFile {
  param([string]$Path)
  if (!(Test-Path $Path)) { return @() }
  return Get-Content -LiteralPath $Path -Encoding UTF8
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Get-ActiveTodoItems {
  param([string]$Path)
  $lines = Read-TextFile $Path
  $items = New-Object System.Collections.Generic.List[object]
  $current = $null
  $body = New-Object System.Collections.Generic.List[string]

  foreach ($line in $lines) {
    if ($line -match '^###\s+(?<number>\d+)\.\s+\[ \]\s+\[(?<meta>[^\]]+)\]\s+(?<title>.+)$') {
      if ($null -ne $current) {
        $current.Body = ($body -join "`n").Trim()
        $items.Add($current)
      }
      $body = New-Object System.Collections.Generic.List[string]
      $parts = $Matches.meta -split '/', 2
      $current = [pscustomobject]@{
        Source = 'todo.md'
        Target = 'issue'
        Number = [int]$Matches.number
        Title = $Matches.title.Trim()
        Kind = if ($parts.Length -gt 0) { $parts[0].Trim() } else { '' }
        Priority = if ($parts.Length -gt 1) { $parts[1].Trim() } else { '' }
        Labels = @('ai:needs-roast')
        Body = ''
      }
      continue
    }

    if ($null -ne $current) {
      $body.Add($line)
    }
  }

  if ($null -ne $current) {
    $current.Body = ($body -join "`n").Trim()
    $items.Add($current)
  }

  return $items
}

function Get-IdeaItems {
  param(
    [string]$Path,
    [string]$Source,
    [string]$Label
  )

  $lines = Read-TextFile $Path
  $items = New-Object System.Collections.Generic.List[object]
  $current = $null
  $body = New-Object System.Collections.Generic.List[string]
  $inInbox = $false

  foreach ($line in $lines) {
    if ($line -match '^##\s+Inbox\s*$') {
      $inInbox = $true
      continue
    }
    if ($inInbox -and $line -match '^##\s+') {
      break
    }
    if (!$inInbox) {
      continue
    }
    if ($line -match '^###\s+(?<title>.+)$') {
      $title = $Matches.title.Trim()
      if ($title -eq 'Idea title') {
        continue
      }
      if ($null -ne $current) {
        $current.Body = ($body -join "`n").Trim()
        $items.Add($current)
      }
      $body = New-Object System.Collections.Generic.List[string]
      $current = [pscustomobject]@{
        Source = $Source
        Target = 'discussion'
        Number = $null
        Title = $title
        Kind = 'idea'
        Priority = ''
        Labels = @($Label, 'ai:needs-triage')
        Body = ''
      }
      continue
    }
    if ($null -ne $current) {
      $body.Add($line)
    }
  }

  if ($null -ne $current) {
    $current.Body = ($body -join "`n").Trim()
    $items.Add($current)
  }

  return $items
}

function Write-MarkdownPlan {
  param([object[]]$Items, [string]$Path)
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add('# GitHub Sync Plan')
  $lines.Add('')
  $lines.Add("Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
  $lines.Add('')
  $lines.Add("Total items: $($Items.Count)")
  $lines.Add('')

  foreach ($group in $Items | Group-Object Target) {
    $lines.Add("## $($group.Name)")
    $lines.Add('')
    foreach ($item in $group.Group) {
      $labelText = ($item.Labels -join ', ')
      $prefix = if ($item.Number) { "#$($item.Number) " } else { '' }
      $lines.Add("- $prefix$($item.Title) ($($item.Source), labels: $labelText)")
    }
    $lines.Add('')
  }

  Set-Content -LiteralPath $Path -Encoding UTF8 -Value $lines
}

function Invoke-GhJson {
  param([string[]]$CliArgs)
  $raw = & $Gh @CliArgs
  if ($LASTEXITCODE -ne 0) { throw "gh failed: $($CliArgs -join ' ')" }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

function Get-RepositoryInfo {
  $parts = $Repository -split '/', 2
  if ($parts.Length -ne 2) { throw "Repository must be owner/name: $Repository" }
  return [pscustomobject]@{
    Owner = $parts[0]
    Name = $parts[1]
  }
}

function Resolve-IssueType {
  param([object]$Item)
  if ($IssueType -ne 'Auto') { return $IssueType }

  $text = "$($Item.Kind)`n$($Item.Title)`n$($Item.Body)"
  if ($text -match '(?i)\b(bug|regression|broken|fails?|error|exception|not working|incorrect|wrong|fix)\b') {
    return 'Bug'
  }
  if ($text -match '(?i)\b(spec|docs?|adr|decision|planning|workflow|automation|refactor|cleanup|chore|test|coverage|migration|investigate|research)\b') {
    return 'Task'
  }
  if ($text -match '(?i)\b(add|allow|build|create|enable|expand|implement|introduce|new|support|configure|custom|manage)\b') {
    return 'Feature'
  }
  return 'Task'
}

function Set-GitHubIssueType {
  param(
    [int]$IssueNumber,
    [ValidateSet('Bug', 'Feature', 'Task')]
    [string]$Type
  )
  $repoInfo = Get-RepositoryInfo
  & $Gh api `
    --method PATCH `
    --header 'Accept: application/vnd.github+json' `
    --header 'X-GitHub-Api-Version: 2026-03-10' `
    "repos/$($repoInfo.Owner)/$($repoInfo.Name)/issues/$IssueNumber" `
    -f "type=$Type" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to set issue #$IssueNumber type to $Type."
  }
}

function Get-GitHubDiscussionContext {
  $repoInfo = Get-RepositoryInfo
  $query = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id labels(first:100){nodes{id name}} discussionCategories(first:50){nodes{id name slug}} discussions(first:100){nodes{id number title closed labels(first:20){nodes{name}}}}}}'
  $result = Invoke-GhJson @(
    'api', 'graphql',
    '-f', "query=$query",
    '-F', "owner=$($repoInfo.Owner)",
    '-F', "name=$($repoInfo.Name)"
  )
  return $result.data.repository
}

function Add-GitHubLabels {
  param(
    [string]$LabelableId,
    [string[]]$LabelNames,
    [object]$Context
  )
  $labelIds = @()
  foreach ($name in $LabelNames) {
    $label = @($Context.labels.nodes | Where-Object { $_.name -eq $name } | Select-Object -First 1)
    if ($label.Count -gt 0) { $labelIds += [string]$label[0].id }
  }
  if ($labelIds.Count -eq 0) { return }
  $mutation = 'mutation($id:ID!,$labels:[ID!]!){addLabelsToLabelable(input:{labelableId:$id,labelIds:$labels}){clientMutationId}}'
  $args = @(
    'api', 'graphql',
    '-f', "query=$mutation",
    '-F', "id=$LabelableId"
  )
  foreach ($labelId in $labelIds) {
    $args += @('-F', "labels[]=$labelId")
  }
  Invoke-GhJson $args | Out-Null
}

function New-GitHubDiscussion {
  param(
    [object]$Item,
    [object]$Context
  )
  $existing = @($Context.discussions.nodes | Where-Object { $_.title -eq $Item.Title } | Select-Object -First 1)
  if ($existing.Count -gt 0) {
    $existingLabels = @($existing[0].labels.nodes | ForEach-Object { $_.name })
    if ($existing[0].closed -or ($existingLabels -contains 'ai:promoted')) {
      Write-Host "Discussion already promoted/closed; leaving labels unchanged: #$($existing[0].number) $($Item.Title)"
      return $existing[0]
    }
    Add-GitHubLabels -LabelableId $existing[0].id -LabelNames $Item.Labels -Context $Context
    Write-Host "Discussion already exists: #$($existing[0].number) $($Item.Title)"
    return $existing[0]
  }
  $category = @($Context.discussionCategories.nodes | Where-Object { $_.slug -eq 'ideas' -or $_.name -eq 'Ideas' } | Select-Object -First 1)
  if ($category.Count -eq 0) { throw 'Could not find GitHub Discussion category: Ideas' }
  $body = @"
Imported from $($Item.Source).

## Context
$($Item.Body)

## Initial Workflow State
Needs discussion triage before promotion to an issue.
"@
  $bodyFile = Join-Path $OutDir ('discussion-body-{0}.md' -f ([regex]::Replace($Item.Title, '[^A-Za-z0-9]+', '-').Trim('-')))
  Write-Utf8NoBom -Path $bodyFile -Content $body
  $mutation = 'mutation($repositoryId:ID!,$categoryId:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repositoryId,categoryId:$categoryId,title:$title,body:$body}){discussion{id number title}}}'
  $result = Invoke-GhJson @(
    'api', 'graphql',
    '-f', "query=$mutation",
    '-F', "repositoryId=$($Context.id)",
    '-F', "categoryId=$($category[0].id)",
    '-F', "title=$($Item.Title)",
    '-F', "body=@$bodyFile"
  )
  $discussion = $result.data.createDiscussion.discussion
  Add-GitHubLabels -LabelableId $discussion.id -LabelNames $Item.Labels -Context $Context
  Write-Host "Created discussion: #$($discussion.number) $($discussion.title)"
  return $discussion
}

$items = @()
$items += Get-ActiveTodoItems -Path (Join-Path $Root 'todo.md')
$items += Get-IdeaItems -Path (Join-Path $Root 'todo-shortterm.txt') -Source 'todo-shortterm.txt' -Label $ShortTermLabel
$items += Get-IdeaItems -Path (Join-Path $Root 'todo-longterm.txt') -Source 'todo-longterm.txt' -Label $LongTermLabel

if ($Target -eq 'Issues') {
  $items = @($items | Where-Object { $_.Target -eq 'issue' })
} elseif ($Target -eq 'Discussions') {
  $items = @($items | Where-Object { $_.Target -eq 'discussion' })
}

$jsonPath = Join-Path $OutDir 'github-sync-plan.json'
$mdPath = Join-Path $OutDir 'github-sync-plan.md'
$items | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
Write-MarkdownPlan -Items $items -Path $mdPath

Write-Host "Wrote dry-run plan:"
Write-Host "  $jsonPath"
Write-Host "  $mdPath"
Write-Host "Items: $($items.Count)"

if (!$Apply) {
  Write-Host 'Dry run only. Re-run with -Apply after reviewing the plan.'
  exit 0
}

if (!(Get-Command $Gh -ErrorAction SilentlyContinue)) {
  throw 'GitHub CLI (gh) is required for -Apply.'
}

$discussionContext = Get-GitHubDiscussionContext
  $existingIssues = Invoke-GhJson @(
  'issue', 'list',
  '--repo', $Repository,
  '--state', 'all',
  '--json', 'number,title,url,body',
  '--limit', '500'
)

foreach ($item in $items) {
  if ($item.Target -eq 'discussion') {
    New-GitHubDiscussion -Item $item -Context $discussionContext | Out-Null
    continue
  }

  $todoNumberPattern = "(?i)\[(?:todo)\s+#$($item.Number)\]|Imported from todo\.md item $($item.Number)\b"
  $existingIssue = @($existingIssues | Where-Object {
    $_.title -eq $item.Title -or
    $_.title -match $todoNumberPattern -or
    $_.body -match $todoNumberPattern
  } | Select-Object -First 1)
  if ($existingIssue.Count -gt 0) {
    Write-Host "Issue already exists: #$($existingIssue[0].number) $($item.Title)"
    continue
  }

  $bodyFile = Join-Path $OutDir ('issue-body-{0}.md' -f $item.Number)
  $body = @"
Imported from $($item.Source) item $($item.Number).

$($item.Body)
"@
  Set-Content -LiteralPath $bodyFile -Encoding UTF8 -Value $body
  $labels = ($item.Labels -join ',')
  Write-Host "Creating issue: $($item.Title)"
  $created = & $Gh issue create --repo $Repository --title $item.Title --body-file $bodyFile --label $labels
  if ($LASTEXITCODE -ne 0) { throw "Failed to create issue: $($item.Title)" }
  if ($created -match '/issues/(?<number>\d+)(?:$|[?#])') {
    Set-GitHubIssueType -IssueNumber ([int]$Matches.number) -Type (Resolve-IssueType -Item $item)
  }
}
