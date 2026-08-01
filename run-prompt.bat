@echo off
setlocal
cd /d "%~dp0"

pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-prompt.ps1" %*
echo.
echo run-prompt exited with code %ERRORLEVEL%
echo Press any key to close this window.
pause >nul
