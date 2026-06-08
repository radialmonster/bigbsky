param(
  [string]$Path = "todo.md",
  [int]$IntervalSeconds = 15
)

$resolvedPath = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
if (-not $resolvedPath) {
  Write-Error "File not found: $Path"
  exit 1
}

$resolvedPath = $resolvedPath.Path
$lastHash = $null

function Get-OpenTodoItems {
  param([string]$TodoPath)
  Get-Content -LiteralPath $TodoPath |
    Where-Object { $_ -match '^\s*-\s\[\s\]\s+' } |
    ForEach-Object { ($_ -replace '^\s*-\s\[\s\]\s+', '').Trim() }
}

while ($true) {
  try {
    $hash = (Get-FileHash -LiteralPath $resolvedPath -Algorithm SHA256).Hash
    if ($hash -ne $lastHash) {
      $lastHash = $hash
      $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
      $items = Get-OpenTodoItems -TodoPath $resolvedPath

      Clear-Host
      Write-Host "todo.md monitor ($timestamp)"
      Write-Host "File: $resolvedPath"
      Write-Host ""

      if (-not $items -or $items.Count -eq 0) {
        Write-Host "No open items found."
      } else {
        Write-Host ("Open items found: {0}" -f $items.Count)
        Write-Host ""
        for ($i = 0; $i -lt $items.Count; $i++) {
          Write-Host ("{0}. {1}" -f ($i + 1), $items[$i])
        }
      }
    }
  } catch {
    Write-Warning ("Monitor error: {0}" -f $_.Exception.Message)
  }

  Start-Sleep -Seconds $IntervalSeconds
}
