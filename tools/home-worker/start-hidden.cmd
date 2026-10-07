@echo off
rem PPP home worker, hidden and left running: the localhost bridge (worker.js --serve). Started by start-hidden.vbs, which the Startup shortcut of install-startup.cmd runs.
rem It takes no argument. Its words go to worker.log next to the settings file (kept small by the worker). A second start finds the port taken and stops at once.
cd /d "%~dp0..\.."
where node >nul 2>nul
if not errorlevel 1 (
  node tools\home-worker\worker.js --serve --log-file >nul 2>nul
  exit /b 0
)
if exist "%ProgramFiles%\nodejs\node.exe" (
  "%ProgramFiles%\nodejs\node.exe" tools\home-worker\worker.js --serve --log-file >nul 2>nul
  exit /b 0
)
exit /b 1
