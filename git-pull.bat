@echo off
setlocal

set "REPO=%~dp0"
echo === Pulling latest from GitHub ===
git -C "%REPO%" pull --rebase origin main
if %errorlevel% neq 0 (
  echo.
  echo [!] Pull/rebase failed. You may have conflicts or unstaged local edits.
  echo     Save or commit your edits first, then retry.
)
echo.
pause
endlocal
