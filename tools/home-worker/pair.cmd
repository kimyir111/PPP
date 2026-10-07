@echo off
rem PPP home worker: connect my phone and other devices. Double-click this ONE file.
rem It copies the pairing link of your PC link to the clipboard (paste it in a message to yourself and open it on the phone)
rem and opens it in this PC browser too. First time only: put the link (or the PC code) in pc-code.txt next to
rem worker.config.json - see README.md. The link is a secret: it is never printed here (run with --show to see it).
chcp 65001 >nul
cd /d "%~dp0..\.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
node tools\home-worker\worker.js --pair
echo.
pause
