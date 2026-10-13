@echo off
rem PPP home worker, hidden: check the site once and convert what is waiting (the same as run-once.cmd, with no window).
rem Started by run-hidden.vbs, which the pppworker:// link runs. It takes no argument. Its words go to worker.log next to the
rem settings file (kept small by the worker). The run lock in worker.js keeps two runs from overlapping.
cd /d "%~dp0..\.."
where node >nul 2>nul
if errorlevel 1 exit /b 1
node tools\home-worker\worker.js --once --log-file >nul 2>nul
