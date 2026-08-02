@echo off
setlocal
cd /d "%~dp0"

pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0loop.ps1" %*
echo.
echo loop exited with code %ERRORLEVEL%
echo Press any key to close this window.
pause >nul
