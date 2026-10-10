@echo off
rem PPP home worker: add Sheet Sage's melody model for song mode. Double-click this ONE file.
rem Sheet Sage (Donahue et al., ISMIR 2022) writes the tune a lead sheet would write; song mode then takes the melody from it and
rem the octave from YourMT3. It needs Beat This (the beat tracker) in the transcription Python and downloads the model (~100 MB)
rem to tools\sheetsage. The trained model is CC BY-NC-SA 3.0: non-commercial use only. Delete tools\sheetsage to remove it.
chcp 65001 >nul
cd /d "%~dp0..\.."
set "PY=tools\transcribe-venv\Scripts\python.exe"
if not exist "%PY%" (
  echo The transcription Python was not found at %PY%
  echo If yours is somewhere else, it is the "pythonPath" in tools\home-worker\worker.config.json.
  pause
  exit /b 1
)

echo [1/2] Beat This (the beat tracker Sheet Sage reads the beats from)...
"%PY%" -c "import beat_this" >nul 2>nul
rem --no-deps: its requirements would otherwise replace this Python's CUDA build of torch
if errorlevel 1 "%PY%" -m pip install --no-deps beat-this einops rotary-embedding-torch soxr
"%PY%" -c "import beat_this" >nul 2>nul
if errorlevel 1 (
  echo.
  echo Beat This could not be installed. Send Claude the lines above.
  pause
  exit /b 1
)

echo.
echo [2/2] The Sheet Sage melody model (~100 MB)...
"%PY%" sheetsage_melody.py --get-model
if errorlevel 1 (
  echo.
  echo Sheet Sage: NOT working yet. Song mode still works as before. Send Claude the lines above.
  pause
  exit /b 1
)

echo.
echo Done. Convert your song again (song mode). The review's "Melody from" says "... · Sheet Sage" when it was used.
pause
