@echo off
rem PPP home worker: get the newest code and make sure the song-mode melody tracker (Basic Pitch) is installed. Double-click this ONE file.
rem It does three things and says what happened: (1) git pull, (2) installs Basic Pitch if this PC's transcription Python lacks it,
rem (3) prints whether it works. Then convert your song again (song mode) and look at "Melody from" on the review: it says "... · Basic Pitch" when it ran.
chcp 65001 >nul
cd /d "%~dp0..\.."

echo [1/3] Getting the newest PPP code...
git pull origin main
if errorlevel 1 (
  echo.
  echo git pull did not work. Close other programs using this folder, or ask for help. Nothing else was changed.
  pause
  exit /b 1
)

set "PY=tools\transcribe-venv\Scripts\python.exe"
if not exist "%PY%" (
  echo.
  echo The transcription Python was not found at %PY%
  echo If yours is somewhere else, it is the "pythonPath" in tools\home-worker\worker.config.json - run the lines below with that Python.
  pause
  exit /b 1
)

echo.
echo [2/3] Checking Basic Pitch...
"%PY%" -c "import basic_pitch, onnxruntime" >nul 2>nul
if errorlevel 1 (
  echo Not installed yet. Installing - this takes a minute...
  "%PY%" -m pip install --no-deps basic-pitch onnxruntime scipy resampy pretty_midi mir_eval
)

echo.
echo [3/3] Result:
"%PY%" -c "import basic_pitch, onnxruntime; print('Basic Pitch: OK - song mode will use it for an instrumental lead line')" 2>nul
if errorlevel 1 (
  echo Basic Pitch: NOT working. Song mode still works, with the older melody tracker. Tell Claude this message.
  pause
  exit /b 1
)

echo.
echo Done. Now convert your song again (song mode, high quality on my PC) and look at "Melody from" on the review.
pause
