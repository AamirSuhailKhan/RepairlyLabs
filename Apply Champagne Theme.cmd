@echo off
setlocal
cd /d "%~dp0"
title RepairlyLabs - Apply Warm Blush Champagne Theme
echo ==============================================================================
echo   RepairlyLabs - Warm Blush Champagne Color Installer
echo ==============================================================================
echo.
node scripts\apply-champagne-theme.mjs
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo [ERROR] Theme application failed. Review errors above.
if "%RC%"=="0" echo [SUCCESS] Warm Blush Champagne palette applied. Restart site and refresh browser.
echo.
pause
exit /b %RC%
