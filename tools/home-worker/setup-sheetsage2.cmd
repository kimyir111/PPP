@echo off
rem PPP home worker: add SheetSage2 (the melody as a lead sheet writes it) for song mode. Double-click this ONE file.
rem SheetSage2 (m-a-p, 2026) turns a whole song into a lead sheet; song mode takes its melody, and YourMT3 still gives the bass and
rem the accompaniment. It gets its OWN Python in tools\sheetsage2-venv and the model in tools\sheetsage2; the first run downloads its
rem encoder (m-a-p/MERT-v2-FullSong, ~2.5 GB) too. The weights are CC BY-NC 4.0: non-commercial use only. The worker finds it by
rem itself; delete the two folders to remove it. Written without a Windows PC to try it on: if a step fails, send Claude the message.
chcp 65001 >nul
cd /d "%~dp0..\.."
set "T=tools"

echo [1/4] SheetSage2's own Python (3.11)...
rem its requirements pin numpy 1.24.3, which has no Python 3.12+ build: an environment on another Python is made again
set "PY=%T%\sheetsage2-venv\Scripts\python.exe"
if exist "%PY%" "%PY%" -c "import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 11) else 1)" || rmdir /s /q "%T%\sheetsage2-venv"
if not exist "%PY%" py -3.11 -m venv "%T%\sheetsage2-venv" 2>nul
if not exist "%PY%" python -m pip install --upgrade uv && python -m uv venv --python 3.11 --seed "%T%\sheetsage2-venv"
if not exist "%PY%" (
  echo.
  echo Could not make a Python 3.11 environment. Install Python 3.11 from https://python.org and try again.
  pause
  exit /b 1
)
"%PY%" -m pip install --upgrade pip huggingface_hub

echo.
echo [2/4] The SheetSage2 model...
"%PY%" -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='m-a-p/SheetSage2', local_dir='tools/sheetsage2')"
if not exist "%T%\sheetsage2\config.json" (
  echo.
  echo The download did not work. Run this file again to continue it; if it keeps failing, send Claude the message above.
  pause
  exit /b 1
)

echo.
echo [3/4] Packages - a large download...
if exist "%T%\sheetsage2\requirements.txt" "%PY%" -m pip install -r "%T%\sheetsage2\requirements.txt"
"%PY%" -m pip install soundfile
rem a CUDA 12.8 build of torch, which an RTX 50xx needs (the requirements may bring another); without one it runs on the CPU, slower
"%PY%" -m pip install --force-reinstall --no-deps torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128 || "%PY%" -m pip install --force-reinstall --no-deps torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu126 || echo No CUDA build of torch was found: SheetSage2 will run on the CPU, slower.

echo.
echo [4/4] Loading the model once to check it (the first time also downloads its encoder, ~2.5 GB)...
"%PY%" sheetsage2_run.py --model-dir "%T%\sheetsage2" --selftest
if errorlevel 1 (
  echo.
  echo SheetSage2: NOT working yet. Song mode still works as before. Send Claude the lines above that start with SHEETSAGE2_FAILED.
  pause
  exit /b 1
)

echo.
echo Done. Convert your song again (song mode). The review's "Melody from" says "... · SheetSage2" when it was used.
pause
