param(
  [string]$Repository = 'radialmonster/bigbsky-dev',
  [string]$Title = '',
  [string]$BodyFile = '',
  [string]$DeployRef = '',
  [ValidateSet('Auto', 'Bug', 'Task')]
  [string]$IssueType = 'Auto',
  [switch]$InfraBlocked
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$OutRoot = Join-Path $Root 'out\deploy-followup'
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }
New-Item -ItemType Directory -Force -Path $OutRoot | Out-Null

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
  $parts = $Repository.Split('/')
  if ($parts.Count -ne 2) { throw "Repository must be OWNER/REPO, got: $Repository" }
  return [pscustomobject]@{ Owner = $parts[0]; Name = $parts[1] }
}

function Get-NormalizedText {
  param([string]$Text)
  if ($null -eq $Text) { $Text = '' }
  return ($Text.ToLowerInvariant() -replace '[^a-z0-9]+', ' ').Trim()
}

function Get-KeywordSet {
  param([string]$Text)
  $stopWords = @(
    'about', 'after', 'against', 'already', 'before', 'being', 'could', 'deploy',
    'deployment', 'from', 'github', 'issue', 'issues', 'label', 'needs', 'bigbsky',
    'should', 'that', 'their', 'there', 'these', 'this', 'through', 'when', 'where',
    'with', 'workflow'
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
  $candidateIssues = @(Invoke-GhJson @(
    'issue', 'list',
    '--repo', $Repository,
    '--state', 'open',
    '--json', 'number,title,body,url,labels',
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
    if ($titleKeywords.Count -ge 3 -and $titleOverlap -ge 2 -and $bodyOverlap -ge 2) {
      return [pscustomobject]@{ Kind = 'same_scope'; Issue = $issue }
    }
    if (($titleOverlap -ge 1 -and $bodyOverlap -ge 2) -or $bodyOverlap -ge 4) {
      return [pscustomobject]@{ Kind = 'related'; Issue = $issue }
    }
  }

  return $null
}

function Resolve-IssueType {
  param([string]$IssueTitle, [string]$IssueBody)
  if ($IssueType -ne 'Auto') { return $IssueType }
  $text = "$IssueTitle`n$IssueBody"
  if ($InfraBlocked -or $text -match '(?i)\b(ssh|daemon|provider|capacity|quota|rate.?limit|timeout|unavailable|network|connection)\b') {
    return 'Task'
  }
  return 'Bug'
}

function Set-GitHubIssueType {
  param(
    [int]$IssueNumber,
    [ValidateSet('Bug', 'Task')]
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
    Write-Host "Warning: failed to set issue #$IssueNumber type to $Type." -ForegroundColor Yellow
  }
}

if ([string]::IsNullOrWhiteSpace($Title)) { throw 'Deploy follow-up requires -Title.' }
if ([string]::IsNullOrWhiteSpace($BodyFile) -or !(Test-Path $BodyFile)) { throw 'Deploy follow-up requires -BodyFile.' }

$details = Get-Content -LiteralPath $BodyFile -Encoding UTF8 -Raw
$labels = @('ai:needs-roast', 'ai:follow-up', 'ai:blocks-release', 'priority:urgent')
if ($InfraBlocked) { $labels += 'ai:infra-blocked' }

$body = @"
Deploy failure follow-up.

Deploy ref: $DeployRef
Detected at: $(Get-Date -Format o)

$details
"@

$similar = Find-OpenSimilarIssue -IssueTitle $Title -IssueBody $body
if ($similar -and $similar.Kind -in @('exact', 'same_scope')) {
  $existingNumber = [int]$similar.Issue.number
  foreach ($label in $labels) {
    & $Gh issue edit $existingNumber --repo $Repository --add-label $label 2>$null | Out-Null
  }
  $comment = @"
Workflow update: deploy failure matched this existing issue.

Deploy ref: $DeployRef
Detected at: $(Get-Date -Format o)

$details
"@
  & $Gh issue comment $existingNumber --repo $Repository --body $comment | Out-Null
  Write-Host "Reused existing deploy follow-up issue: $([string]$similar.Issue.url)"
  return
}

if ($similar -and $similar.Kind -eq 'related') {
  $body = "Related open issue: #$($similar.Issue.number) $($similar.Issue.url)`n`n$body"
}

$bodyPath = Join-Path $OutRoot 'deploy-followup-body.md'
Write-Utf8NoBom -Path $bodyPath -Content $body
$created = & $Gh issue create --repo $Repository --title $Title --body-file $bodyPath --label ($labels -join ',')
if ($LASTEXITCODE -ne 0) { throw 'Failed to create deploy follow-up issue.' }
Write-Host "Created deploy follow-up issue: $created"

if ($created -match '/issues/(?<number>\d+)(?:$|[?#])') {
  $number = [int]$Matches.number
  Set-GitHubIssueType -IssueNumber $number -Type (Resolve-IssueType -IssueTitle $Title -IssueBody $body)
}
