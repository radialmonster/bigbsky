@echo off
REM Thin wrapper. Double-click with no args opens the GitHub workflow menu.
REM Direct loop usage still works:
REM   loop.bat codex-yolo prompt-github-issue-roast.txt -MaxIterations 3
if "%~1"=="" (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0github-workflow-menu.ps1"
) else (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0loop.ps1" %*
)
echo.
echo loop exited. Press any key to close this window.
pause >nul
