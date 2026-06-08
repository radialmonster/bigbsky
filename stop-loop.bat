@echo off
REM Drop a sentinel file telling loop.ps1 to exit after the current session.
REM The current claude session is NOT interrupted -- it runs to completion,
REM then no new iteration starts. Use this when the loop window doesn't
REM have keyboard focus (or you forgot which window it's in).
if not exist "%~dp0.loop-tmp" mkdir "%~dp0.loop-tmp"
type nul > "%~dp0.loop-tmp\stop-after.flag"
echo.
echo Stop-after-current-session flag set.
echo The running loop will finish its current session, then exit.
echo (Ctrl+C in the loop window aborts immediately instead.)
echo.
echo Waiting up to 25s for loop to exit cleanly...
timeout /t 25 >nul

for /f %%I in ('pwsh -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'pwsh.exe' -and $_.CommandLine -match 'loop\\.ps1') -or ($_.Name -eq 'cmd.exe' -and $_.CommandLine -match 'loop\\.bat') } | Measure-Object | Select-Object -ExpandProperty Count"') do set LOOP_COUNT=%%I

if "%LOOP_COUNT%"=="0" (
  echo Loop exited cleanly.
  timeout /t 2 >nul
  exit /b 0
)

echo Loop still running. Escalating to forced stop...
pwsh -NoProfile -Command ^
  "$targets = Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'pwsh.exe' -and $_.CommandLine -match 'loop\\.ps1') -or ($_.Name -eq 'cmd.exe' -and $_.CommandLine -match 'loop\\.bat') -or ($_.Name -eq 'codex.exe') }; foreach ($p in $targets) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Host ('Stopped ' + $p.Name + ' PID ' + $p.ProcessId) } catch {} }"
timeout /t 2 >nul
