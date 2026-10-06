# Makes ONE desktop shortcut that runs run-once.cmd (check the PPP site now, convert what is waiting).
# NOTHING runs this for you. Run it yourself, once, if you want the shortcut:
#   powershell -ExecutionPolicy Bypass -File tools\home-worker\create-desktop-shortcut.ps1
# It only creates "PPP high-quality conversion (my PC).lnk" on your Desktop. Delete that file to undo it.
$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot 'run-once.cmd'
if (-not (Test-Path $target)) { throw "run-once.cmd was not found next to this script: $target" }
$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop 'PPP high-quality conversion (my PC).lnk'
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($link)
$sc.TargetPath = $target
$sc.WorkingDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$sc.Description = 'Check the PPP site now and convert the YouTube links waiting for this PC'
$sc.Save()
Write-Host "Shortcut made: $link"
