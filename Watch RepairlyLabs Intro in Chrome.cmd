@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title RepairlyLabs - Cinematic Brand Intro in Visible Google Chrome

echo ==============================================================================
echo   RepairlyLabs - Cinematic Prismatic Spiral Flower Intro Viewer
echo ==============================================================================
echo.
echo Launching your official 8-petal spiral intro animation in visible Google Chrome...
echo.

rem 1. Check if server is running on port 3001
curl -s http://localhost:3001/api/health >nul 2>nul
if errorlevel 1 (
  echo [INFO] Starting RepairlyLabs local server on port 3001...
  set "PORT=3001"
  start /b "" node src/server.mjs
  timeout /t 3 /nobreak >nul
)

rem 2. Find Google Chrome executable
set "CHROME_EXE="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"
)

if defined CHROME_EXE (
  echo [INFO] Opening in Google Chrome: "%CHROME_EXE%"
  start "" "%CHROME_EXE%" --new-window "http://localhost:3001/"
) else (
  echo [INFO] Opening default browser...
  start "" "http://localhost:3001/"
)

echo.
echo ==============================================================================
echo   ANIMATION PLAYING IN REAL VISIBLE GOOGLE CHROME:
echo     - Stage A (0-450ms): Prismatic Spiral Flower entrance & subtle scale
echo     - Stage B (450-850ms): Recognition pause
echo     - Stage C (850-1750ms): 8-petal spiral separation along natural arcs
echo     - Stage D (1400-2200ms): Website reveal through central spiral void
echo     - Stage E (1900-2600ms): Homepage hero and "Request a Repair" CTA ready
echo.
echo   You can click "Skip intro" at any time, or press Escape.
echo   To replay again anytime, press Ctrl+F5 or add ?intro=1 to the URL.
echo ==============================================================================
echo.
pause
