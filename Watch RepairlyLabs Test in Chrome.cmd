@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title RepairlyLabs - Isolated Visible Chrome Test Runner

echo ==============================================================================
echo   RepairlyLabs - Isolated Visible Chrome Test Suite Launcher
echo ==============================================================================
echo.

rem 1. Check working directory
if not exist "%~dp0package.json" (
  echo [BLOCKED] Incorrect working directory.
  echo package.json not found in %~dp0
  echo Please run this script directly from the RepairlyLabs repository root.
  echo.
  pause
  exit /b 2
)

rem 2. Check Python
where python >nul 2>nul
if errorlevel 1 (
  echo [BLOCKED] Python executable not found in PATH.
  echo Python 3.10 or later is required to run the visible Chrome automation suite.
  echo Download and install Python from: https://www.python.org/
  echo Be sure to check "Add Python to PATH" during installation.
  echo.
  pause
  exit /b 2
)

rem 3. Check Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo [BLOCKED] Node.js executable not found in PATH.
  echo Node.js 22.13 or later is required to run the RepairlyLabs test server.
  echo Download and install Node.js from: https://nodejs.org/
  echo.
  pause
  exit /b 2
)

rem 4. Check npm dependencies (node_modules)
if not exist "%~dp0node_modules\" (
  echo [BLOCKED] Project dependencies missing.
  echo The "node_modules" folder was not found in %~dp0
  echo Run "npm install" in this directory before launching the test suite.
  echo.
  pause
  exit /b 2
)

rem 5. Check Chrome executable
set "CHROME_FOUND="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME_FOUND=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not defined CHROME_FOUND if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME_FOUND=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not defined CHROME_FOUND if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME_FOUND=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if not defined CHROME_FOUND (
  echo [BLOCKED] Google Chrome executable not found.
  echo The visible audit requires the real Google Chrome browser.
  echo Please install Google Chrome from: https://www.google.com/chrome/
  echo.
  pause
  exit /b 2
)

rem 6. Check Python Playwright and Pillow dependencies
python -c "import playwright, PIL.ImageGrab" >nul 2>nul
if errorlevel 1 (
  echo [BLOCKED] Required Python packages (Playwright and/or Pillow) are missing.
  echo Install the test dependencies by running:
  echo   python -m pip install -r tests\requirements-visible.txt
  echo   playwright install chromium
  echo.
  pause
  exit /b 2
)

rem 7. Check for port 3005 conflict
netstat -ano | findstr /R /C:":3005 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo [BLOCKED] Port 3005 is already in use by another process.
  echo The isolated test server requires port 3005.
  echo Please close any other running test process or service on port 3005.
  echo.
  pause
  exit /b 2
)

rem 8. Clean up stale isolation verification and report files
if not exist "%~dp0test-results" mkdir "%~dp0test-results"
if exist "%~dp0test-results\isolation-verification.json" del /q "%~dp0test-results\isolation-verification.json"

echo [PRE-CHECK OK] Environment validated.
echo.
echo ==============================================================================
echo   USER CONSENT ^& DESKTOP RECORDING GATE
echo ==============================================================================
echo This launcher will open a VISIBLE Google Chrome window on your active desktop,
echo navigate through RepairlyLabs, test repairs, parts enquiries, and admin flows.
echo.
echo Test Isolation Safeguards:
echo   - Runs on isolated port 3005 with a disposable temporary database.
echo   - The production database (data\repairlylabs.sqlite) will NOT be touched.
echo   - No real financial charges, SMS, or emails will be sent.
echo.
set /p "USER_CONSENT=Do you consent to run visible Chrome testing on this desktop? (Y/N, default Y): "
if /i "%USER_CONSENT%"=="N" (
  echo [ABORTED] User declined visible desktop test execution.
  echo.
  pause
  exit /b 0
)

echo.
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo [INFO] FFmpeg not found in PATH for automatic desktop MP4 recording.
  echo [INFO] Playwright browser-context WebM video recording is automatically ENABLED.
  echo [TIP]  To record your full physical monitor manually:
  echo        Press Win + Alt + R (Windows Game Bar) before continuing.
  echo.
) else (
  echo [INFO] FFmpeg detected. Screen recording can be captured to test-results\videos\desktop-screen\
)
echo Press any key to start the isolated test runner and launch Google Chrome...
pause >nul
echo.
echo Starting isolated test runner on port 3005...
echo.

rem 9. Execute Python isolated runner
python tests\isolated_visible_lifecycle.py
set CODE=%ERRORLEVEL%

echo.
echo ==============================================================================

rem 10. Machine-readable isolation verification check
set "ISOLATED_OK="
if exist "%~dp0test-results\isolation-verification.json" (
  findstr /C:"\"verified\": true" "%~dp0test-results\isolation-verification.json" >nul 2>nul
  if not errorlevel 1 set "ISOLATED_OK=1"
)

if "%CODE%"=="0" (
  if defined ISOLATED_OK (
    echo [RESULT: ALL PASS] Visible Chrome audit completed successfully.
    echo.
    echo Isolation Verification Summary:
    echo   - Test Database: Isolated temporary directory (verified)
    echo   - Test Server: Port 3005 (verified; port 3001 untouched)
    echo   - Production DB: data\repairlylabs.sqlite was untouched and preserved
    echo   - Production .env: No live merchant or provider credentials inherited
    echo   - Desktop: Foreground Chrome window verified on Windows Default desktop
    echo.
    echo Evidence, recordings, and reports saved to test-results\
  ) else (
    echo [ERROR] Runner reported exit code 0, but isolation verification could not be confirmed.
    echo Do NOT treat this run as a verified isolated pass.
    set CODE=1
  )
) else (
  echo [RESULT: TEST FAILED OR BLOCKED - EXIT CODE: %CODE%]
  echo.
  if defined ISOLATED_OK (
    echo Note on Database Safety:
    echo   The isolation barrier was successfully established before the failure.
    echo   Test ran against temporary database on port 3005.
    echo   The live business database was NOT selected.
  ) else (
    echo [CRITICAL ALERT]
    echo   Isolation verification did NOT confirm safe database isolation.
    echo   Do NOT assume the live database was untouched without verifying data\repairlylabs.sqlite.
  )
  echo.
  echo Review the terminal error message above or see test-results\isolated-server-private.log
)

echo ==============================================================================
echo.
pause
exit /b %CODE%
