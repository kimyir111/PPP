@echo off
rem PPP home worker: add YourMT3 (multi-instrument transcription) for song mode. Double-click this ONE file.
rem It puts YourMT3 in tools\yourmt3 (the code and checkpoints, several GB) with its OWN Python in tools\yourmt3-venv, so the
rem piano models' Python is never touched. Neither Git nor Git LFS is needed: the files come with huggingface_hub, and a
rem download cut short goes on where it stopped when this is run again. The worker finds both folders by itself; a song is
rem then transcribed by YourMT3 first, and by the separation as before if YourMT3 fails. Delete the two folders to remove it.
rem Written without a Windows PC to try it on: if a step fails, send Claude the message it prints.
chcp 65001 >nul
cd /d "%~dp0..\.."
set "T=tools"

echo [1/4] YourMT3's own Python (3.11)...
rem YourMT3 pins numpy 1.26 and the CUDA builds of torch: neither exists for Python 3.13, where numpy builds from source and
rem breaks (OverflowError: cannot convert longdouble infinity to integer). An environment on another Python is made again.
set "PY=%T%\yourmt3-venv\Scripts\python.exe"
if exist "%PY%" "%PY%" -c "import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 12) else 1)" || rmdir /s /q "%T%\yourmt3-venv"
if not exist "%PY%" py -3.11 -m venv "%T%\yourmt3-venv" 2>nul
rem no Python 3.11 on this PC: uv fetches one by itself (nothing to install by hand)
if not exist "%PY%" python -m pip install --upgrade uv && python -m uv venv --python 3.11 --seed "%T%\yourmt3-venv"
if not exist "%PY%" (
  echo.
  echo Could not make a Python 3.11 environment. Install Python 3.11 from https://python.org and try again.
  pause
  exit /b 1
)
"%PY%" -m pip install --upgrade pip huggingface_hub

echo.
echo [2/4] YourMT3 code and checkpoints - a large download, this can take a while...
"%PY%" -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='mimbres/YourMT3', repo_type='space', local_dir='tools/yourmt3')"
if not exist "%T%\yourmt3\model_helper.py" (
  echo.
  echo The YourMT3 download did not work. Run this file again to continue it; if it keeps failing, send Claude the message above.
  pause
  exit /b 1
)

echo.
echo [3/4] Packages - a large download...
if exist "%T%\yourmt3\requirements.txt" "%PY%" -m pip install -r "%T%\yourmt3\requirements.txt"
rem a CUDA build of torch (it also runs on a PC without an NVIDIA card, on the CPU); without one YourMT3 runs on the CPU, slower
"%PY%" -m pip install --force-reinstall --no-deps torch torchaudio --index-url https://download.pytorch.org/whl/cu128 || "%PY%" -m pip install --force-reinstall --no-deps torch torchaudio --index-url https://download.pytorch.org/whl/cu124 || echo No CUDA build of torch was found: YourMT3 will run on the CPU, slower.
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
