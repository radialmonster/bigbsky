@echo off
setlocal enabledelayedexpansion
set "REPO=%~dp0"

echo === Checking for changes ===
git -C "%REPO%" status --short
if errorlevel 1 (
  echo [!] Could not read git status.
  pause
  exit /b 1
)

echo.
echo Files above will be committed and pushed.
echo.
set /p MSG="Commit message: "
if "%MSG%"=="" (
  echo [!] No message, aborting.
  pause
  exit /b 1
)

echo.
echo === Staging all changes ===
git -C "%REPO%" add -A
if !errorlevel! neq 0 (
  echo [!] Staging failed.
  pause
  exit /b 1
)

echo === Committing ===
git -C "%REPO%" commit -m "%MSG%"
if !errorlevel! neq 0 (
  echo [!] Nothing to commit or commit failed.
  pause
  exit /b 1
)

echo === Pushing to GitHub ===
git -C "%REPO%" push
if !errorlevel! neq 0 (
  echo [!] Push failed. Check the message above.
  echo.
  echo [!] If this failed because your branch is behind remote,
  echo     run git-pull.bat first, then retry git-push.bat.
  pause
  exit /b 1
)

echo.
echo Done.
pause
