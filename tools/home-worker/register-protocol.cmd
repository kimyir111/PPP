@echo off
rem PPP home worker: register the pppworker:// link ONCE, so that pressing "High-quality (my PC)" in this PC's browser starts the conversion at once.
rem It writes three values under HKEY_CURRENT_USER\Software\Classes\pppworker (this Windows user only, no administrator rights).
rem Undo it with unregister-protocol.cmd. Check it with:  node tools\home-worker\worker.js --protocol-status
chcp 65001 >nul
cd /d "%~dp0..\.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
node tools\home-worker\worker.js --register-protocol
echo.
pause
