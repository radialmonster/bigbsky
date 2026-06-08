param(
  [string]$ProjectName = "bigbsky",
  [string]$Domain = "bigbsky.com",
  [string]$ProductionBranch = "main",
  [switch]$IncludeWww
)

$ErrorActionPreference = "Stop"

$token = $env:CLOUDFLARE_API_TOKEN
if (-not $token) {
  $token = $env:CF_API_TOKEN
}

if (-not $token) {
  throw "Set CLOUDFLARE_API_TOKEN or CF_API_TOKEN before running this script."
}

$baseUrl = "https://api.cloudflare.com/client/v4"
$headers = @{
  "Authorization" = "Bearer $token"
  "Content-Type" = "application/json"
}

function Invoke-CloudflareApi {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [object]$Body = $null,
    [switch]$AllowNotFound
  )

  $uri = "$baseUrl$Path"
  try {
    if ($null -eq $Body) {
      return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
    }

    $json = $Body | ConvertTo-Json -Depth 20
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -Body $json
  } catch {
    $statusCode = $null
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }

    if ($AllowNotFound -and $statusCode -eq 404) {
      return $null
    }

    throw
  }
}

function Assert-Success {
  param(
    [Parameter(Mandatory = $true)]$Response,
    [Parameter(Mandatory = $true)][string]$Action
  )

  if (-not $Response.success) {
    $messages = @()
    if ($Response.errors) {
      $messages += $Response.errors | ForEach-Object { "$($_.code): $($_.message)" }
    }
    if ($Response.messages) {
      $messages += $Response.messages | ForEach-Object { "$($_.code): $($_.message)" }
    }
    throw "$Action failed. $($messages -join '; ')"
  }
}

Write-Host "Looking up Cloudflare zone for $Domain..."
$zoneResponse = Invoke-CloudflareApi -Method "GET" -Path "/zones?name=$([uri]::EscapeDataString($Domain))"
Assert-Success -Response $zoneResponse -Action "Zone lookup"

if (-not $zoneResponse.result -or $zoneResponse.result.Count -lt 1) {
  throw "No Cloudflare zone named $Domain was found for this token."
}

$zone = $zoneResponse.result[0]
$zoneId = $zone.id
$accountId = $env:CLOUDFLARE_ACCOUNT_ID
if (-not $accountId) {
  $accountId = $env:CF_ACCOUNT_ID
}
if (-not $accountId) {
  $accountId = $zone.account.id
}

Write-Host "Using account $accountId and zone $zoneId ($($zone.status))."

$projectPath = "/accounts/$accountId/pages/projects/$ProjectName"
$projectResponse = Invoke-CloudflareApi -Method "GET" -Path $projectPath -AllowNotFound

if ($null -eq $projectResponse) {
  Write-Host "Creating Pages project $ProjectName..."
  $projectBody = @{
    name = $ProjectName
    production_branch = $ProductionBranch
    build_config = @{
      build_command = "npm run build"
      destination_dir = "dist"
      root_dir = ""
      build_caching = $true
    }
  }
  $projectResponse = Invoke-CloudflareApi -Method "POST" -Path "/accounts/$accountId/pages/projects" -Body $projectBody
  Assert-Success -Response $projectResponse -Action "Create Pages project"
} else {
  Assert-Success -Response $projectResponse -Action "Get Pages project"
  Write-Host "Pages project $ProjectName already exists."
}

$project = $projectResponse.result
$pagesHost = $project.subdomain
if ($pagesHost -and -not $pagesHost.EndsWith(".pages.dev")) {
  $pagesHost = "$pagesHost.pages.dev"
}
Write-Host "Pages project: $($project.name) -> https://$pagesHost"

$domainsToAttach = @($Domain)
if ($IncludeWww) {
  $domainsToAttach += "www.$Domain"
}

foreach ($domainName in $domainsToAttach) {
  $encodedDomain = [uri]::EscapeDataString($domainName)
  $domainPath = "/accounts/$accountId/pages/projects/$ProjectName/domains/$encodedDomain"
  $domainResponse = Invoke-CloudflareApi -Method "GET" -Path $domainPath -AllowNotFound

  if ($null -eq $domainResponse) {
    Write-Host "Attaching custom domain $domainName..."
    $domainResponse = Invoke-CloudflareApi -Method "POST" -Path "/accounts/$accountId/pages/projects/$ProjectName/domains" -Body @{ name = $domainName }
    Assert-Success -Response $domainResponse -Action "Attach custom domain $domainName"
  } else {
    Assert-Success -Response $domainResponse -Action "Get custom domain $domainName"
    Write-Host "Custom domain $domainName is already attached."
  }

  $attached = $domainResponse.result
  Write-Host "Domain $($attached.name): status=$($attached.status), verification=$($attached.verification_data.status), validation=$($attached.validation_data.status)"
}

Write-Host ""
Write-Host "Done. If the domain is pending, wait for Cloudflare DNS/certificate validation and re-run this script to check status."
