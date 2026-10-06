# AN EXAMPLE, NOT RUN BY ANYTHING. Read it, change the interval, and run it yourself if you want a Windows scheduled task.
#   powershell -ExecutionPolicy Bypass -File tools\home-worker\schedule-task-example.ps1
#
# It registers one task, "PPP home worker", that runs `worker.js --once` at your log-on and then every $IntervalHours hours
# while you are logged on. Each run is one check of the site: when nothing is waiting it ends at once. Every check wakes the
# free PPP server for 15 minutes (see docs/GOALS/G10B_HOME_WORKER.md), so do not make the interval short: 3 hours or more
# costs the server about 9% of its month; an hour about 26%; 20 minutes about 77%.
# To remove it:  Unregister-ScheduledTask -TaskName "PPP home worker" -Confirm:$false
param([int]$IntervalHours = 3)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $node -Argument 'tools\home-worker\worker.js --once' -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours $IntervalHours)).Repetition
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'PPP home worker' -Action $action -Trigger $trigger -Settings $settings -Description 'PPP high-quality conversion on this PC' | Out-Null
Write-Host "Registered 'PPP home worker': worker.js --once at log-on and every $IntervalHours h."
