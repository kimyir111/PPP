# Puts ONE shortcut in this user's Startup folder (so the PPP bridge, worker.js --serve, starts hidden at every sign-in), or takes it away again.
# NOTHING runs this for you. install-startup.cmd and uninstall-startup.cmd call it; run it by hand if you prefer:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\home-worker\startup-shortcut.ps1 install      (-NoStart: do not start the program now, only at the next sign-in)
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\home-worker\startup-shortcut.ps1 uninstall    (also stops the program, if it runs from this folder)
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\home-worker\startup-shortcut.ps1 status
# What install does: one file, "PPP home worker (bridge).lnk", in the Startup folder of THIS Windows user (no administrator rights, nothing in the registry, no scheduled task). It runs
#   wscript.exe //B //Nologo "<this folder>\start-hidden.vbs"
# and nothing else; start-hidden.vbs reads no argument. uninstall removes that file (only if it is the one install makes) and stops the program that listens on the bridge's port.
# Test hooks (used by tests/home-worker/bridge-startup.test.js only): PPP_STARTUP_DIR names another folder in place of the Startup folder; PPP_WORKER_BRIDGE_PORT names another port.
param(
  [Parameter(Position = 0)][ValidateSet('install', 'uninstall', 'status')][string]$Action = 'status',
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$vbs = Join-Path $PSScriptRoot 'start-hidden.vbs'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$startup = if ($env:PPP_STARTUP_DIR) { $env:PPP_STARTUP_DIR } else { [Environment]::GetFolderPath('Startup') }
$link = Join-Path $startup 'PPP home worker (bridge).lnk'
$shell = New-Object -ComObject WScript.Shell

function Get-BridgePort {
  if ($env:PPP_WORKER_BRIDGE_PORT -match '^\d{4,5}$') { return [int]$env:PPP_WORKER_BRIDGE_PORT }
  foreach ($f in @((Join-Path $PSScriptRoot 'worker.config.json'), (Join-Path $env:USERPROFILE '.ppp-home-worker\worker.config.json'))) {
    try {
      if (Test-Path $f) {
        $j = (Get-Content -Raw -Encoding UTF8 $f) | ConvertFrom-Json
        if ($j.bridgePort -and ([int]$j.bridgePort -ge 1024) -and ([int]$j.bridgePort -le 65535)) { return [int]$j.bridgePort }
      }
    } catch { }
  }
  return 47613
}
# the shortcut is ours when it runs wscript.exe with start-hidden.vbs
function Test-OurLink($path) {
  try {
    $sc = $shell.CreateShortcut($path)
    return (($sc.TargetPath -ieq $wscript) -and ($sc.Arguments -match 'start-hidden\.vbs"?\s*$'))
  } catch { return $false }
}
# the program that listens on the bridge's port, when it is  worker.js --serve
function Get-Bridge {
  $port = Get-BridgePort
  try {
    $c = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -First 1
    if (-not $c) { return $null }
    $p = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $c.OwningProcess) -ErrorAction Stop
    if ($p -and $p.CommandLine -match 'worker\.js' -and $p.CommandLine -match '--serve') { return $p }
  } catch { }
  return $null
}

if ($Action -eq 'install') {
  if (-not (Test-Path $vbs)) { throw "start-hidden.vbs was not found next to this script: $vbs" }
  if (-not (Test-Path $wscript)) { throw "wscript.exe was not found: $wscript" }
  if ((Test-Path $link) -and -not (Test-OurLink $link)) { throw "A different file with that name is already in the Startup folder; it was not touched: $link" }
  New-Item -ItemType Directory -Force -Path $startup | Out-Null
  $sc = $shell.CreateShortcut($link)
  $sc.TargetPath = $wscript
  $sc.Arguments = '//B //Nologo "' + $vbs + '"'
  $sc.WorkingDirectory = $repo
  $sc.Description = 'PPP home worker: the program the PPP page of this PC connects to (worker.js --serve)'
  $sc.WindowStyle = 7
  $sc.Save()
  Write-Host "Startup shortcut made: $link"
  if (-not $NoStart -and -not $env:PPP_STARTUP_NOSTART) {
    if (Get-Bridge) { Write-Host 'The program is already running.' }
    else { Start-Process -FilePath $wscript -ArgumentList @('//B', '//Nologo', ('"' + $vbs + '"')) -WindowStyle Hidden; Write-Host 'The program was started (hidden).' }
  }
  exit 0
}
if ($Action -eq 'uninstall') {
  if (Test-Path $link) {
    if (-not (Test-OurLink $link)) { Write-Host "The file in the Startup folder is not the one install makes; it was not removed: $link"; exit 1 }
    Remove-Item -LiteralPath $link -Force
    Write-Host "Startup shortcut removed: $link"
  } else { Write-Host 'There is no startup shortcut to remove.' }
  $b = Get-Bridge
  if ($b) { Stop-Process -Id $b.ProcessId -Force; Write-Host ('The program was stopped (process ' + $b.ProcessId + ').') }
  else { Write-Host 'The program is not running on the bridge port.' }
  exit 0
}
$ours = (Test-Path $link) -and (Test-OurLink $link)
Write-Host ('Startup shortcut: ' + $(if ($ours) { 'installed' } elseif (Test-Path $link) { 'a different file has that name' } else { 'not installed' }))
Write-Host ('Program running on port ' + (Get-BridgePort) + ': ' + $(if (Get-Bridge) { 'yes' } else { 'no' }))
exit 0
