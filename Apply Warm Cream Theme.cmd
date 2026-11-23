@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo BLOCKED: Node.js is not available in PATH.
  pause
  exit /b 2
)
if not exist "public\index.html" (
  echo BLOCKED: Copy this PATCH's public and scripts folders into the RepairlyLabs project root first.
  pause
  exit /b 2
)
node scripts\install-cream-theme.mjs
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo THEME INSTALL FAILED. Review errors above.
if "%RC%"=="0" echo Theme stylesheet links integrated. Restart your local site and clear browser cache.
pause
exit /b %RC%
