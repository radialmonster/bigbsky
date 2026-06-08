param(
  [ValidateSet('Prepare', 'Verify', 'CreateFollowUp')]
  [string]$Mode = 'Prepare',
  [string]$FragmentPath = '',
  [string]$Repository = 'radialmonster/bigbsky-dev',
  [string]$Title = '',
  [string]$BodyFile = '',
  [ValidateSet('Auto', 'Bug', 'Feature', 'Task')]
  [string]$IssueType = 'Auto'
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$FragmentRoot = Join-Path $Root 'changelog\unreleased'
$OutRoot = Join-Path $Root 'out\changelog-fragment'
New-Item -ItemType Directory -Force -Path $OutRoot | Out-Null
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

function Get-FragmentMetadata {
  param([string]$Content)
  $metadata = [ordered]@{
    issue = $null
    status = 'needs-roast'
  }
  if ($Content -match '(?s)<!--\s*bigbsky:changelog\s+(?<json>\{.*?\})\s*-->') {
    try {
      $parsed = $Matches.json | ConvertFrom-Json
      if ($null -ne $parsed.issue) { $metadata.issue = [int]$parsed.issue }
      if ($null -ne $parsed.status) { $metadata.status = [string]$parsed.status }
    } catch {}
  }
  return [pscustomobject]$metadata
}

function Get-NextFragment {
  $files = @(Get-ChildItem -Path $FragmentRoot -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' })
  foreach ($file in $files | Sort-Object LastWriteTime, Name) {
    $content = Get-Content -LiteralPath $file.FullName -Encoding UTF8 -Raw
    $metadata = Get-FragmentMetadata -Content $content
    if ($metadata.status -ne 'ready' -or $content -notmatch '(?ms)^##\s+Public(?: Release)? Notes\s*\r?\n') { return $file.FullName }
  }
  throw 'No changelog fragment needs roast.'
}

function New-RoastPrompt {
  param(
    [string]$Path,
    [string]$Content,
    [object]$Metadata
  )
  $rules = Get-Content -LiteralPath (Join-Path $Root 'prompts\github\changelog-fragments.txt') -Encoding UTF8 -Raw
  return @"
$rules

# Selected Fragment

Path: $Path
Issue: $($Metadata.issue)
Status: $($Metadata.status)

# Current Content

~~~md
$Content
~~~

# Task

Review this fragment against the linked issue/commit context if available. Edit the fragment directly.

If it is release-note ready, ensure the hidden metadata status is `ready`.
If it still needs another pass, keep status `needs-roast` and make the missing work explicit.
"@
}

function Prepare-Fragment {
  if (!$FragmentPath -and ![string]::IsNullOrWhiteSpace($env:BIGBSKY_CHANGELOG_FRAGMENT_PATH)) {
    $script:FragmentPath = $env:BIGBSKY_CHANGELOG_FRAGMENT_PATH
  }
  if (!$FragmentPath) { $script:FragmentPath = Get-NextFragment }
  $resolved = Resolve-Path $FragmentPath
  $content = Get-Content -LiteralPath $resolved -Encoding UTF8 -Raw
  $metadata = Get-FragmentMetadata -Content $content
  $outPath = Join-Path $OutRoot 'prompt.md'
  Write-Utf8NoBom -Path $outPath -Content (New-RoastPrompt -Path $resolved -Content $content -Metadata $metadata)
  Write-Host 'Prepared changelog fragment roast:'
  Write-Host "  Fragment: $resolved"
  Write-Host "  Prompt:   $outPath"
}

function Verify-Fragment {
  if (!$FragmentPath) {
    $promptPath = Join-Path $OutRoot 'prompt.md'
    if (!(Test-Path $promptPath)) { throw 'Verify requires -FragmentPath or an existing out\changelog-fragment\prompt.md.' }
    $prompt = Get-Content -LiteralPath $promptPath -Encoding UTF8 -Raw
    if ($prompt -match 'Path:\s*(?<path>.+)') { $script:FragmentPath = $Matches.path.Trim() }
  }
  if (!$FragmentPath) { throw 'Could not determine fragment path.' }
  $resolved = Resolve-Path $FragmentPath
  $content = Get-Content -LiteralPath $resolved -Encoding UTF8 -Raw
  $metadata = Get-FragmentMetadata -Content $content
  foreach ($heading in @('Done', 'Public Notes', 'Verified', 'Files touched')) {
    if ($content -notmatch "(?m)^##?\s+$([regex]::Escape($heading))\b|\*\*$([regex]::Escape($heading)):\*\*") {
      throw "Fragment missing required section: $heading"
    }
  }
  if ($content -notmatch 'bigbsky:changelog') {
    throw 'Fragment missing bigbsky:changelog metadata.'
  }
  Write-Host 'Fragment verified:'
  Write-Host "  Path: $resolved"
  Write-Host "  Issue: $($metadata.issue)"
  Write-Host "  Status: $($metadata.status)"
}

function Get-PreparedFragmentPath {
  if ($FragmentPath) { return (Resolve-Path $FragmentPath).Path }
  $promptPath = Join-Path $OutRoot 'prompt.md'
  if (Test-Path $promptPath) {
    $prompt = Get-Content -LiteralPath $promptPath -Encoding UTF8 -Raw
    if ($prompt -match 'Path:\s*(?<path>.+)') { return (Resolve-Path $Matches.path.Trim()).Path }
  }
  throw 'CreateFollowUp requires -FragmentPath or an existing prepared prompt.'
}

function Get-RepositoryParts {
  $parts = $Repository.Split('/')
  if ($parts.Count -ne 2) { throw "Repository must be OWNER/REPO, got: $Repository" }
  return [pscustomobject]@{
    Owner = $parts[0]
    Name = $parts[1]
  }
}

function Get-IssueNumberFromUrl {
  param([string]$Url)
  if ($Url -match '/issues/(?<number>\d+)(?:$|[?#])') {
    return [int]$Matches.number
  }
  throw "Could not parse issue number from created issue URL: $Url"
}

function Get-NormalizedText {
  param([string]$Text)
  if ($null -eq $Text) { $Text = '' }
  return ($Text.ToLowerInvariant() -replace '[^a-z0-9]+', ' ').Trim()
}

function Get-KeywordSet {
  param([string]$Text)
  $stopWords = @(
    'about', 'after', 'against', 'already', 'before', 'being', 'could', 'from',
    'github', 'issue', 'issues', 'label', 'needs', 'original', 'bigbsky',
    'should', 'that', 'their', 'there', 'these', 'this', 'through', 'track',
    'when', 'where', 'with', 'workflow'
  )
  $seen = @{}
  foreach ($word in ((Get-NormalizedText -Text $Text) -split '\s+')) {
    if ($word.Length -lt 4) { continue }
    if ($stopWords -contains $word) { continue }
    $seen[$word] = $true
  }
  return @($seen.Keys)
}

function Get-KeywordOverlapCount {
  param([string[]]$Left, [string[]]$Right)
  $rightSet = @{}
  foreach ($word in $Right) { $rightSet[$word] = $true }
  $count = 0
  foreach ($word in $Left) {
    if ($rightSet.ContainsKey($word)) { $count++ }
  }
  return $count
}

function Find-OpenSimilarIssue {
  param([string]$IssueTitle, [string]$IssueBody)
  if ([string]::IsNullOrWhiteSpace($IssueTitle)) { return $null }

  $candidateIssues = @(Invoke-GhJson @(
    'issue', 'list',
    '--repo', $Repository,
    '--state', 'open',
    '--json', 'number,title,body,url',
    '--limit', '100'
  ))
  if ($candidateIssues.Count -eq 0) { return $null }

  $normalizedTitle = Get-NormalizedText -Text $IssueTitle
  $titleKeywords = @(Get-KeywordSet -Text $IssueTitle)
  $bodyKeywords = @(Get-KeywordSet -Text $IssueBody)

  foreach ($issue in ($candidateIssues | Sort-Object number)) {
    $candidateTitle = [string]$issue.title
    if ((Get-NormalizedText -Text $candidateTitle) -eq $normalizedTitle) {
      return [pscustomobject]@{ Kind = 'exact'; Issue = $issue }
    }

    $candidateTitleKeywords = @(Get-KeywordSet -Text $candidateTitle)
    $candidateBodyKeywords = @(Get-KeywordSet -Text ([string]$issue.body))
    $titleOverlap = Get-KeywordOverlapCount -Left $titleKeywords -Right $candidateTitleKeywords
    $bodyOverlap = Get-KeywordOverlapCount -Left $bodyKeywords -Right $candidateBodyKeywords
    $requiredTitleOverlap = [Math]::Min(3, [Math]::Max(1, $titleKeywords.Count))
    if ($titleKeywords.Count -ge 3 -and $titleOverlap -ge $requiredTitleOverlap -and $bodyOverlap -ge 3) {
      return [pscustomobject]@{ Kind = 'same_scope'; Issue = $issue }
    }
    if (($titleOverlap -ge 1 -and $bodyOverlap -ge 2) -or $bodyOverlap -ge 4) {
      return [pscustomobject]@{ Kind = 'related'; Issue = $issue }
    }
  }

  return $null
}

function Get-FollowUpExcerpt {
  param([string]$Body)
  if ($null -eq $Body) { return '' }
  $normalized = ($Body -replace '\r', '' -split '\n' | Where-Object {
    $line = $_.Trim()
    $line -and $line -notmatch '^(Follow-up from|Original issue:|Changelog fragment:|Refs?\s+#|Related open issue:)'
  } | Select-Object -First 6) -join "`n"
  if ($normalized.Length -gt 1200) {
    return $normalized.Substring(0, 1200).TrimEnd() + "`n..."
  }
  return $normalized
}

function Add-FollowUpFindingToIssue {
  param(
    [int]$IssueNumber,
    [int]$ParentIssueNumber,
    [string]$IssueTitle,
    [string]$IssueBody
  )
  $issue = Invoke-GhJson @('issue', 'view', "$IssueNumber", '--repo', $Repository, '--json', 'body')
  $existingBody = [string]$issue.body
  $marker = "<!-- bigbsky:follow-up-source issue=$ParentIssueNumber title=$(Get-NormalizedText -Text $IssueTitle) -->"
  if ($existingBody -match [regex]::Escape($marker)) { return }
  $excerpt = Get-FollowUpExcerpt -Body $IssueBody
  $addition = @"

## Additional Finding

$marker

Source issue: #$ParentIssueNumber
Suggested follow-up: $IssueTitle

$excerpt
"@
  $bodyPath = Join-Path $OutRoot ("amended-issue-{0}.md" -f $IssueNumber)
  Write-Utf8NoBom -Path $bodyPath -Content ($existingBody.TrimEnd() + $addition)
  & $Gh issue edit $IssueNumber --repo $Repository --body-file $bodyPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to amend existing follow-up issue #$IssueNumber." }
}

function Add-SubIssueRelationship {
  param(
    [int]$ParentIssueNumber,
    [int]$SubIssueNumber
  )
  $repo = Get-RepositoryParts
  $subIssue = Invoke-GhJson -CliArgs @(
    'api',
    "repos/$($repo.Owner)/$($repo.Name)/issues/$SubIssueNumber"
  )
  if ($null -eq $subIssue.id) { throw "Could not read REST id for sub-issue #$SubIssueNumber." }

  $payloadPath = Join-Path $OutRoot 'sub-issue-payload.json'
  Write-Utf8NoBom -Path $payloadPath -Content (@{
    sub_issue_id = [int64]$subIssue.id
    replace_parent = $true
  } | ConvertTo-Json -Compress)

  & $Gh api `
    --method POST `
    --header 'Accept: application/vnd.github+json' `
    --header 'X-GitHub-Api-Version: 2026-03-10' `
    "repos/$($repo.Owner)/$($repo.Name)/issues/$ParentIssueNumber/sub_issues" `
    --input $payloadPath | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to attach issue #$SubIssueNumber as a sub-issue of #$ParentIssueNumber."
  }
  Write-Host "Linked issue #$SubIssueNumber as a sub-issue of #$ParentIssueNumber."
}

function Resolve-IssueType {
  param([string]$IssueTitle, [string]$IssueBody)
  if ($IssueType -ne 'Auto') { return $IssueType }

  $text = "$IssueTitle`n$IssueBody"
  if ($text -match '(?i)\b(bug|regression|broken|fails?|error|exception|not working|incorrect|wrong|fix|incomplete acceptance|failed verification)\b') {
    return 'Bug'
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

function New-FollowUpIssue {
  $resolved = Get-PreparedFragmentPath
  $content = Get-Content -LiteralPath $resolved -Encoding UTF8 -Raw
  $metadata = Get-FragmentMetadata -Content $content
  if (!$metadata.issue) { throw 'Fragment metadata must include original issue number before creating a follow-up.' }
  if ([string]::IsNullOrWhiteSpace($Title)) { throw 'CreateFollowUp requires -Title.' }
  if ([string]::IsNullOrWhiteSpace($BodyFile) -or !(Test-Path $BodyFile)) { throw 'CreateFollowUp requires -BodyFile.' }

  $details = Get-Content -LiteralPath $BodyFile -Encoding UTF8 -Raw
  $body = @"
Follow-up from Issue #$($metadata.issue).

Original issue: #$($metadata.issue)
Changelog fragment: `$($resolved.Replace($Root.Path + '\', ''))`

$details
"@
  $issueBodyPath = Join-Path $OutRoot 'follow-up-issue-body.md'
  $similar = Find-OpenSimilarIssue -IssueTitle $Title -IssueBody $body
  if ($similar -and $similar.Kind -in @('exact', 'same_scope')) {
    $existingIssue = $similar.Issue
    $existingNumber = [int]$existingIssue.number
    $existingUrl = [string]$existingIssue.url
    if ($similar.Kind -eq 'same_scope') {
      Add-FollowUpFindingToIssue -IssueNumber $existingNumber -ParentIssueNumber $metadata.issue -IssueTitle $Title -IssueBody $body
    }
    $comment = @"
Workflow update: Reused this existing open follow-up instead of creating a duplicate from Issue #$($metadata.issue).

Requested follow-up title: $Title
"@
    if ($similar.Kind -eq 'same_scope') {
      $comment = @"
Workflow update: Added a related finding from Issue #$($metadata.issue) to this existing same-scope follow-up instead of creating a duplicate.

Requested follow-up title: $Title
"@
    }
    & $Gh issue comment $existingNumber --repo $Repository --body $comment | Out-Null
    Write-Host "Reused existing follow-up issue: $existingUrl"
    Add-SubIssueRelationship -ParentIssueNumber $metadata.issue -SubIssueNumber $existingNumber
    return
  }

  if ($similar -and $similar.Kind -eq 'related') {
    $relatedIssue = $similar.Issue
    $body = "Related open issue: #$($relatedIssue.number) $($relatedIssue.url)`n`n$body"
  }

  Write-Utf8NoBom -Path $issueBodyPath -Content $body
  $created = & $Gh issue create --repo $Repository --title $Title --body-file $issueBodyPath --label 'ai:needs-roast,ai:follow-up'
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create follow-up issue.' }
  Write-Host "Created follow-up issue: $created"

  $createdIssueNumber = Get-IssueNumberFromUrl -Url $created
  $resolvedIssueType = Resolve-IssueType -IssueTitle $Title -IssueBody $body
  Set-GitHubIssueType -IssueNumber $createdIssueNumber -Type $resolvedIssueType
  Write-Host "Set follow-up issue type: $resolvedIssueType"
  Add-SubIssueRelationship -ParentIssueNumber $metadata.issue -SubIssueNumber $createdIssueNumber
  if ($similar -and $similar.Kind -eq 'related') {
    & $Gh issue comment ([int]$similar.Issue.number) --repo $Repository --body "Workflow update: Created related follow-up issue $created from Issue #$($metadata.issue)." | Out-Null
  }
}

switch ($Mode) {
  'Prepare' { Prepare-Fragment }
  'Verify' { Verify-Fragment }
  'CreateFollowUp' { New-FollowUpIssue }
}
