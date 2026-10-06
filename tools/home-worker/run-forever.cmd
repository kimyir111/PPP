@echo off
rem PPP home worker, left running: it checks the site as the site tells it to (every ~20 minutes when idle, every ~15 s while
rem something is going on). Close the window or press Ctrl-C to stop (once: finish the current conversion; twice: quit now).
cd /d "%~dp0..\.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
node tools\home-worker\worker.js
echo.
pause
