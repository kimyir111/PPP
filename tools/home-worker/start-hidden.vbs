' PPP home worker: started at every sign-in by the shortcut that install-startup.cmd puts in this user's Startup folder (README.md, and section 16 of docs/GOALS/G10B_HOME_WORKER.md).
' It runs start-hidden.cmd (next to this file) in a hidden window and does NOT wait for it. The program that starts is  worker.js --serve  (the localhost bridge).
' It ignores every argument: the shortcut passes none and this file never looks at any, so nothing a command line or a web page says can reach it.
Option Explicit
Dim fso, shell, here
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & here & "\start-hidden.cmd""", 0, False
