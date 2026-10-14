' AIPortable.vbs — double-click launcher for Windows.
'
' Resolves its own folder (not a hardcoded path), so this works identically
' whether it's run from E:\AIPortable, a USB drive at D:\, or that same USB
' drive plugged into a different machine where it shows up as a different
' drive letter. Runs without popping up a console window.
'
' Prefers a packaged build (dist\win-unpacked\LocalAI.exe) if one exists,
' since that's fully self-contained and needs nothing installed on the host
' machine. Falls back to running from source via the local node_modules
' copy of Electron (dev mode — needs `npm install` to have been run once).

Dim sDir
sDir = Left(WScript.ScriptFullName, Len(WScript.ScriptFullName) - Len("\AIPortable.vbs"))

Dim oShell, oFso
Set oShell = CreateObject("WScript.Shell")
Set oFso = CreateObject("Scripting.FileSystemObject")
oShell.CurrentDirectory = sDir

Dim sPackaged
sPackaged = sDir & "\dist\win-unpacked\LocalAI.exe"

If oFso.FileExists(sPackaged) Then
  oShell.Run """" & sPackaged & """", 1, False
ElseIf oFso.FileExists(sDir & "\node_modules\.bin\electron.cmd") Then
  oShell.Run "cmd /c """"" & sDir & "\node_modules\.bin\electron.cmd"" .""", 0, False
Else
  MsgBox "Setup isn't finished yet." & vbCrLf & vbCrLf & _
    "Open a command prompt in this folder and run:" & vbCrLf & _
    "    npm install" & vbCrLf & vbCrLf & _
    "That needs an internet connection once. After it finishes, double-click " & _
    "this file again.", vbExclamation, "AIPortable"
End If
