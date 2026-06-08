param(
  [string]$Repository = 'radialmonster/bigbsky-dev'
)

$ErrorActionPreference = 'Stop'
$Gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (!(Test-Path $Gh)) { $Gh = 'gh' }

$parts = $Repository -split '/', 2
if ($parts.Length -ne 2) { throw "Repository must be owner/name: $Repository" }
$owner = $parts[0]
$name = $parts[1]

Write-Host 'Issues waiting on you:'
$issues = & $Gh issue list --repo $Repository --state open --label ai:needs-user-answer --limit 50 --json number,title,url |
  ConvertFrom-Json
if ($issues.Count -eq 0) {
  Write-Host '  none'
} else {
  $issues | ForEach-Object {
    Write-Host ("  Issue #{0}: {1}" -f $_.number, $_.title)
    Write-Host ("    {0}" -f $_.url)
  }
}

Write-Host ''
Write-Host 'Discussions waiting on you:'
$query = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){discussions(first:100){nodes{number title url labels(first:20){nodes{name}}}}}}'
$result = & $Gh api graphql -f "query=$query" -F "owner=$owner" -F "name=$name" | ConvertFrom-Json
$discussions = @($result.data.repository.discussions.nodes | Where-Object {
  @($_.labels.nodes | ForEach-Object { $_.name }) -contains 'ai:needs-user-answer'
})
if ($discussions.Count -eq 0) {
  Write-Host '  none'
} else {
  $discussions | ForEach-Object {
    Write-Host ("  Discussion #{0}: {1}" -f $_.number, $_.title)
    Write-Host ("    {0}" -f $_.url)
  }
}
