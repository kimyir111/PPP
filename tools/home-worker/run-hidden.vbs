' PPP home worker: started by the pppworker:// link (README.md, and section 15 of docs/GOALS/G10B_HOME_WORKER.md).
' It runs run-once-hidden.cmd (next to this file) in a hidden window and does NOT wait for it.
' It ignores every argument: the registered command passes none, and this file never looks at any, so
' whatever a web page puts after pppworker:// cannot reach this PC.
Option Explicit
Dim fso, shell, here
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & here & "\run-once-hidden.cmd""", 0, False
