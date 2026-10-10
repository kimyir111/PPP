@echo off
rem PPP home worker: send Claude the last song converted in song mode - its audio (tools\yourmt3-last.wav) and what YourMT3
rem heard (tools\yourmt3-last.mid) - on the branch debug-mt3 of this repository, so the melody can be checked against the
rem real sound. Double-click this ONE file after converting a song. Nothing in this folder changes: the two files are put on
rem that branch alone (your own branch, your checkout and your files stay as they are). Claude deletes the branch afterwards.
chcp 65001 >nul
cd /d "%~dp0..\.."
if not exist "tools\yourmt3-last.mid" goto none
if not exist "tools\yourmt3-last.wav" goto none

set "GIT_INDEX_FILE=%TEMP%\ppp-send-last-song.index"
if exist "%GIT_INDEX_FILE%" del "%GIT_INDEX_FILE%"
for /f %%h in ('git hash-object -w "tools\yourmt3-last.mid"') do git update-index --add --cacheinfo 100644,%%h,song.mid
for /f %%h in ('git hash-object -w "tools\yourmt3-last.wav"') do git update-index --add --cacheinfo 100644,%%h,song.wav
set "TREE="
for /f %%t in ('git write-tree') do set "TREE=%%t"
set "GIT_INDEX_FILE="
if "%TREE%"=="" goto failed
set "COMMIT="
for /f %%c in ('git commit-tree %TREE% -m "debug: the last song converted in song mode"') do set "COMMIT=%%c"
if "%COMMIT%"=="" goto failed
echo Sending (about 10 MB)...
git push -f origin %COMMIT%:refs/heads/debug-mt3
if errorlevel 1 goto failed
echo.
echo Sent. Tell Claude "보냈어".
pause
exit /b 0

:none
echo.
echo No song yet: convert a song in song mode first (high quality, on my PC), then run this again.
pause
exit /b 1

:failed
echo.
echo Sending did not work. Send Claude the lines above.
pause
exit /b 1
