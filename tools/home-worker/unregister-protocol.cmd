@echo off
rem PPP home worker: remove the pppworker:// registration made by register-protocol.cmd (only that key under HKEY_CURRENT_USER).
chcp 65001 >nul
cd /d "%~dp0..\.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
node tools\home-worker\worker.js --unregister-protocol
echo.
pause
