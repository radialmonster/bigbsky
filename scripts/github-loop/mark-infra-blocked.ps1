param(
  [string]$Repository = 'radialmonster/bigbsky-dev',
  [string]$Reason = 'Workflow infrastructure blocked execution.',
  [string]$OutRoot = ''
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
if (!$OutRoot) { $OutRoot = Join-Path $Root 'out' }
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }

function Get-LatestClaimedMetadata {
  $files = @(Get-ChildItem -Path $OutRoot -Recurse -Filter metadata.json -File -ErrorAction SilentlyContinue)
  foreach ($file in ($files | Sort-Object LastWriteTime -Descending)) {
    try {
      $metadata = Get-Content -LiteralPath $file.FullName -Encoding UTF8 -Raw | ConvertFrom-Json
      if ($metadata.claimed -eq $true -and $metadata.issue_number) {
        $issueNumber = [int]$metadata.issue_number
        $issue = & $Gh issue view $issueNumber --repo $Repository --json labels | ConvertFrom-Json
        $labels = @($issue.labels | ForEach-Object { $_.name })
        if ($labels -contains 'ai:claimed') {
          return [pscustomobject]@{
            Path = $file.FullName
            Metadata = $metadata
          }
        }
      }
    } catch {}
  }
  return $null
}

function Get-RedactedReason {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return 'Workflow infrastructure blocked execution.' }
  $redacted = $Text
  $redacted = $redacted -replace '(?i)(api[_-]?key|auth[_-]?token|access[_-]?token|secret|password)(\s*[=:]\s*)\S+', '$1$2[redacted]'
  $redacted = $redacted -replace '(?i)(bearer\s+)[A-Za-z0-9._~+/-]+=*', '$1[redacted]'
  $redacted = $redacted -replace '(?i)(sk-[A-Za-z0-9_-]{12,})', '[redacted-token]'
  $redacted = ($redacted -split "`r?`n" | Select-Object -First 12) -join "`n"
  if ($redacted.Length -gt 2000) {
    $redacted = $redacted.Substring(0, 2000).TrimEnd() + "`n..."
  }
  return $redacted
}

$claimed = Get-LatestClaimedMetadata
if (!$claimed) {
  Write-Host 'No claimed GitHub issue metadata found to mark infra-blocked.'
  exit 0
}

$issueNumber = [int]$claimed.Metadata.issue_number
$safeReason = Get-RedactedReason -Text $Reason
$commentTemplate = @'
Workflow update: infrastructure blocked this loop run.

Reason: {0}

No product decision, implementation failure, or verification failure was recorded. The workflow released the active claim and marked this issue `ai:infra-blocked` so it does not get repeatedly claimed until the model/provider/tooling problem is retried deliberately.
'@
$comment = [string]::Format($commentTemplate, $safeReason)

& $Gh issue edit $issueNumber --repo $Repository --add-label 'ai:infra-blocked' --remove-label 'ai:claimed' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to mark issue #$issueNumber ai:infra-blocked and release claim." }
& $Gh issue comment $issueNumber --repo $Repository --body $comment | Out-Null
Write-Host "Marked issue #$issueNumber ai:infra-blocked from $($claimed.Path)."
