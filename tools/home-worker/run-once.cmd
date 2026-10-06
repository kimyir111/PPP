@echo off
rem PPP home worker: check the site once, convert everything that is waiting, then stop.
rem Double-click it (or the desktop shortcut made by create-desktop-shortcut.ps1) after you asked for a high-quality conversion.
cd /d "%~dp0..\.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
node tools\home-worker\worker.js --once
echo.
pause
