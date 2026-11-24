@echo off
setlocal
cd /d "%~dp0"
title RepairlyLabs - Change only dark blue backgrounds
where node >nul 2>nul
if errorlevel 1 (
  echo BLOCKED: Node.js is not available.
  pause
  exit /b 2
)
node scripts\apply-dark-blue-only.mjs
set CODE=%ERRORLEVEL%
if not "%CODE%"=="0" echo Theme update FAILED. Check output above.
if "%CODE%"=="0" echo Dark blue surfaces changed to warm charcoal. Existing colors and layout preserved.
pause
exit /b %CODE%
