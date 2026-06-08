# sweep-to-tokens.ps1 -- one-shot script that replaces repairforge-specific
# strings with template tokens. Intended to be run ONCE on a fresh copy of
# the loop scaffolding to convert it into a generic template. After running,
# the working tree should contain only {{TOKEN}} placeholders; use
# init-template.ps1 to substitute real values for a specific project.
#
# Safe to re-run -- replacements are idempotent (already-tokenised tree is
# a no-op).

[CmdletBinding()]
param(
  [string]$Root = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
)

$ErrorActionPreference = 'Stop'

# Ordered: most-specific first so substrings don't get half-replaced.
$replacements = @(
  @{ From = 'radialmonster/repairforge-github-workflow'; To = '{{GITHUB_OWNER}}/{{GITHUB_REPO}}' }
  @{ From = 'github.com-repairforge-workflow';       To = '{{SSH_GIT_ALIAS}}' }
  @{ From = 'repairforge-github-workflow';           To = '{{GITHUB_REPO}}' }
  @{ From = 'repairforge-web-latest.tar';            To = '{{WEB_TAR_NAME}}' }
  @{ From = 'repairforge.app';                       To = '{{SSH_HOST}}' }
  @{ From = '/opt/repairforge';                      To = '{{DEPLOY_REMOTE_ROOT}}' }
  @{ From = '@repairforge/api';                      To = '{{PNPM_API_PACKAGE}}' }
  @{ From = 'REPAIRFORGE_';                          To = '{{PROJECT_NAME_UPPER}}_' }
  @{ From = 'RepairForge';                           To = '{{PROJECT_NAME_PASCAL}}' }
  @{ From = 'REPAIRFORGE';                           To = '{{PROJECT_NAME_UPPER}}' }
  @{ From = 'repairforge';                           To = '{{PROJECT_NAME}}' }
)

$extensions = @('.ps1', '.psm1', '.py', '.bat', '.cmd', '.txt', '.md', '.json', '.yml', '.yaml')

$files = Get-ChildItem -Path $Root -Recurse -File | Where-Object {
  $extensions -contains $_.Extension.ToLower() -and
  $_.FullName -notlike '*\node_modules\*' -and
  $_.FullName -notlike '*\.git\*' -and
  $_.FullName -notlike '*\scripts\template\*'
}

$changed = 0
foreach ($file in $files) {
  $content = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
  if ($null -eq $content) { continue }
  $original = $content
  foreach ($r in $replacements) {
    $content = $content.Replace($r.From, $r.To)
  }
  if ($content -ne $original) {
    # Preserve no-BOM UTF8.
    [System.IO.File]::WriteAllText($file.FullName, $content, [System.Text.UTF8Encoding]::new($false))
    Write-Host "tokenised: $($file.FullName.Substring($Root.Length + 1))"
    $changed++
  }
}

Write-Host ""
Write-Host "Done. $changed file(s) changed."
