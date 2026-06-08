param(
  [string]$Repository = 'radialmonster/bigbsky-dev',
  [switch]$CommentCandidates
)

$ErrorActionPreference = 'Stop'
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }

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

function Get-NativeIssueDependencies {
  param(
    [int]$IssueNumber,
    [ValidateSet('blocked_by', 'blocking')]
    [string]$Direction
  )
  $repo = Get-RepositoryParts
  $raw = & $Gh api `
    --header 'Accept: application/vnd.github+json' `
    --header 'X-GitHub-Api-Version: 2026-03-10' `
    "repos/$($repo.Owner)/$($repo.Name)/issues/$IssueNumber/dependencies/$Direction" 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { return @() }
  return @(ConvertTo-Array ($raw | ConvertFrom-Json))
}

function Find-Issue {
  param([object[]]$Issues, [string]$Pattern)
  return @($Issues | Where-Object { $_.title -match $Pattern } | Sort-Object number | Select-Object -First 1)
}

function New-Candidate {
  param(
    [object]$Blocked,
    [object]$Blocker,
    [ValidateSet('blocked_by', 'related')]
    [string]$Kind,
    [ValidateSet('high', 'medium', 'low')]
    [string]$Confidence,
    [string]$Reason
  )
  if (!$Blocked -or !$Blocker) { return $null }
  if ([int]$Blocked.number -eq [int]$Blocker.number) { return $null }
  return [pscustomobject]@{
    blocked = [int]$Blocked.number
    blocker = [int]$Blocker.number
    kind = $Kind
    confidence = $Confidence
    blocked_title = [string]$Blocked.title
    blocker_title = [string]$Blocker.title
    reason = $Reason
  }
}

$issues = @(ConvertTo-Array (Invoke-GhJson @(
  'issue', 'list',
  '--repo', $Repository,
  '--state', 'open',
  '--json', 'number,title,body,labels,url,createdAt',
  '--limit', '200'
)))

$candidates = New-Object System.Collections.Generic.List[object]

function Add-Candidate {
  param($Blocked, $Blocker, $Kind, $Confidence, $Reason)
  $candidate = New-Candidate -Blocked $Blocked -Blocker $Blocker -Kind $Kind -Confidence $Confidence -Reason $Reason
  if ($candidate) { $script:candidates.Add($candidate) }
}

$vendorContract = Find-Issue $issues 'vendor catalog import contract'
Add-Candidate (Find-Issue $issues 'encrypted tenant vendor integration credentials') $vendorContract 'blocked_by' 'high' 'Credential storage should follow the vendor integration contract shape.'

$ticketBackend = Find-Issue $issues 'ticket work-source source-set and invoice links'
Add-Candidate (Find-Issue $issues 'ticket work-source UI|backend rollup') $ticketBackend 'blocked_by' 'high' 'UI on backend rollup requires source-set/backend links first.'
Add-Candidate (Find-Issue $issues 'ticket work-source invoice regression coverage') $ticketBackend 'blocked_by' 'high' 'Regression coverage references source-link/reservation models from backend slice.'
Add-Candidate (Find-Issue $issues 'reserved ticket item review dashboard') $ticketBackend 'blocked_by' 'medium' 'Reserved ticket item review likely needs work-source/reservation backend identity first.'

$storageContract = Find-Issue $issues 'file and media storage provider contract'
$providerStorage = Find-Issue $issues 'provider-backed storage'
$mediaGalleries = Find-Issue $issues 'media galleries'
Add-Candidate $providerStorage $storageContract 'blocked_by' 'high' 'Provider-backed storage implementation depends on storage provider contract.'
Add-Candidate $mediaGalleries $storageContract 'blocked_by' 'high' 'Media galleries need storage/upload contract first.'
Add-Candidate $mediaGalleries $providerStorage 'blocked_by' 'medium' 'Media galleries may need provider-backed artifact writes before upload UI.'
Add-Candidate (Find-Issue $issues 'platform catalog storage, staging, and import-media') $storageContract 'blocked_by' 'medium' 'Import-media implementation likely depends on storage provider contract.'

$platformStorage = Find-Issue $issues 'platform catalog storage, staging, and import-media'
$tenantCatalog = Find-Issue $issues 'tenants create or link items from approved platform catalog suggestions'
Add-Candidate $tenantCatalog $platformStorage 'blocked_by' 'high' 'Tenant create/link needs approved platform catalog persistence/staging first.'
Add-Candidate $tenantCatalog (Find-Issue $issues 'tenant-safe platform catalog projection') 'blocked_by' 'medium' 'Tenant UI/import likely depends on tenant-safe catalog projection.'
Add-Candidate (Find-Issue $issues 'platform catalog overview readiness') $platformStorage 'related' 'medium' 'Overview readiness and queue counts are tied to platform catalog storage/staging.'

$paymentAbstraction = Find-Issue $issues 'tenant payment provider abstraction'
Add-Candidate (Find-Issue $issues 'POS integrated-payment checkout atomic') $paymentAbstraction 'blocked_by' 'medium' 'Integrated POS payment behavior should align with provider abstraction.'
Add-Candidate (Find-Issue $issues 'recurring-invoice auto-charge') $paymentAbstraction 'blocked_by' 'medium' 'Auto-charge/reminders depend on provider abstraction decisions.'
Add-Candidate (Find-Issue $issues 'Stripe portal invoice settlement') $paymentAbstraction 'related' 'low' 'Stripe settlement is payment-provider related but may be independently fixable.'
Add-Candidate (Find-Issue $issues 'payment surcharges') $paymentAbstraction 'related' 'low' 'Surcharges touch payment recording but may not require provider abstraction first.'
Add-Candidate (Find-Issue $issues 'apply_store_credit') $paymentAbstraction 'related' 'low' 'Store credit is payment application but not necessarily provider-dependent.'

$standaloneInvoice = Find-Issue $issues 'standalone invoice creation server-authoritative'
Add-Candidate (Find-Issue $issues 'shipping fee invoice-line') $standaloneInvoice 'related' 'medium' 'Shipping fee invoice-line rules affect server-authoritative invoice totals/tax.'
Add-Candidate (Find-Issue $issues 'outstanding invoice filters') $standaloneInvoice 'related' 'low' 'Invoice status/balance behavior may overlap with authoritative invoice model.'
Add-Candidate (Find-Issue $issues 'manual invoice reminders') $standaloneInvoice 'related' 'low' 'Reminder outcomes depend on invoice state but likely independent.'

$poPutaway = Find-Issue $issues 'PO receive-time put-away'
$poBarcode = Find-Issue $issues 'PO receiving barcode scans'
Add-Candidate $poPutaway $poBarcode 'related' 'medium' 'Receiving barcode identity and put-away stock state overlap in receiving workflow.'
Add-Candidate (Find-Issue $issues 'PO backorder workbench') $poPutaway 'related' 'low' 'Backorder workbench and receive-time put-away both touch PO line state.'
Add-Candidate (Find-Issue $issues 'drop-ship PO source links') (Find-Issue $issues 'drop-ship confirmation') 'related' 'medium' 'Drop-ship source-link identity and delivery-proof path likely share data model.'
Add-Candidate (Find-Issue $issues 'carrier tracking webhooks') (Find-Issue $issues 'drop-ship confirmation') 'related' 'low' 'Carrier tracking and delivery proof are shipping-adjacent but likely independent.'

Add-Candidate (Find-Issue $issues 'stock-count history filters') (Find-Issue $issues 'stock-count reconciliation reason') 'related' 'medium' 'Stock-count history and reconciliation reason evidence are same stock-count workflow.'
Add-Candidate (Find-Issue $issues 'item availability guidance') (Find-Issue $issues 'inventory movement ledger') 'related' 'medium' 'Availability guidance should agree with audit-grade movement ledger totals.'
Add-Candidate (Find-Issue $issues 'item price history') (Find-Issue $issues 'inventory movement ledger') 'related' 'low' 'Price history and movement ledger are inventory reporting adjacent, not obvious blockers.'

$notificationRetry = Find-Issue $issues 'notification-log retry'
Add-Candidate $notificationRetry (Find-Issue $issues 'manual invoice reminders') 'related' 'medium' 'Both address durable notification/send outcomes and retry evidence.'
Add-Candidate (Find-Issue $issues 'customer-reply triage acknowledgement') $notificationRetry 'related' 'low' 'Acknowledgement and retry are notification audit/race-safe concerns.'
Add-Candidate (Find-Issue $issues 'email unsubscribe') $notificationRetry 'related' 'low' 'Unsubscribe and retry both touch notification safety but likely independent.'
Add-Candidate (Find-Issue $issues 'outbound webhook delivery attempts') $notificationRetry 'related' 'low' 'Webhook delivery attempts parallel notification retry evidence but not a blocker.'

Add-Candidate (Find-Issue $issues 'dedicated assignment permission') (Find-Issue $issues 'permission-scoped global search') 'related' 'low' 'Both touch permission boundaries, but features differ.'
Add-Candidate (Find-Issue $issues 'AI capability flags') (Find-Issue $issues 'tenant capability reads') 'related' 'medium' 'AI capability flags should respect tenant capability read/write boundary.'
Add-Candidate (Find-Issue $issues 'tenant security settings') (Find-Issue $issues 'tenant capability reads') 'related' 'low' 'Tenant/platform setting split resembles capability ownership boundary.'

$existing = New-Object System.Collections.Generic.List[object]
foreach ($issue in $issues) {
  $blockers = @(Get-NativeIssueDependencies -IssueNumber ([int]$issue.number) -Direction 'blocked_by' | Where-Object { $_.state -eq 'open' })
  foreach ($blocker in $blockers) {
    $existing.Add([pscustomobject]@{
      blocked = [int]$issue.number
      blocker = [int]$blocker.number
      blocked_title = [string]$issue.title
      blocker_title = [string]$blocker.title
    })
  }
}

$candidateRows = @($candidates | Sort-Object @{ Expression = { @{ high = 0; medium = 1; low = 2 }[$_.confidence] } }, blocker, blocked)

Write-Host "Open issues audited: $($issues.Count)"
Write-Host ''
Write-Host 'Existing open native blockers:'
if ($existing.Count -eq 0) {
  Write-Host '  none'
} else {
  $existing | Sort-Object blocked | Format-Table -AutoSize | Out-String -Width 260 | Write-Host
}

Write-Host ''
Write-Host 'Candidate relationships from title audit:'
if ($candidateRows.Count -eq 0) {
  Write-Host '  none'
} else {
  $candidateRows | Format-Table blocked, blocker, kind, confidence, reason -AutoSize | Out-String -Width 260 | Write-Host
}

if ($CommentCandidates) {
  $existingPairs = @{}
  foreach ($pair in $existing) {
    $existingPairs["$($pair.blocked):$($pair.blocker)"] = $true
  }

  $commented = 0
  $candidateComments = @($candidateRows | Where-Object {
    $_.kind -eq 'blocked_by' -and
    @('high', 'medium') -contains $_.confidence -and
    -not $existingPairs.ContainsKey("$($_.blocked):$($_.blocker)")
  })

  foreach ($candidate in $candidateComments) {
    $marker = "<!-- bigbsky:relationship-audit {`"candidate_blocker`":$($candidate.blocker)} -->"
    $issue = Invoke-GhJson @(
      'issue', 'view', "$($candidate.blocked)",
      '--repo', $Repository,
      '--json', 'comments'
    )
    $alreadyCommented = @($issue.comments | Where-Object { [string]$_.body -match [regex]::Escape($marker) }).Count -gt 0
    if ($alreadyCommented) { continue }

    $body = @"
Workflow relationship audit: this issue may be blocked by #$($candidate.blocker).

Reason: $($candidate.reason)

The next issue-roast pass should verify this. If confirmed, it should add the native GitHub ``blocked by`` relationship, add ``ai:blocked``, and keep or add ``ai:needs-roast`` so the issue is refreshed after the blocker is resolved. If not confirmed, it should record why this is only related or independent.

$marker
"@
    & $Gh issue comment $candidate.blocked --repo $Repository --body $body | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to comment relationship candidate on issue #$($candidate.blocked)." }
    $commented++
  }

  Write-Host ''
  Write-Host "Relationship audit comments added: $commented"
}
