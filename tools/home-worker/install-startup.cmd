@echo off
rem PPP home worker: install ONCE. It puts one shortcut in YOUR Startup folder so that the PPP program (worker.js --serve) starts hidden every time you sign in, and starts it now.
rem Then open PPP in a browser on this PC and press "Connect this PC". No administrator rights, nothing in the registry, no scheduled task. Undo it with uninstall-startup.cmd.
chcp 65001 >nul
cd /d "%~dp0..\.."
where node >nul 2>nul
if errorlevel 1 (
  if not exist "%ProgramFiles%\nodejs\node.exe" (
    echo Node.js was not found. Install it from https://nodejs.org and try again.
    pause
    exit /b 1
  )
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0startup-shortcut.ps1" install
if errorlevel 1 (
  echo.
  echo 설치하지 못했어요. 위의 영어 메시지를 확인하세요. / It was not installed: see the message above.
  pause
  exit /b 1
)
echo.
echo 설치했어요. 이제 PPP 사이트를 이 PC의 브라우저에서 열고 설정 - 내 PC 연결 - "이 PC 연결"을 누르세요.
echo Installed. Open PPP in a browser on this PC, go to Settings - Connect my PC and press "Connect this PC".
echo 되돌리려면 uninstall-startup.cmd 를 더블클릭하세요. / To undo it, double-click uninstall-startup.cmd.
echo.
pause
