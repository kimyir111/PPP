@echo off
rem PPP home worker: undo install-startup.cmd. It removes the shortcut from YOUR Startup folder (only the one install-startup.cmd made) and stops the PPP program if it is running.
chcp 65001 >nul
cd /d "%~dp0..\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0startup-shortcut.ps1" uninstall
echo.
echo 지웠어요. PPP 사이트의 "이 PC 연결"은 프로그램을 다시 설치할 때까지 "PC 프로그램이 꺼져 있어요"라고 보여요.
echo Removed. Until you install it again, PPP will say that the PC program is not running.
echo.
pause
