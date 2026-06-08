# init-template.ps1 -- substitute {{TOKEN}} placeholders throughout the
# loop scaffolding with values from template.config.json. Idempotent: if
# a token has no remaining occurrences, that's fine.
#
# Usage:
#   1. Edit template.config.json with your project's values.
#   2. pwsh -NoProfile -ExecutionPolicy Bypass -File .\init-template.ps1
#
# Flags:
#   -ConfigPath <path>   Use a different config file (default: ./template.config.json)
#   -DryRun              Show what would change without writing.
#   -Force               Skip the "are you sure?" prompt.

[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'template.config.json'),
  [string]$Root       = $PSScriptRoot,
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  Write-Error "Config not found: $ConfigPath"
  exit 1
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json

# Required token list (must match the tokens introduced by sweep-to-tokens.ps1).
$requiredTokens = @(
  'PROJECT_NAME',
  'PROJECT_NAME_PASCAL',
  'PROJECT_NAME_UPPER',
  'GITHUB_OWNER',
  'GITHUB_REPO'
)

$missing = @()
foreach ($t in $requiredTokens) {
  $val = $config.$t
  if ([string]::IsNullOrWhiteSpace($val)) { $missing += $t }
}
if ($missing.Count -gt 0) {
  Write-Error "template.config.json is missing values for: $($missing -join ', ')"
  exit 1
}

Write-Host 'Token values to apply:' -ForegroundColor Cyan
foreach ($t in $requiredTokens) {
  Write-Host ('  {0,-22} = {1}' -f $t, $config.$t)
}
Write-Host ''

if (-not $Force -and -not $DryRun) {
  $resp = Read-Host 'Proceed with substitution? [y/N]'
  if ($resp -notmatch '^(?i:y|yes)$') {
    Write-Host 'Aborted.'
    exit 0
  }
}

$extensions = @('.ps1', '.psm1', '.py', '.bat', '.cmd', '.txt', '.md', '.json', '.yml', '.yaml')

$files = Get-ChildItem -Path $Root -Recurse -File | Where-Object {
  $extensions -contains $_.Extension.ToLower() -and
  $_.FullName -notlike '*\node_modules\*' -and
  $_.FullName -notlike '*\.git\*' -and
  $_.Name -ne 'template.config.json' -and
  $_.FullName -notlike '*\scripts\template\*'
}

$changed = 0
foreach ($file in $files) {
  $content = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
  if ($null -eq $content) { continue }
  $original = $content
  foreach ($t in $requiredTokens) {
    $content = $content.Replace('{{' + $t + '}}', [string]$config.$t)
  }
  if ($content -ne $original) {
    $rel = $file.FullName.Substring($Root.Length + 1)
    if ($DryRun) {
      Write-Host "would update: $rel"
    } else {
      [System.IO.File]::WriteAllText($file.FullName, $content, [System.Text.UTF8Encoding]::new($false))
      Write-Host "updated: $rel"
    }
    $changed++
  }
}

Write-Host ''
if ($DryRun) {
  Write-Host "$changed file(s) would change. (dry run)"
} else {
  Write-Host "$changed file(s) updated."
}
