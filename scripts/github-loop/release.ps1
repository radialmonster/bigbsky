param(
  [ValidateSet('Prepare', 'Apply')]
  [string]$Mode = 'Prepare',
  [string]$Repository = 'radialmonster/bigbsky-dev',
  [string]$Tag = '',
  [string]$Target = 'main',
  [switch]$AllowUnroastedFragments
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$OutRoot = Join-Path $Root 'out\release'
$FragmentRoot = Join-Path $Root 'changelog\unreleased'
$InternalChangelogPath = Join-Path $Root 'changelog\internal\CHANGELOG.md'
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

function Invoke-GhWithRetry {
  param(
    [string[]]$CliArgs,
    [int]$Attempts = 3
  )
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    & $Gh @CliArgs
    if ($LASTEXITCODE -eq 0) { return }
    if ($attempt -ge $Attempts) { throw "gh failed after $Attempts attempts: $($CliArgs -join ' ')" }
    Start-Sleep -Seconds ([Math]::Min(10, 2 * $attempt))
  }
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Invoke-Git {
  param([string[]]$GitArgs)
  $output = & git -C $Root @GitArgs
  if ($LASTEXITCODE -ne 0) { throw "git failed: $($GitArgs -join ' ')" }
  return $output
}

function Assert-CleanGitTreeForRelease {
  $status = @(Invoke-Git @('status', '--short'))
  if ($status.Count -gt 0) {
    throw "Release apply requires a clean worktree before compiling changelog/internal/CHANGELOG.md.`n$($status -join "`n")"
  }

  $branch = [string](Invoke-Git @('branch', '--show-current'))
  $branch = $branch.Trim()
  if ($Target -match '^[A-Za-z0-9._/-]+$' -and $Target -notmatch '^[0-9a-f]{7,40}$' -and $branch -ne $Target) {
    throw "Release apply must run from target branch '$Target' before compiling changelog/internal/CHANGELOG.md. Current branch is '$branch'."
  }
}

function New-ChangelogEntry {
  param(
    [object]$Plan,
    [string]$Notes
  )

  $body = $Notes.Trim()
  $headingPattern = '^\# Bigbsky\s+' + [regex]::Escape([string]$Plan.tag) + '\s*\r?\n\r?\n?'
  $body = ($body -replace $headingPattern, '').Trim()
  $metadata = [ordered]@{
    tag = [string]$Plan.tag
    generated_at = [string]$Plan.generated_at
    source = 'github-release'
  } | ConvertTo-Json -Compress

  return "## Bigbsky $($Plan.tag)`n`n<!-- bigbsky:release $metadata -->`n`n$body`n"
}

function Write-ChangelogPreview {
  param(
    [object]$Plan,
    [string]$Notes
  )
  $entryPath = Join-Path $OutRoot 'changelog-entry.md'
  Write-Utf8NoBom -Path $entryPath -Content (New-ChangelogEntry -Plan $Plan -Notes $Notes)
  return $entryPath
}

function Update-Changelog {
  param(
    [object]$Plan,
    [string]$Notes
  )

  $changelogPath = $InternalChangelogPath
  $entry = (New-ChangelogEntry -Plan $Plan -Notes $Notes).TrimEnd()
  $existing = ''
  if (Test-Path $changelogPath) {
    $existing = Get-Content -LiteralPath $changelogPath -Encoding UTF8 -Raw
  } else {
    $existing = "# Bigbsky Changelog`n"
  }

  $tagPattern = '(?m)^##\s+Bigbsky\s+' + [regex]::Escape([string]$Plan.tag) + '(\s|$)'
  if ($existing -match $tagPattern) {
    Write-Host "changelog/internal/CHANGELOG.md already contains $($Plan.tag); skipping changelog update."
    return $false
  }

  if ($existing -match '(?m)^## Recovered Legacy Entries\s*$') {
    $escapedHeading = '(?m)^## Recovered Legacy Entries\s*$'
    $next = [regex]::Replace($existing.TrimEnd(), $escapedHeading, "$entry`n`n## Recovered Legacy Entries", 1) + "`n"
    Write-Utf8NoBom -Path $changelogPath -Content $next
    return $true
  }

  $prefix = "# Bigbsky Changelog`n"
  $body = $existing.TrimStart()
  if ($body.StartsWith($prefix.Trim(), [System.StringComparison]::OrdinalIgnoreCase)) {
    $body = $body.Substring($prefix.Trim().Length).TrimStart()
  }
  $next = "$prefix`n$entry`n`n$body".TrimEnd() + "`n"
  Write-Utf8NoBom -Path $changelogPath -Content $next
  return $true
}

function Convert-BulletsToProse {
  param([string]$Text)
  $lines = $Text -split '\r?\n' | Where-Object { $_ -match '\S' }
  $sentences = New-Object System.Collections.Generic.List[string]
  foreach ($line in $lines) {
    $cleaned = $line -replace '^\s*[-*]\s+', ''
    $cleaned = $cleaned.Trim()
    if ([string]::IsNullOrWhiteSpace($cleaned)) { continue }
    if ($cleaned -notmatch '[.!?]$') { $cleaned += '.' }
    $sentences.Add($cleaned)
  }
  return ($sentences -join ' ')
}

function New-IntroParagraph {
  param([System.Collections.Generic.List[hashtable]]$Entries)
  if ($Entries.Count -eq 0) { return '' }

  $titles = @($Entries | ForEach-Object { $_.Title })
  $count = $Entries.Count

  if ($count -eq 1) {
    $first = $titles[0]
    $firstLower = $first.Substring(0, 1).ToLowerInvariant() + $first.Substring(1)
    return "This update $firstLower."
  }

  $last = $titles[$count - 1]
  $rest = @($titles[0..($count - 2)] | ForEach-Object {
    $_.Substring(0, 1).ToLowerInvariant() + $_.Substring(1)
  })
  return "This update brings $($rest -join ', '), and $($last.Substring(0, 1).ToLowerInvariant() + $last.Substring(1))."
}

function New-ClosingTeaser {
  $teasers = @(
    "We're always working to make Bigbsky better -- check back soon for more updates.",
    "More improvements are on the way. Thanks for being part of Bigbsky!",
    "We're hard at work on the next round of improvements -- stay tuned.",
    "Have feedback or ideas? We'd love to hear from you. More updates coming soon."
  )
  $idx = [math]::Abs((Get-Date).Ticks) % $teasers.Count
  return $teasers[$idx]
}

function New-PublicChangelogContent {
  param([string]$Source)

  $releaseMatches = [regex]::Matches($Source, '(?ms)^## Bigbsky (?<tag>\S+).*?(?=^## Bigbsky |\z)')
  $publicReleases = New-Object System.Collections.Generic.List[string]

  foreach ($releaseMatch in $releaseMatches) {
    $releaseSection = [string]$releaseMatch.Value
    $tag = [string]$releaseMatch.Groups['tag'].Value
    $issueMatches = [regex]::Matches($releaseSection, '(?ms)^# Issue #(?<number>\d+)\s*[-:]\s*(?<title>.+?)\r?\n(?<body>.*?)(?=^# Issue #|\z)')
    $issueEntries = New-Object System.Collections.Generic.List[hashtable]

    foreach ($issueMatch in $issueMatches) {
      $publicNotes = Get-PublicNotesFromFragment -Content ([string]$issueMatch.Groups['body'].Value)
      if ([string]::IsNullOrWhiteSpace($publicNotes)) { continue }

      $number = [string]$issueMatch.Groups['number'].Value
      $title = ([string]$issueMatch.Groups['title'].Value).Trim()
      $issueEntries.Add(@{ Number = $number; Title = $title; Notes = $publicNotes })
    }

    if ($issueEntries.Count -gt 0) {
      $lines = New-Object System.Collections.Generic.List[string]
      $lines.Add("## Bigbsky $tag")
      $lines.Add('')

      $intro = New-IntroParagraph -Entries $issueEntries
      if ($intro) { $lines.Add($intro); $lines.Add('') }

      foreach ($entry in $issueEntries) {
        $prose = Convert-BulletsToProse -Text $entry.Notes
        if ($prose) { $lines.Add($prose) }
      }

      $lines.Add('')
      $teaser = New-ClosingTeaser
      if ($teaser) { $lines.Add($teaser) }

      $publicReleases.Add(($lines -join "`n").TrimEnd())
    }
  }

  if ($publicReleases.Count -gt 0) {
    return "# Bigbsky Changelog`n`n$($publicReleases -join "`n`n")`n"
  }

  return "# Bigbsky Changelog`n`nNo user-facing release notes have been published yet.`n"
}

function Get-PublicNotesFromFragment {
  param([string]$Content)
  $match = [regex]::Match($Content, '(?ms)^##\s+Public(?: Release)? Notes\s*\r?\n(?<body>.*?)(?=^##\s+|\z)')
  if (!$match.Success) { return '' }

  $body = [string]$match.Groups['body'].Value
  $body = [regex]::Replace($body, '(?s)<!--.*?-->', '')
  $body = $body.Trim()
  if ([string]::IsNullOrWhiteSpace($body)) { return '' }
  if ($body -match '(?im)^\s*[-*]?\s*(none|n/a|not public|internal only)\.?\s*$') { return '' }
  return $body
}

function Convert-MarkdownToPlainText {
  param([string]$Markdown)
  $text = [regex]::Replace($Markdown, '(?m)^#{1,6}\s+', '')
  $text = [regex]::Replace($text, '`([^`]+)`', '$1')
  $text = [regex]::Replace($text, '\*\*([^*]+)\*\*', '$1')
  $text = [regex]::Replace($text, '(?m)^[-*]\s+', '')
  $text = [regex]::Replace($text, '\s+', ' ').Trim()
  if ($text.Length -gt 220) { return $text.Substring(0, 220).TrimEnd() + '...' }
  return $text
}

function Convert-MarkdownToPublicReleaseJson {
  param([string]$Source)
  $public = New-PublicChangelogContent -Source $Source
  $releaseMatches = [regex]::Matches($public, '(?ms)^## Bigbsky (?<tag>\S+).*?(?=^## Bigbsky |\z)')
  return @($releaseMatches | ForEach-Object {
    $section = $_.Value.Trim()
    $tag = [string]$_.Groups['tag'].Value
    $body = [regex]::Replace($section, '^## Bigbsky \S+\s*', '').Trim()
    [pscustomobject]@{
      tag = $tag
      title = "Bigbsky $tag"
      summary = Convert-MarkdownToPlainText -Markdown $body
      body = $body
    }
  })
}

function Update-PublicChangelog {
  $sourcePath = $InternalChangelogPath
  $publicPath = Join-Path $Root 'apps\web\public\changelog.md'
  $publicJsonPath = Join-Path $Root 'apps\web\public\changelog.json'
  $source = ''
  if (Test-Path $sourcePath) {
    $source = Get-Content -LiteralPath $sourcePath -Encoding UTF8 -Raw
  }
  Write-Utf8NoBom -Path $publicPath -Content (New-PublicChangelogContent -Source $source)
  Write-Utf8NoBom -Path $publicJsonPath -Content ((Convert-MarkdownToPublicReleaseJson -Source $source | ConvertTo-Json -Depth 8) + "`n")
}

function Update-InternalChangelogArtifact {
  $sourcePath = $InternalChangelogPath
  $artifactPath = Join-Path $Root 'apps\web\src\generated\internal-changelog.server.ts'
  $content = ''
  if (Test-Path $sourcePath) {
    $content = Get-Content -LiteralPath $sourcePath -Encoding UTF8 -Raw
  }
  # Escape backticks and template literal delimiters so the string is safe inside a JS template literal
  $escaped = $content -replace '\\', '\\\\' -replace '`', '\`' -replace '\$\{', '\${'
  $generatedAt = Get-Date -Format o
  $artifact = @"
// Generated by scripts/github-loop/release.ps1 — do not edit by hand.
// Re-run the release flow to regenerate from changelog/internal/CHANGELOG.md.
export const internalChangelogContent = ``$escaped``;
export const generatedAt = '$generatedAt';
"@
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $artifactPath) | Out-Null
  Write-Utf8NoBom -Path $artifactPath -Content $artifact
}

function Commit-ChangelogUpdate {
  param([object]$Plan)

  $artifactRelPath = 'apps/web/src/generated/internal-changelog.server.ts'
  $status = @(Invoke-Git @('status', '--short', '--', 'changelog/internal/CHANGELOG.md', 'apps/web/public/changelog.md', 'apps/web/public/changelog.json', $artifactRelPath))
  if ($status.Count -eq 0) { return }

  Invoke-Git @('add', 'changelog/internal/CHANGELOG.md', 'apps/web/public/changelog.md', 'apps/web/public/changelog.json', $artifactRelPath) | Out-Null
  Invoke-Git @('commit', '-m', "Update changelog for $($Plan.tag)") | Out-Null
  Invoke-Git @('push', 'origin', 'HEAD') | Out-Null
}

function Get-FragmentMetadata {
  param([string]$Content)
  $metadata = [ordered]@{ issue = $null; status = 'needs-roast' }
  if ($Content -match '(?s)<!--\s*bigbsky:changelog\s+(?<json>\{.*?\})\s*-->') {
    try {
      $parsed = $Matches.json | ConvertFrom-Json
      if ($null -ne $parsed.issue) { $metadata.issue = [int]$parsed.issue }
      if ($null -ne $parsed.status) { $metadata.status = [string]$parsed.status }
    } catch {}
  }
  return [pscustomobject]$metadata
}

function Test-PublicNotesSection {
  param([string]$Content)
  return [regex]::IsMatch($Content, '(?ms)^##\s+Public(?: Release)? Notes\s*\r?\n')
}

function Get-NextTag {
  $prefix = 'v{0}' -f (Get-Date -Format 'yyyy.MM.dd')
  $releases = @(Invoke-GhJson @(
    'release', 'list',
    '--repo', $Repository,
    '--json', 'tagName',
    '--limit', '100'
  ))
  $max = 0
  foreach ($release in @($releases)) {
    $tagName = [string]@($release.tagName)[0]
    if ($tagName -match "^$([regex]::Escape($prefix))-(?<n>\d+)$") {
      $max = [Math]::Max($max, [int]$Matches.n)
    }
  }
  return '{0}-{1}' -f $prefix, ($max + 1)
}

function Get-ReleaseCandidates {
  $issues = @(Invoke-GhJson @(
    'issue', 'list',
    '--repo', $Repository,
    '--state', 'closed',
    '--label', 'ai:ready-for-release',
    '--json', 'number,title,url,labels,closedAt',
    '--limit', '100'
  ))
  $candidates = New-Object System.Collections.Generic.List[object]
  foreach ($issue in (@($issues) | Sort-Object { [int]@($_.number)[0] })) {
    $issueNumber = [int]@($issue.number)[0]
    $labels = @($issue.labels | ForEach-Object { $_.name })
    if ($labels -contains 'ai:released') { continue }
    $fragmentPath = Join-Path $FragmentRoot ("issue-{0}.md" -f $issueNumber)
    $fragmentContent = ''
    $fragmentStatus = 'missing'
    if (Test-Path $fragmentPath) {
      $fragmentContent = Get-Content -LiteralPath $fragmentPath -Encoding UTF8 -Raw
      $fragmentStatus = (Get-FragmentMetadata -Content $fragmentContent).status
    }
    if ($fragmentStatus -eq 'ready' -and !(Test-PublicNotesSection -Content $fragmentContent)) {
      $fragmentStatus = 'missing-public-notes'
    }
    $candidates.Add([pscustomobject]@{
      Number = $issueNumber
      Title = [string]$issue.title
      Url = [string]$issue.url
      ClosedAt = [string]$issue.closedAt
      FragmentPath = $fragmentPath
      FragmentStatus = $fragmentStatus
      HasBlocksReleaseLabel = ($labels -contains 'ai:blocks-release')
      Fragment = $fragmentContent
    })
  }
  return $candidates.ToArray()
}

function Get-BlockingReleaseIssues {
  param([object[]]$Candidates)
  $candidateNumbers = @($Candidates | ForEach-Object { [int]$_.Number })
  if ($candidateNumbers.Count -eq 0) { return @() }

  $issues = @(Invoke-GhJson @(
    'issue', 'list',
    '--repo', $Repository,
    '--state', 'open',
    '--label', 'ai:blocks-release',
    '--json', 'number,title,body,url',
    '--limit', '100'
  ))
  $blocking = New-Object System.Collections.Generic.List[object]
  foreach ($issue in @($issues)) {
    $body = [string]$issue.body
    $linkedParents = @($candidateNumbers | Where-Object {
      $body -match "(?im)\b(Follow-up from Issue|Original issue|Source issue)\s*:?\s*#$($_)\b"
    })
    foreach ($parent in $linkedParents) {
      $blocking.Add([pscustomobject]@{
        parent_issue = [int]$parent
        number = [int]@($issue.number)[0]
        title = [string]$issue.title
        url = [string]$issue.url
      })
    }
  }
  return $blocking.ToArray()
}

function Convert-FragmentToReleaseSection {
  param([object]$Candidate)
  $content = [string]$Candidate.Fragment
  if ([string]::IsNullOrWhiteSpace($content)) {
    return "## Issue #$($Candidate.Number) - $($Candidate.Title)`n`nMissing changelog fragment: `$($Candidate.FragmentPath)`."
  }
  $clean = $content -replace '(?s)\r?\n?<!--\s*bigbsky:changelog\s+\{.*?\}\s*-->\s*$', ''
  return $clean.Trim()
}

function New-ReleasePlan {
  $releaseTag = if ($Tag) { $Tag } else { Get-NextTag }
  $candidates = @(Get-ReleaseCandidates)
  if ($candidates.Count -eq 0) { throw 'No closed issues labeled ai:ready-for-release are available.' }
  $blockingFragments = @($candidates | Where-Object { $_.FragmentStatus -ne 'ready' })
  $blockingCandidateLabels = @($candidates | Where-Object { $_.HasBlocksReleaseLabel })
  $blockingIssues = @(Get-BlockingReleaseIssues -Candidates $candidates)

  $notes = New-Object System.Collections.Generic.List[string]
  $notes.Add("# Bigbsky $releaseTag")
  $notes.Add('')
  $notes.Add(('Target: `{0}`' -f $Target))
  $notes.Add("Generated: $(Get-Date -Format o)")
  $notes.Add('')
  $notes.Add('## Included Issues')
  $notes.Add('')
  foreach ($candidate in $candidates) {
    $notes.Add("- #$($candidate.Number) $($candidate.Title) - $($candidate.Url)")
  }
  $notes.Add('')
  if ($blockingFragments.Count -gt 0 -or $blockingCandidateLabels.Count -gt 0 -or $blockingIssues.Count -gt 0) {
    $notes.Add('## Release Blockers')
    $notes.Add('')
    foreach ($candidate in $blockingFragments) {
      $notes.Add(('- Issue #{0}: changelog fragment status is `{1}` (`{2}`).' -f $candidate.Number, $candidate.FragmentStatus, $candidate.FragmentPath))
    }
    foreach ($candidate in $blockingCandidateLabels) {
      $notes.Add(('- Issue #{0}: issue still has `ai:blocks-release`; clear only after its blocking follow-up is resolved.' -f $candidate.Number))
    }
    foreach ($issue in $blockingIssues) {
      $notes.Add(('- Issue #{0}: open release-blocking follow-up #{1}: {2} - {3}' -f $issue.parent_issue, $issue.number, $issue.title, $issue.url))
    }
    $notes.Add('')
  }
  $notes.Add('## Changes')
  $notes.Add('')
  foreach ($candidate in $candidates) {
    $notes.Add((Convert-FragmentToReleaseSection -Candidate $candidate))
    $notes.Add('')
  }
  $notes.Add('## Deploy')
  $notes.Add('')
  $notes.Add('Read `CLAUDE.md` first for the current production deploy instructions. Those instructions are the source of truth and may change over time.')
  $notes.Add('')
  $notes.Add('```powershell')
  $notes.Add("git checkout $releaseTag")
  $notes.Add('cd web')
  $notes.Add('pnpm install --frozen-lockfile')
  $notes.Add('pnpm run build')
  $notes.Add("pnpm exec wrangler pages deploy .svelte-kit/cloudflare --project-name bigbsky --branch $releaseTag")
  $notes.Add('```')
  $notes.Add('')

  $planCandidates = @($candidates | ForEach-Object {
    [pscustomobject]@{
      number = $_.Number
      title = $_.Title
      url = $_.Url
      closed_at = $_.ClosedAt
      fragment_path = $_.FragmentPath
      fragment_status = $_.FragmentStatus
    }
  })
  $planBlockingFragments = @($blockingFragments | ForEach-Object {
    [pscustomobject]@{
      number = $_.Number
      title = $_.Title
      fragment_path = $_.FragmentPath
      fragment_status = $_.FragmentStatus
    }
  })
  $planBlockingCandidateLabels = @($blockingCandidateLabels | ForEach-Object {
    [pscustomobject]@{
      number = $_.Number
      title = $_.Title
      reason = 'issue has ai:blocks-release'
    }
  })
  $planBlockingIssues = @($blockingIssues | ForEach-Object {
    [pscustomobject]@{
      parent_issue = $_.parent_issue
      number = $_.number
      title = $_.title
      url = $_.url
    }
  })

  $plan = [pscustomobject]@{
    repository = $Repository
    tag = $releaseTag
    target = $Target
    generated_at = (Get-Date -Format o)
    notes_path = (Join-Path $OutRoot 'release-notes.md')
    changelog_entry_path = (Join-Path $OutRoot 'changelog-entry.md')
    candidates = $planCandidates
    blocking_fragments = $planBlockingFragments
    blocking_candidate_labels = $planBlockingCandidateLabels
    blocking_issues = $planBlockingIssues
    can_apply = (($blockingFragments.Count -eq 0 -or $AllowUnroastedFragments) -and $blockingCandidateLabels.Count -eq 0 -and $blockingIssues.Count -eq 0)
  }
  return [pscustomobject]@{
    Plan = $plan
    Notes = ($notes -join "`n")
  }
}

function Prepare-Release {
  $result = New-ReleasePlan
  $planPath = Join-Path $OutRoot 'release-plan.json'
  $notesPath = Join-Path $OutRoot 'release-notes.md'
  Write-Utf8NoBom -Path $planPath -Content ($result.Plan | ConvertTo-Json -Depth 10)
  Write-Utf8NoBom -Path $notesPath -Content $result.Notes
  $changelogEntryPath = Write-ChangelogPreview -Plan $result.Plan -Notes $result.Notes
  Write-Host 'Prepared release plan:'
  Write-Host "  Tag:      $($result.Plan.tag)"
  Write-Host "  Notes:    $notesPath"
  Write-Host "  Changelog:$changelogEntryPath"
  Write-Host "  Plan:     $planPath"
  Write-Host "  Issues:   $($result.Plan.candidates.Count)"
  if ($result.Plan.blocking_fragments.Count -gt 0 -or $result.Plan.blocking_candidate_labels.Count -gt 0 -or $result.Plan.blocking_issues.Count -gt 0) {
    Write-Host '  Blockers: release cannot apply yet.'
    if ($result.Plan.blocking_fragments.Count -gt 0) {
      Write-Host '    Changelog fragments are not release-ready:'
    }
    foreach ($candidate in $result.Plan.blocking_fragments) {
      Write-Host "      #$($candidate.number): $($candidate.fragment_status) - $($candidate.fragment_path)"
    }
    if ($result.Plan.blocking_candidate_labels.Count -gt 0) {
      Write-Host '    Ready-for-release issues still have ai:blocks-release:'
    }
    foreach ($candidate in $result.Plan.blocking_candidate_labels) {
      Write-Host "      #$($candidate.number): $($candidate.title)"
    }
    if ($result.Plan.blocking_issues.Count -gt 0) {
      Write-Host '    Open release-blocking follow-up issues:'
    }
    foreach ($issue in $result.Plan.blocking_issues) {
      Write-Host "      parent #$($issue.parent_issue): follow-up #$($issue.number) - $($issue.title)"
    }
  } else {
    Write-Host '  Blockers: none'
  }
}

function Apply-Release {
  Assert-CleanGitTreeForRelease
  $result = New-ReleasePlan
  if (!$result.Plan.can_apply) {
    throw 'Release has blockers. Roast fragments to status ready and resolve open ai:blocks-release follow-ups before applying.'
  }
  $notesPath = Join-Path $OutRoot 'release-notes.md'
  $planPath = Join-Path $OutRoot 'release-plan.json'
  Write-Utf8NoBom -Path $notesPath -Content $result.Notes
  Write-Utf8NoBom -Path $planPath -Content ($result.Plan | ConvertTo-Json -Depth 10)
  Write-ChangelogPreview -Plan $result.Plan -Notes $result.Notes | Out-Null
  [void](Update-Changelog -Plan $result.Plan -Notes $result.Notes)
  Update-PublicChangelog
  Update-InternalChangelogArtifact
  Commit-ChangelogUpdate -Plan $result.Plan

  & $Gh release create $result.Plan.tag --repo $Repository --target $Target --title "Bigbsky $($result.Plan.tag)" --notes-file $notesPath
  if ($LASTEXITCODE -ne 0) { throw "Failed to create GitHub Release $($result.Plan.tag)." }

  foreach ($candidate in $result.Plan.candidates) {
    Invoke-GhWithRetry @('issue', 'edit', "$($candidate.number)", '--repo', $Repository, '--add-label', 'ai:released') | Out-Null
    foreach ($label in @('ai:ready-for-release', 'ai:fully-roasted', 'ai:implemented', 'ai:needs-verify', 'ai:pr-open', 'ai:claimed', 'ai:blocks-release', 'priority:urgent')) {
      Invoke-GhWithRetry @('issue', 'edit', "$($candidate.number)", '--repo', $Repository, '--remove-label', $label) 2>$null | Out-Null
    }
    Invoke-GhWithRetry @('issue', 'comment', "$($candidate.number)", '--repo', $Repository, '--body', "Workflow update: included in GitHub Release $($result.Plan.tag). Deploy with ``pnpm exec wrangler pages deploy`` from ``web/`` against branch $($result.Plan.tag) when ready.") | Out-Null
  }
  Write-Host "Created GitHub Release: $($result.Plan.tag)"
  Write-Host "Deploy command: cd web; pnpm install --frozen-lockfile; pnpm run build; pnpm exec wrangler pages deploy .svelte-kit/cloudflare --project-name bigbsky --branch $($result.Plan.tag)"
}

if ($Mode -eq 'Prepare') { Prepare-Release }
else { Apply-Release }
