@echo off
setlocal
cd /d "%~dp0"
title RepairlyLabs - isolated visible Chrome test
where python >nul 2>nul
if errorlevel 1 (
  echo BLOCKED: Python not found. Ask your coding agent to install Python and Playwright in your own Windows user session.
  pause
  exit /b 2
)
where node >nul 2>nul
if errorlevel 1 (
  echo BLOCKED: Node.js not found. Install Node.js 22.13 or later in your Windows user session.
  pause
  exit /b 2
)
python -c "import playwright; import PIL.ImageGrab" >nul 2>nul
if errorlevel 1 (
  echo BLOCKED: Python Playwright and/or Pillow is missing.
  echo Install dependencies: python -m pip install -r tests\requirements-visible.txt
  pause
  exit /b 2
)
python tests\isolated_visible_lifecycle.py
set CODE=%ERRORLEVEL%
echo.
if not "%CODE%"=="0" echo TEST FAILED OR BLOCKED. Do not claim the visible audit passed.
echo Your real database was NOT selected by this runner; results are in test-results\ (private files).
pause
exit /b %CODE%
