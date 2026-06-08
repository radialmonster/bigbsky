param(
  [ValidateSet('Prepare', 'Apply')]
  [string]$Mode = 'Prepare',
  [string]$Repository = 'radialmonster/bigbsky-dev',
  [string]$TargetPath = '',
  [string]$ResultFile = '',
  [int]$Seed = 0
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$OutRoot = Join-Path $Root 'out\random-code-roast'
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }
New-Item -ItemType Directory -Force -Path $OutRoot | Out-Null

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function ConvertTo-Array {
  param($Value)
  if ($null -eq $Value) { return @() }
  if ($Value -is [array]) { return $Value }
  return @($Value)
}

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

function Get-RandomGenerator {
  if ($Seed -gt 0) { return [System.Random]::new($Seed) }
  return [System.Random]::new()
}

function Get-CandidateFiles {
  $tracked = @(git -C $Root ls-files)
  if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed.' }
  return @($tracked | Where-Object {
    $_ -match '^(apps|packages|infra|scripts|planning|docs)/' -and
    $_ -match '\.(ts|tsx|js|jsx|prisma|sql|ps1|md|json|yml|yaml)$' -and
    $_ -notmatch '(^|/)(node_modules|out|dist|build|coverage|\.next|changelog/archive)(/|$)' -and
    $_ -notmatch '(^|/)(package-lock\.json|pnpm-lock\.yaml)$'
  })
}

function Get-SymbolCandidates {
  param([string]$Content)
  $symbols = New-Object System.Collections.Generic.List[object]
  $lines = $Content -split '\r?\n'
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($line -match '^\s*(export\s+)?(async\s+)?function\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)') {
      $symbols.Add([pscustomobject]@{ kind = 'function'; name = $Matches.name; line = $i + 1 })
    } elseif ($line -match '^\s*(export\s+)?class\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)') {
      $symbols.Add([pscustomobject]@{ kind = 'class'; name = $Matches.name; line = $i + 1 })
    } elseif ($line -match '^\s*(export\s+)?const\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*=') {
      $symbols.Add([pscustomobject]@{ kind = 'const'; name = $Matches.name; line = $i + 1 })
    } elseif ($line -match '^\s*@(?:Get|Post|Put|Patch|Delete)\(') {
      $symbols.Add([pscustomobject]@{ kind = 'api-route-handler'; name = $line.Trim(); line = $i + 1 })
    }
  }
  return $symbols.ToArray()
}

function Convert-PagePathToUrl {
  param([string]$Path)
  if ($Path -notmatch '^apps/web/src/app/(.+)/(page|layout)\.tsx$') { return '' }
  $route = $Matches[1]
  $route = $route -replace '\([^)]+\)/', ''
  $route = $route -replace '\[([^\]]+)\]', ':$1'
  $route = $route.Trim('/')
  if ([string]::IsNullOrWhiteSpace($route)) { return '/' }
  return "/$route"
}

function Get-RelatedSearch {
  param([string]$Term)
  if ([string]::IsNullOrWhiteSpace($Term)) { return @() }
  try {
    return @(& rg --fixed-strings --line-number --glob '!node_modules' --glob '!out/**' --glob '!changelog/internal/CHANGELOG.md' $Term $Root 2>$null | Select-Object -First 80)
  } catch {
    return @()
  }
}

function Get-OpenIssueContext {
  $issues = @(Invoke-GhJson @(
    'issue', 'list',
    '--repo', $Repository,
    '--state', 'open',
    '--json', 'number,title,labels,url',
    '--limit', '100'
  ))
  return @($issues | Sort-Object number | ForEach-Object {
    $labels = (@($_.labels | ForEach-Object { $_.name }) -join ', ')
    "#$($_.number): $($_.title) [$labels] $($_.url)"
  })
}

function New-RandomRoastPrompt {
  param(
    [object]$Target,
    [string]$Content,
    [object[]]$Symbols,
    [string[]]$RelatedSearch,
    [string[]]$OpenIssues
  )

  $symbolText = if ($Symbols.Count -gt 0) {
    ($Symbols | ForEach-Object { "- $($_.kind) `$($_.name)` line $($_.line)" }) -join "`n"
  } else {
    'No obvious symbols found by lightweight scan.'
  }
  $searchText = if ($RelatedSearch.Count -gt 0) { $RelatedSearch -join "`n" } else { 'No related search results.' }
  $issueText = if ($OpenIssues.Count -gt 0) { $OpenIssues -join "`n" } else { 'No open issues returned.' }

  return @"
You are running Bigbsky random code roast from the current repo/worktree.

Goal:
- Deeply inspect the randomly selected target below.
- Look for real product, workflow, security, data integrity, permission, tenant isolation, billing, inventory, UX, test, deploy, or maintainability risks.
- Create GitHub Issues only for concrete, actionable findings.
- Do not edit application code.
- Do not create duplicate issues. If an open issue already covers the same finding, return that issue number and a short comment/update instead of creating a duplicate.

Return JSON only:

~~~json
{
  "target": {
    "kind": "$($Target.kind)",
    "path": "$($Target.path)",
    "symbol": "$($Target.symbol)",
    "line": $($Target.line),
    "url": "$($Target.url)"
  },
  "summary": "short neutral summary of what was roasted",
  "findings": [
    {
      "create_issue": true,
      "existing_issue_number": 0,
      "issue_type": "Bug",
      "planning_horizon": "short-term",
      "title": "Concise issue title",
      "body": "Complete Markdown issue body",
      "labels": ["ai:needs-roast"],
      "comment": ""
    }
  ]
}
~~~

Rules:
- ``issue_type`` must be ``Bug``, ``Feature``, or ``Task``.
- ``planning_horizon`` must be ``short-term`` or ``long-term``.
- Every created issue must include ``ai:needs-roast``.
- Use ``Bug`` for broken behavior, security/data/permission regressions, missing required verification, or code that likely fails.
- Use ``Feature`` for new user-facing capabilities discovered by the roast.
- Use ``Task`` for refactors, tests, docs/spec drift, workflow automation, migrations, or investigations.
- Issue bodies must include: Problem, Evidence, Proposed approach, Acceptance criteria, Likely files/areas, Risks/edge cases, Verification.
- Mention this random roast target in the issue body.
- Create an issue for every real finding, regardless of severity or priority. Do not skip findings because they seem minor.
- Only skip a finding if it is purely informational with no action possible (e.g. explaining existing behavior that is intentional and correct).
- ``short-term``: concrete buildable fix, bug, missing constraint, test gap, spec drift, or small improvement — use this for the vast majority of findings regardless of how minor they are.
- ``long-term``: broad strategy, large engine work, future integrations, or work blocked by a major unresolved foundation decision.
- If no issues are warranted, return an empty ``findings`` array.
- Use neutral language. Do not say "I found".

# Random Target

Kind: $($Target.kind)
Path: ``$($Target.path)``
Symbol: ``$($Target.symbol)``
Line: $($Target.line)
URL: $($Target.url)

# Symbols Detected

$symbolText

# Target File Content

~~~text
$Content
~~~

# Related Search Results

~~~text
$searchText
~~~

# Open Issues For Duplicate Check

~~~text
$issueText
~~~
"@
}

function Prepare-RandomRoast {
  $rng = Get-RandomGenerator
  $files = @(Get-CandidateFiles)
  if ($files.Count -eq 0) { throw 'No candidate files found for random code roast.' }
  $relativePath = if (![string]::IsNullOrWhiteSpace($TargetPath)) {
    $TargetPath -replace '\\', '/'
  } else {
    $files[$rng.Next(0, $files.Count)]
  }
  if ($files -notcontains $relativePath -and !(Test-Path (Join-Path $Root $relativePath))) {
    throw "TargetPath is not a tracked candidate file: $relativePath"
  }

  $fullPath = Join-Path $Root ($relativePath -replace '/', '\')
  $content = Get-Content -LiteralPath $fullPath -Encoding UTF8 -Raw
  $symbols = @(Get-SymbolCandidates -Content $content)
  $selectedSymbol = $null
  if ($symbols.Count -gt 0) { $selectedSymbol = $symbols[$rng.Next(0, $symbols.Count)] }
  $url = Convert-PagePathToUrl -Path $relativePath
  $targetKind = if ($url) { 'url' } elseif ($selectedSymbol) { $selectedSymbol.kind } else { 'file' }
  $symbolName = if ($selectedSymbol) { [string]$selectedSymbol.name } else { '' }
  $line = if ($selectedSymbol) { [int]$selectedSymbol.line } else { 1 }
  $searchTerm = if ($symbolName -and $symbolName.Length -lt 120) { $symbolName } else { [System.IO.Path]::GetFileNameWithoutExtension($relativePath) }
  $relatedSearch = @(Get-RelatedSearch -Term $searchTerm)
  $openIssues = @(Get-OpenIssueContext)
  $target = [pscustomobject]@{
    kind = $targetKind
    path = $relativePath
    symbol = $symbolName
    line = $line
    url = $url
  }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $safeName = (($relativePath -replace '[^A-Za-z0-9._-]', '-') -replace '-+', '-').Trim('-')
  if ($safeName.Length -gt 80) { $safeName = $safeName.Substring(0, 80) }
  $dir = Join-Path $OutRoot "$stamp-$safeName"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $promptPath = Join-Path $dir 'prompt.md'
  $resultPath = Join-Path $dir 'result.json'
  $metadataPath = Join-Path $dir 'metadata.json'
  $prompt = New-RandomRoastPrompt -Target $target -Content $content -Symbols $symbols -RelatedSearch $relatedSearch -OpenIssues $openIssues
  Write-Utf8NoBom -Path $promptPath -Content $prompt
  Write-Utf8NoBom -Path $resultPath -Content (@{
    target = $target
    summary = ''
    findings = @()
  } | ConvertTo-Json -Depth 8)
  Write-Utf8NoBom -Path $metadataPath -Content (@{
    repository = $Repository
    generated_at = (Get-Date -Format o)
    prompt_path = $promptPath
    result_path = $resultPath
    target = $target
    seed = $Seed
  } | ConvertTo-Json -Depth 8)

  Write-Host 'Prepared random code roast bundle:'
  Write-Host "  Target: $($target.kind) $($target.path) $($target.symbol)"
  Write-Host "  Prompt: $promptPath"
  Write-Host "  Result: $resultPath"
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
  if ($LASTEXITCODE -ne 0) { throw "Failed to set issue #$IssueNumber type to $Type." }
}

function Get-IssueNumberFromUrl {
  param([string]$Url)
  if ($Url -match '/issues/(?<n>\d+)$') { return [int]$Matches.n }
  return 0
}

function Apply-RandomRoast {
  if ([string]::IsNullOrWhiteSpace($ResultFile)) {
    $latest = Get-ChildItem -Path $OutRoot -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (!$latest) { throw 'No random code roast output directory found.' }
    $ResultFile = Join-Path $latest.FullName 'result.json'
  }
  if (!(Test-Path $ResultFile)) { throw "Result file not found: $ResultFile" }
  $result = Get-Content -LiteralPath $ResultFile -Encoding UTF8 -Raw | ConvertFrom-Json
  $findings = @(ConvertTo-Array $result.findings)
  if ($findings.Count -eq 0) {
    Write-Host 'Random code roast produced no issue-worthy findings.'
    return
  }

  $created = New-Object System.Collections.Generic.List[string]
  foreach ($finding in $findings) {
    $existing = 0
    if ($finding.PSObject.Properties['existing_issue_number'] -and $finding.existing_issue_number) {
      $existing = [int]$finding.existing_issue_number
    }
    if ($existing -gt 0) {
      if (![string]::IsNullOrWhiteSpace([string]$finding.comment)) {
        & $Gh issue comment $existing --repo $Repository --body ([string]$finding.comment) | Out-Null
      }
      & $Gh issue edit $existing --repo $Repository --add-label 'ai:needs-roast' | Out-Null
      $created.Add("updated existing #$existing")
      continue
    }
    if ($finding.create_issue -ne $true) { continue }
    if ([string]::IsNullOrWhiteSpace([string]$finding.title)) { throw 'Finding title is required when create_issue is true.' }
    if ([string]::IsNullOrWhiteSpace([string]$finding.body)) { throw "Finding body is required for '$($finding.title)'." }
    $issueType = [string]$finding.issue_type
    if (@('Bug', 'Feature', 'Task') -notcontains $issueType) { throw "Invalid issue_type '$issueType' for '$($finding.title)'." }
    $horizon = [string]$finding.planning_horizon
    if (@('short-term', 'long-term') -notcontains $horizon) { throw "Invalid planning_horizon '$horizon' for '$($finding.title)'." }
    $labels = @('ai:needs-roast', $horizon)
    foreach ($label in @(ConvertTo-Array $finding.labels)) {
      $labelText = [string]$label
      if (![string]::IsNullOrWhiteSpace($labelText) -and ($labels -notcontains $labelText)) { $labels += $labelText }
    }
    if ($labels -notcontains 'ai:needs-roast') { $labels += 'ai:needs-roast' }

    $bodyPath = Join-Path (Split-Path -Parent $ResultFile) ('issue-body-{0}.md' -f ([guid]::NewGuid().ToString('N')))
    Write-Utf8NoBom -Path $bodyPath -Content ([string]$finding.body)
    $args = @('issue', 'create', '--repo', $Repository, '--title', [string]$finding.title, '--body-file', $bodyPath)
    foreach ($label in $labels) { $args += @('--label', $label) }
    $url = & $Gh @args
    if ($LASTEXITCODE -ne 0) { throw "Failed to create GitHub issue for '$($finding.title)'." }
    $number = Get-IssueNumberFromUrl -Url ([string]$url)
    if ($number -gt 0) { Set-GitHubIssueType -IssueNumber $number -Type $issueType }
    $created.Add("$url")
  }

  Write-Host 'Random code roast applied:'
  foreach ($item in $created) { Write-Host "  $item" }
}

if ($Mode -eq 'Prepare') { Prepare-RandomRoast }
else { Apply-RandomRoast }
