param(
  [string]$Repository = 'radialmonster/bigbsky-dev',
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }

function Invoke-GhJson {
  param([string[]]$CliArgs)
  $raw = & $Gh @CliArgs
  if ($LASTEXITCODE -ne 0) { throw "gh failed: $($CliArgs -join ' ')" }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

$parts = $Repository -split '/', 2
$owner = $parts[0]
$name  = $parts[1]

$query = @'
query($owner:String!,$name:String!){
  repository(owner:$owner,name:$name){
    discussions(first:100){
      nodes{
        id number title closed
        labels(first:20){ nodes{ name } }
      }
    }
  }
}
'@

$result = Invoke-GhJson @('api','graphql','-f',"query=$query",'-F',"owner=$owner",'-F',"name=$name")
$all    = $result.data.repository.discussions.nodes

$targets = @($all | Where-Object {
  !$_.closed -and
  ($_.labels.nodes | Where-Object { $_.name -eq 'duplicate' })
})

if ($targets.Count -eq 0) {
  Write-Host 'No open duplicate discussions found.' -ForegroundColor Green
  exit 0
}

Write-Host ''
Write-Host "Open discussions labeled 'duplicate' ($($targets.Count)):" -ForegroundColor Cyan
$targets | Sort-Object number | ForEach-Object {
  $labels = ($_.labels.nodes | ForEach-Object { $_.name }) -join ', '
  Write-Host ("  #{0}: {1}  [{2}]" -f $_.number, $_.title, $labels)
}

if (!$Apply) {
  Write-Host ''
  Write-Host 'Dry run. Re-run with -Apply to close these discussions.' -ForegroundColor Yellow
  exit 0
}

$closeMutation = @'
mutation($id:ID!){
  closeDiscussion(input:{discussionId:$id,reason:DUPLICATE}){
    discussion{ id number closed }
  }
}
'@

$commentMutation = @'
mutation($id:ID!,$body:String!){
  addDiscussionComment(input:{discussionId:$id,body:$body}){
    comment{ id }
  }
}
'@

foreach ($d in ($targets | Sort-Object number)) {
  $body = 'Workflow update: closing as duplicate. The idea is captured in an existing issue or discussion. If this should be tracked separately, reopen and remove the duplicate label.'
  Invoke-GhJson @('api','graphql','-f',"query=$commentMutation",'-F',"id=$($d.id)",'-F',"body=$body") | Out-Null
  Invoke-GhJson @('api','graphql','-f',"query=$closeMutation",'-F',"id=$($d.id)") | Out-Null
  Write-Host ("Closed #$($d.number): $($d.title)") -ForegroundColor Green
}
