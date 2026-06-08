param(
  [ValidateSet('Prepare', 'Apply')]
  [string]$Mode = 'Prepare',
  [int]$IssueNumber = 0,
  [string]$Repository = 'radialmonster/bigbsky-dev',
  [string]$ResultFile = '',
  [switch]$NoClaim,
  [switch]$KeepClaim
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$OutRoot = Join-Path $Root 'out\issue-roast'
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

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Set-IssueLabels {
  param(
    [int]$Number,
    [string[]]$Add = @(),
    [string[]]$Remove = @()
  )
  $args = @('issue', 'edit', "$Number", '--repo', $Repository)
  $addLabels = @($Add | Where-Object { ![string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
  $removeLabels = @($Remove | Where-Object { ![string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
  if ($addLabels.Count -gt 0) { $args += @('--add-label', ($addLabels -join ',')) }
  if ($removeLabels.Count -gt 0) { $args += @('--remove-label', ($removeLabels -join ',')) }
  if ($addLabels.Count -eq 0 -and $removeLabels.Count -eq 0) { return }
  & $Gh @args | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to update labels on issue #$Number." }
}

function Get-NextIssueNumber {
  $excludedLabels = @('ai:claimed', 'ai:fully-roasted', 'ai:blocked', 'ai:infra-blocked', 'ai:needs-user-answer')
  $urgentRows = Invoke-GhJson @(
    'issue', 'list',
    '--repo', $Repository,
    '--state', 'open',
    '--label', 'priority:urgent',
    '--json', 'number,title,labels,createdAt,updatedAt',
    '--limit', '100'
  )
  $urgentCandidate = $urgentRows |
    Where-Object {
      $names = @($_.labels | ForEach-Object { $_.name })
      -not ($excludedLabels | Where-Object { $names -contains $_ })
    } |
    Sort-Object @{ Expression = {
      $names = @($_.labels | ForEach-Object { $_.name })
      if ($names -contains 'ai:needs-roast') { 0 } else { 1 }
    } }, createdAt |
    Select-Object -First 1
  if ($urgentCandidate) { return [int]$urgentCandidate.number }

  $releaseBlockerRows = Invoke-GhJson @(
    'issue', 'list',
    '--repo', $Repository,
    '--state', 'open',
    '--label', 'ai:blocks-release',
    '--json', 'number,title,labels,createdAt,updatedAt',
    '--limit', '100'
  )
  $releaseBlockerCandidate = $releaseBlockerRows |
    Where-Object {
      $names = @($_.labels | ForEach-Object { $_.name })
      -not ($excludedLabels | Where-Object { $names -contains $_ })
    } |
    Sort-Object @{ Expression = {
      $names = @($_.labels | ForEach-Object { $_.name })
      if ($names -contains 'ai:needs-roast') { 0 } else { 1 }
    } }, createdAt |
    Select-Object -First 1
  if ($releaseBlockerCandidate) { return [int]$releaseBlockerCandidate.number }

  $firstPassRows = Invoke-GhJson @(
    'issue', 'list',
    '--repo', $Repository,
    '--label', 'ai:needs-roast',
    '--json', 'number,title,labels,createdAt,updatedAt',
    '--limit', '100'
  )
  $firstPassCandidate = $firstPassRows |
    Where-Object {
      $names = @($_.labels | ForEach-Object { $_.name })
      -not ($excludedLabels | Where-Object { $names -contains $_ })
    } |
    Sort-Object createdAt |
    Select-Object -First 1
  if ($firstPassCandidate) { return [int]$firstPassCandidate.number }

  $reRoastRows = Invoke-GhJson @(
    'issue', 'list',
    '--repo', $Repository,
    '--state', 'open',
    '--json', 'number,title,labels,createdAt,updatedAt',
    '--limit', '100'
  )
  $reRoastCandidate = $reRoastRows |
    Where-Object {
      $names = @($_.labels | ForEach-Object { $_.name })
      -not ($excludedLabels | Where-Object { $names -contains $_ })
    } |
    Sort-Object createdAt |
    Select-Object -First 1
  if (!$reRoastCandidate) {
    throw 'No issue is available for roast: no unclaimed ai:needs-roast issue and no open issue eligible for re-roast.'
  }
  return [int]$reRoastCandidate.number
}

function Get-RoastMetadata {
  param([string]$Body)
  $metadata = [ordered]@{
    count = 0
    last_roasted_at = $null
  }
  if ($Body -match '(?s)<!--\s*bigbsky:issue-roast\s+(?<json>\{.*?\})\s*-->') {
    try {
      $parsed = $Matches.json | ConvertFrom-Json
      if ($null -ne $parsed.count) { $metadata.count = [int]$parsed.count }
      if ($null -ne $parsed.last_roasted_at) { $metadata.last_roasted_at = [string]$parsed.last_roasted_at }
    } catch {}
  }
  return [pscustomobject]$metadata
}

function Set-RoastMetadata {
  param(
    [string]$Body,
    [int]$Count
  )
  $cleanBody = ($Body -replace '(?s)\r?\n?<!--\s*bigbsky:issue-roast\s+\{.*?\}\s*-->\s*$', '').TrimEnd()
  $json = [ordered]@{
    count = $Count
    last_roasted_at = (Get-Date -Format o)
  } | ConvertTo-Json -Compress
  return "$cleanBody`n`n<!-- bigbsky:issue-roast $json -->"
}

function Test-WorkflowComment {
  param([string]$Body)
  return $Body -match '^(Workflow claim:|Workflow update:|Issue body updated|(?:#{1,6}\s*)?Implementation (?:complete|summary|repair complete|update|verification update)\b|Correction to the implementation metadata\b)'
}

function Test-FlattenedMarkdownBody {
  param([string]$Body)
  if ([string]::IsNullOrWhiteSpace($Body)) { return $false }
  $lines = $Body -split '\r?\n'
  foreach ($line in $lines) {
    if ($line -match '^##\s+.*\s+##\s+') { return $true }
    if ($line.Length -gt 2000 -and $line -match '\s+-\s+\S+' -and $line -match '\s+##\s+\S+') { return $true }
  }
  return $false
}

function Get-RoastBundleMetadata {
  param([string]$ResultFilePath)
  $metadataPath = Join-Path (Split-Path -Parent $ResultFilePath) 'metadata.json'
  if (!(Test-Path $metadataPath)) { return $null }
  return Get-Content -LiteralPath $metadataPath -Encoding UTF8 -Raw | ConvertFrom-Json
}

function Get-RepositoryParts {
  $parts = $Repository -split '/', 2
  if ($parts.Length -ne 2) { throw "Repository must be owner/name: $Repository" }
  return [pscustomobject]@{ Owner = $parts[0]; Name = $parts[1] }
}

function ConvertTo-Array {
  param($Value)
  if ($null -eq $Value) { return @() }
  if ($Value -is [array]) { return $Value }
  return @($Value)
}

function Get-RestIssueId {
  param([int]$Number)
  $repo = Get-RepositoryParts
  $issue = & $Gh api `
    --header 'Accept: application/vnd.github+json' `
    --header 'X-GitHub-Api-Version: 2026-03-10' `
    "repos/$($repo.Owner)/$($repo.Name)/issues/$Number" | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or !$issue.id) { throw "Could not read REST issue id for #$Number." }
  return [int64]$issue.id
}

function Get-NativeBlockingIssues {
  param([int]$BlockedIssueNumber)
  $repo = Get-RepositoryParts
  $raw = & $Gh api `
    --header 'Accept: application/vnd.github+json' `
    --header 'X-GitHub-Api-Version: 2026-03-10' `
    "repos/$($repo.Owner)/$($repo.Name)/issues/$BlockedIssueNumber/dependencies/blocked_by" 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { return @() }
  return @(ConvertTo-Array ($raw | ConvertFrom-Json))
}

function Add-NativeBlockedByDependency {
  param(
    [int]$BlockedIssueNumber,
    [int]$BlockingIssueNumber
  )
  $existing = @(Get-NativeBlockingIssues -BlockedIssueNumber $BlockedIssueNumber | ForEach-Object { [int]$_.number })
  if ($existing -contains $BlockingIssueNumber) { return $false }

  $repo = Get-RepositoryParts
  $blockingIssueId = Get-RestIssueId -Number $BlockingIssueNumber
  $payloadPath = Join-Path $env:TEMP ("bigbsky-issue-roast-dependency-{0}-{1}.json" -f $BlockedIssueNumber, $BlockingIssueNumber)
  $payload = @{ issue_id = $blockingIssueId } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($payloadPath, $payload, [System.Text.UTF8Encoding]::new($false))
  try {
    & $Gh api `
      --method POST `
      --header 'Accept: application/vnd.github+json' `
      --header 'X-GitHub-Api-Version: 2026-03-10' `
      "repos/$($repo.Owner)/$($repo.Name)/issues/$BlockedIssueNumber/dependencies/blocked_by" `
      --input $payloadPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "GitHub dependency API failed." }
    return $true
  } finally {
    Remove-Item -LiteralPath $payloadPath -Force -ErrorAction SilentlyContinue
  }
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

function Get-RelevantContext {
  param([string]$Text)
  $files = New-Object System.Collections.Generic.List[string]
  foreach ($m in [regex]::Matches($Text, '`([^`]+\.(md|ts|tsx|json|prisma|sql|ps1|txt))`')) {
    $candidate = $m.Groups[1].Value -replace '/', '\'
    $full = Join-Path $Root $candidate
    if (Test-Path $full) { $files.Add($candidate) }
  }

  $seedTerms = @()
  foreach ($term in @('TicketDetailPart','TicketDetailLabor','createFromTicket','readinessForTicket','InvoiceLineItem','MobileSentrix','allocation','webhook','recurring','return','POS','customer','vendor','payment')) {
    if ($Text -match [regex]::Escape($term)) { $seedTerms += $term }
  }
  $seedTerms = $seedTerms | Select-Object -Unique | Select-Object -First 6

  $searchResults = New-Object System.Collections.Generic.List[string]
  foreach ($term in $seedTerms) {
    try {
      $matches = & rg --fixed-strings --line-number --glob '!node_modules' --glob '!out/**' --glob '!changelog/internal/CHANGELOG.md' $term $Root 2>$null |
        Select-Object -First 40
      foreach ($match in $matches) { $searchResults.Add($match) }
    } catch {}
  }

  $contextFiles = $files | Select-Object -Unique | Select-Object -First 12
  $fileSnippets = New-Object System.Collections.Generic.List[string]
  foreach ($rel in $contextFiles) {
    $full = Join-Path $Root $rel
    try {
      $content = Get-Content -LiteralPath $full -Encoding UTF8 -TotalCount 180
      $fileSnippets.Add("### $rel`n`n~~~text`n$($content -join "`n")`n~~~")
    } catch {}
  }

  return [pscustomobject]@{
    Terms = $seedTerms
    SearchResults = ($searchResults | Select-Object -Unique)
    FileSnippets = $fileSnippets
  }
}

function Get-KeywordSet {
  param([string]$Text)
  $stopWords = @(
    'about','after','again','against','already','also','because','before','being','between',
    'could','current','during','existing','first','from','github','issue','issues','label',
    'needs','should','that','their','there','these','this','through','when','where','which',
    'while','with','workflow','would'
  )
  $words = [regex]::Matches(([string]$Text).ToLowerInvariant(), '[a-z0-9][a-z0-9-]{3,}') |
    ForEach-Object { $_.Value.Trim('-') } |
    Where-Object { $_.Length -ge 4 -and ($stopWords -notcontains $_) }
  return @($words | Group-Object | Sort-Object @{ Expression = 'Count'; Descending = $true }, Name | Select-Object -First 40 -ExpandProperty Name)
}

function Get-SimilarIssueCandidates {
  param([object]$Issue)
  $targetTitleTerms = @(Get-KeywordSet -Text ([string]$Issue.title))
  $targetBodyTerms = @(Get-KeywordSet -Text ([string]$Issue.body))
  $targetTerms = @($targetTitleTerms + $targetBodyTerms | Select-Object -Unique)
  if ($targetTerms.Count -eq 0) { return @() }

  $rows = Invoke-GhJson @(
    'issue', 'list',
    '--repo', $Repository,
    '--state', 'open',
    '--json', 'number,title,body,labels,url,createdAt',
    '--limit', '200'
  )

  $candidates = @($rows | Where-Object { [int]$_.number -ne [int]$Issue.number } | ForEach-Object {
    $candidateTitleTerms = @(Get-KeywordSet -Text ([string]$_.title))
    $candidateBodyTerms = @(Get-KeywordSet -Text ([string]$_.body))
    $titleOverlap = @($candidateTitleTerms | Where-Object { $targetTitleTerms -contains $_ })
    $bodyOverlap = @($candidateBodyTerms | Where-Object { $targetTerms -contains $_ })
    $score = ($titleOverlap.Count * 4) + $bodyOverlap.Count
    if ($score -lt 4) { return }

    $allMatches = @($titleOverlap + $bodyOverlap | Select-Object -Unique | Select-Object -First 12)
    $labelText = (@($_.labels | ForEach-Object { $_.name }) -join ', ')
    $body = [string]$_.body
    if ($body.Length -gt 420) { $body = $body.Substring(0, 420) + '...' }
    [pscustomobject]@{
      Number = [int]$_.number
      Title = [string]$_.title
      Url = [string]$_.url
      Labels = $labelText
      Score = $score
      Matches = ($allMatches -join ', ')
      BodyExcerpt = $body
    }
  } | Sort-Object @{ Expression = 'Score'; Descending = $true }, Number | Select-Object -First 12)

  return $candidates
}

function New-RoastPrompt {
  param(
    [object]$Issue,
    [string]$Comments,
    [object]$Context,
    [object[]]$SimilarIssues,
    [object]$RoastMetadata
  )
  $promptInstructions = Get-Content -LiteralPath (Join-Path $Root 'prompts\github\issue-roast.txt') -Encoding UTF8 -Raw
  $labels = ($Issue.labels | ForEach-Object { $_.name }) -join ', '
  $searchText = ($Context.SearchResults -join "`n")
  $snippetText = ($Context.FileSnippets -join "`n`n")
  $similarText = if ($SimilarIssues.Count -gt 0) {
    ($SimilarIssues | ForEach-Object {
      "### #$($_.Number) $($_.Title)`nLabels: $($_.Labels)`nScore: $($_.Score)`nMatched terms: $($_.Matches)`nURL: $($_.Url)`nExcerpt: $($_.BodyExcerpt)"
    }) -join "`n`n"
  } else {
    'No similar open issue candidates found by keyword pre-scan.'
  }
  return @"
$promptInstructions

You are preparing a machine-applicable roast result for GitHub issue #$($Issue.number).

Return your final answer as JSON only. Use this shape:

~~~json
{
  "issue_number": $($Issue.number),
  "replace_body": "full updated Markdown issue body",
  "comment": "neutral workflow comment, or empty string",
  "add_labels": ["ai:fully-roasted"],
  "remove_labels": ["ai:needs-roast"],
  "issue_type": "Feature",
  "roast_findings": ["specific issue-quality gap found during this pass"],
  "blocked_by_issue_numbers": [],
  "related_issue_numbers": [],
  "close_issue": false
}
~~~

Rules for this JSON:
- replace_body must be complete Markdown for the issue body, not a patch.
- Preserve Markdown formatting with real newlines between headings, paragraphs, numbered steps, and bullet lists. Do not flatten the issue body into one long paragraph.
- comment must use neutral wording such as "Workflow update:".
- Do not include secrets.
- Prefer inferred product/workflow decisions. Ask user questions only when no safe default exists.
- Keep or add ai:needs-roast if another self-roast pass is still needed.
- Add ai:fully-roasted only when this pass began as a real roast and found no meaningful remaining issue-quality gaps. This is the label that makes an issue eligible for implementation.
- If this pass found and fixed any meaningful problem, do not add ai:fully-roasted yet. Leave the issue eligible for at least one later roast pass.
- roast_findings must list every meaningful problem found during this pass. Use an empty array only when the issue was already clean after active critique.
- If the issue has neither short-term nor long-term, add exactly one of those labels based on product judgment.
- Do not leave both short-term and long-term on the same issue. If both are present, remove the less appropriate one.
- issue_type must be one of "Feature", "Bug", "Task", or an empty string if the current type should be left unchanged.
- blocked_by_issue_numbers should list GitHub issue numbers that truly gate this issue after investigation. Do not add candidates just because the audit suggested them.
- related_issue_numbers should list non-gating related issues that should be mentioned in the issue body/comment but should not block implementation.
- Do not edit or invent the hidden bigbsky:issue-roast metadata; the apply script manages it.

# GitHub Issue

Number: $($Issue.number)
Title: $($Issue.title)
Labels: $labels
Prior roast count: $($RoastMetadata.count)
Last roasted at: $($RoastMetadata.last_roasted_at)

## Current Body

$($Issue.body)

## Comments

$Comments

# Similar Open Issue Candidates

This is a keyword pre-scan, not a decision. Review these candidates for duplicates, blockers, parent/sub-issue splits, and non-gating related work before changing labels or scope.

$similarText

# Relevant Search Results

~~~text
$searchText
~~~

# Relevant File Snippets

$snippetText
"@
}

function Prepare-IssueRoast {
  if ($IssueNumber -le 0) {
    if (![string]::IsNullOrWhiteSpace($env:BIGBSKY_TARGET_ISSUE) -and $env:BIGBSKY_TARGET_ISSUE -match '^\d+$') {
      $script:IssueNumber = [int]$env:BIGBSKY_TARGET_ISSUE
      Write-Host ("Fast-track: using target issue #$($script:IssueNumber) from BIGBSKY_TARGET_ISSUE environment variable.") -ForegroundColor Cyan
    } else {
      $script:IssueNumber = Get-NextIssueNumber
    }
  }

  $issue = Invoke-GhJson @(
    'issue', 'view', "$IssueNumber",
    '--repo', $Repository,
    '--json', 'number,title,body,labels,comments'
  )
  $labelNames = @($issue.labels | ForEach-Object { $_.name })
  if (($labelNames -contains 'ai:claimed') -and !$NoClaim) {
    throw "Issue #$IssueNumber is already claimed."
  }
  if (!$NoClaim) {
    $claimLock = Enter-WorkflowIssueClaim -IssueNumber $IssueNumber -TimeoutSeconds 15
    if (!$claimLock.Acquired) {
      throw "Issue #$IssueNumber claim lock timed out - another lane may be claiming it."
    }
    try {
      $freshLabels = @((Invoke-GhJson @('issue', 'view', "$IssueNumber", '--repo', $Repository, '--json', 'labels')).labels | ForEach-Object { $_.name })
      if ($freshLabels -contains 'ai:claimed') {
        throw "Issue #$IssueNumber is already claimed."
      }
      & $Gh issue edit $IssueNumber --repo $Repository --add-label 'ai:claimed' | Out-Null
      $claimComment = "Workflow claim: issue-roast preparation started at $(Get-Date -Format o)."
      & $Gh issue comment $IssueNumber --repo $Repository --body $claimComment | Out-Null
    } finally {
      Exit-WorkflowIssueClaim -Lock $claimLock
    }
  }

  $commentsText = ($issue.comments | ForEach-Object {
    "## Comment by $($_.author.login) at $($_.createdAt)`n$($_.body)"
  }) -join "`n`n"
  $roastMetadata = Get-RoastMetadata -Body ([string]$issue.body)

  $contextText = "$($issue.title)`n$($issue.body)`n$commentsText"
  $context = Get-RelevantContext -Text $contextText
  $similarIssues = @(Get-SimilarIssueCandidates -Issue $issue)

  $dir = Join-Path $OutRoot ("issue-{0}" -f $IssueNumber)
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $promptPath = Join-Path $dir 'prompt.md'
  $resultPath = Join-Path $dir 'result.json'
  $metaPath = Join-Path $dir 'metadata.json'
  $prompt = New-RoastPrompt -Issue $issue -Comments $commentsText -Context $context -SimilarIssues $similarIssues -RoastMetadata $roastMetadata
  Write-Utf8NoBom -Path $promptPath -Content $prompt
  Write-Utf8NoBom -Path $resultPath -Content (@{
    issue_number = $IssueNumber
    replace_body = ''
    comment = ''
    add_labels = @()
    remove_labels = @()
    issue_type = ''
    roast_findings = @()
    blocked_by_issue_numbers = @()
    related_issue_numbers = @()
    close_issue = $false
  } | ConvertTo-Json -Depth 6)
  Write-Utf8NoBom -Path $metaPath -Content (@{
    repository = $Repository
    issue_number = $IssueNumber
    prior_roast_count = $roastMetadata.count
    similar_issue_numbers = @($similarIssues | ForEach-Object { $_.Number })
    generated_at = (Get-Date -Format o)
    prompt_path = $promptPath
    result_path = $resultPath
    claimed = (-not $NoClaim)
  } | ConvertTo-Json -Depth 6)

  Write-Host "Prepared issue roast bundle:"
  Write-Host "  $promptPath"
  Write-Host "  $resultPath"
  Write-Host ''
  Write-Host "Run a model on prompt.md, write JSON to result.json, then apply:"
  Write-Host "  .\scripts\github-loop\issue-roast.ps1 -Mode Apply -IssueNumber $IssueNumber -ResultFile `"$resultPath`""
}

function Apply-IssueRoast {
  if ($IssueNumber -le 0 -and $ResultFile) {
    $guess = Split-Path -Parent $ResultFile
    if ($guess -match 'issue-(\d+)$') { $script:IssueNumber = [int]$Matches[1] }
  }
  if ($IssueNumber -le 0) { throw 'Apply requires -IssueNumber or a result path under out\issue-roast\issue-N.' }
  if (!$ResultFile) { $ResultFile = Join-Path $OutRoot ("issue-{0}\result.json" -f $IssueNumber) }
  if (!(Test-Path $ResultFile)) { throw "Result file not found: $ResultFile" }

  $result = Get-Content -LiteralPath $ResultFile -Encoding UTF8 -Raw | ConvertFrom-Json
  if ($result.issue_number -and [int]$result.issue_number -ne $IssueNumber) {
    throw "Result issue_number $($result.issue_number) does not match -IssueNumber $IssueNumber."
  }
  if ([string]::IsNullOrWhiteSpace($result.replace_body)) {
    throw 'Result replace_body is empty; refusing to erase issue body.'
  }
  if (Test-FlattenedMarkdownBody -Body ([string]$result.replace_body)) {
    throw 'Result replace_body appears to have flattened Markdown headings/lists onto one line; refusing to rewrite issue body.'
  }

  $currentIssue = Invoke-GhJson @(
    'issue', 'view', "$IssueNumber",
    '--repo', $Repository,
    '--json', 'body,comments'
  )
  $bundleMetadata = Get-RoastBundleMetadata -ResultFilePath $ResultFile
  if ($bundleMetadata -and $bundleMetadata.generated_at) {
    $generatedAt = [DateTimeOffset]::Parse([string]$bundleMetadata.generated_at)
    $newUserComments = @($currentIssue.comments | Where-Object {
      ([DateTimeOffset]::Parse([string]$_.createdAt) -gt $generatedAt) -and
      -not (Test-WorkflowComment -Body ([string]$_.body))
    })
    if ($newUserComments.Count -gt 0) {
      if (!$KeepClaim) {
        & $Gh issue edit $IssueNumber --repo $Repository --remove-label 'ai:claimed' | Out-Null
      }
      $latest = $newUserComments | Sort-Object createdAt -Descending | Select-Object -First 1
      throw "New non-workflow comment arrived after prepare at $($latest.createdAt); rerun Prepare for issue #$IssueNumber before applying."
    }
  }
  $currentMetadata = Get-RoastMetadata -Body ([string]$currentIssue.body)
  $nextRoastCount = [int]$currentMetadata.count + 1
  $bodyFile = Join-Path (Split-Path -Parent $ResultFile) 'apply-body.md'
  $bodyWithMetadata = Set-RoastMetadata -Body ([string]$result.replace_body) -Count $nextRoastCount
  Write-Utf8NoBom -Path $bodyFile -Content $bodyWithMetadata

  $addLabels = @($result.add_labels | Where-Object { ![string]::IsNullOrWhiteSpace([string]$_) })
  $roastFindingsProperty = $result.PSObject.Properties['roast_findings']
  $roastFindings = @()
  if ($roastFindingsProperty) {
    $roastFindings = @($result.roast_findings | Where-Object { ![string]::IsNullOrWhiteSpace([string]$_) })
  }
  if ($addLabels -contains 'ai:fully-roasted') {
    if (!$roastFindingsProperty) {
      throw 'Result adds ai:fully-roasted but omits roast_findings. Use an empty roast_findings array only when this pass found no meaningful gaps.'
    }
    if ($roastFindings.Count -gt 0) {
      throw "Result adds ai:fully-roasted but roast_findings is not empty. Do not mark fully roasted on a pass that found issues."
    }
    $removeLabels = @($result.remove_labels | Where-Object { ![string]::IsNullOrWhiteSpace([string]$_) })
    if ($removeLabels -notcontains 'ai:needs-roast') {
      throw 'Result adds ai:fully-roasted but does not remove ai:needs-roast.'
    }
  }
  if (($addLabels -contains 'short-term') -and ($addLabels -contains 'long-term')) {
    throw 'Result attempts to add both short-term and long-term. Choose one planning horizon label.'
  }

  & $Gh issue edit $IssueNumber --repo $Repository --body-file $bodyFile | Out-Null

  $removeLabels = @($result.remove_labels | Where-Object { ![string]::IsNullOrWhiteSpace([string]$_) })
  Set-IssueLabels -Number $IssueNumber -Add $addLabels -Remove $removeLabels
  if ($null -ne $result.issue_type -and ![string]::IsNullOrWhiteSpace([string]$result.issue_type)) {
    $type = [string]$result.issue_type
    if (@('Bug', 'Feature', 'Task') -notcontains $type) {
      throw "Invalid issue_type in result: $type"
    }
    Set-GitHubIssueType -IssueNumber $IssueNumber -Type $type
  }
  $blockedByIssueNumbers = @()
  if ($result.PSObject.Properties['blocked_by_issue_numbers']) {
    $blockedByIssueNumbers = @($result.blocked_by_issue_numbers | Where-Object { $null -ne $_ } | ForEach-Object { [int]$_ } | Where-Object { $_ -gt 0 -and $_ -ne $IssueNumber } | Select-Object -Unique)
  }
  foreach ($blockingIssueNumber in $blockedByIssueNumbers) {
    $created = Add-NativeBlockedByDependency -BlockedIssueNumber $IssueNumber -BlockingIssueNumber $blockingIssueNumber
    if ($created) {
      & $Gh issue comment $IssueNumber --repo $Repository --body "Workflow update: issue-roast confirmed this issue is blocked by #$blockingIssueNumber and added the native GitHub dependency relationship." | Out-Null
    }
  }
  if ($blockedByIssueNumbers.Count -gt 0) {
    Set-IssueLabels -Number $IssueNumber -Add @('ai:blocked', 'ai:needs-roast') -Remove @('ai:fully-roasted')
  }
  if (![string]::IsNullOrWhiteSpace($result.comment)) {
    & $Gh issue comment $IssueNumber --repo $Repository --body ([string]$result.comment) | Out-Null
  }
  if ($result.close_issue -eq $true) {
    & $Gh issue close $IssueNumber --repo $Repository --comment 'Workflow update: issue closed by issue-roast result.' | Out-Null
  }
  if (!$KeepClaim) {
    Set-IssueLabels -Number $IssueNumber -Remove @('ai:claimed')
  }
  Write-Host "Applied issue roast result to #$IssueNumber."
}

if ($Mode -eq 'Prepare') { Prepare-IssueRoast }
else { Apply-IssueRoast }
