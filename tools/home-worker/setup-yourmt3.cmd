@echo off
rem PPP home worker: add YourMT3 (multi-instrument transcription) for song mode. Double-click this ONE file.
rem It puts YourMT3 in tools\yourmt3 (the code and checkpoints, several GB) with its OWN Python in tools\yourmt3-venv, so the
rem piano models' Python is never touched. The worker finds both by itself; a song is then transcribed by YourMT3 first,
rem and by the separation as before if YourMT3 fails. Delete the two folders to remove it.
rem Written without a Windows PC to try it on: if a step fails, send Claude the message it prints.
chcp 65001 >nul
cd /d "%~dp0..\.."
set "T=tools"

where git >nul 2>nul
if errorlevel 1 (
  echo Git was not found. Install it from https://git-scm.com and try again.
  pause
  exit /b 1
)
git lfs version >nul 2>nul
if errorlevel 1 (
  echo Git LFS is needed for the YourMT3 checkpoints. Install it from https://git-lfs.com and try again.
  pause
  exit /b 1
)

echo [1/4] YourMT3 code and checkpoints - a large download, this can take a while...
git lfs install >nul
if exist "%T%\yourmt3\model_helper.py" (
  git -C "%T%\yourmt3" pull
  git -C "%T%\yourmt3" lfs pull
) else (
  git clone https://huggingface.co/spaces/mimbres/YourMT3 "%T%\yourmt3"
)
if not exist "%T%\yourmt3\model_helper.py" (
  echo.
  echo The YourMT3 download did not work. Nothing else was changed.
  pause
  exit /b 1
)

echo.
echo [2/4] YourMT3's own Python...
set "PY=%T%\yourmt3-venv\Scripts\python.exe"
if not exist "%PY%" py -3.11 -m venv "%T%\yourmt3-venv" 2>nul
if not exist "%PY%" py -3.10 -m venv "%T%\yourmt3-venv" 2>nul
if not exist "%PY%" python -m venv "%T%\yourmt3-venv"
if not exist "%PY%" (
  echo.
  echo Could not make a Python environment. Install Python 3.11 from https://python.org and try again.
  pause
  exit /b 1
)

echo.
echo [3/4] Packages - a large download...
"%PY%" -m pip install --upgrade pip
if exist "%T%\yourmt3\requirements.txt" "%PY%" -m pip install -r "%T%\yourmt3\requirements.txt"
rem the CUDA build of torch (it also runs on a PC without an NVIDIA card, on the CPU)
"%PY%" -m pip install --force-reinstall torch torchaudio --index-url https://download.pytorch.org/whl/cu121
"%PY%" -m pip install soundfile

echo.
echo [4/4] Loading the model once to check it...
"%PY%" yourmt3_run.py --space "%T%\yourmt3" --selftest
if errorlevel 1 (
  echo.
  echo YourMT3: NOT working yet. Song mode still works as before. Send Claude the lines above that start with YOURMT3_FAILED.
  pause
  exit /b 1
)

echo.
echo Done. Convert your song again (song mode). The review's "Melody from" says "... · YourMT3" when it was used.
pause
