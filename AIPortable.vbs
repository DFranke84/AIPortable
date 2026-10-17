' AIPortable.vbs - double-click launcher for Windows.
'
' Resolves its own folder (not a hardcoded path), so this works identically
' whether it's run from E:\AIPortable, a USB drive at D:\, or that same USB
' drive plugged into a different machine where it shows up as a different
' drive letter. Runs without popping up a console window.
'
' Prefers a packaged build (dist\win-unpacked\LocalAI.exe) if one exists,
' since that's fully self-contained and needs nothing installed on the host
' machine. Otherwise runs from source with Electron's own electron.exe -
' Node.js isn't needed at launch time (setup may have used a portable copy
' that isn't on PATH, which electron.cmd would need).

Dim sDir
sDir = Left(WScript.ScriptFullName, Len(WScript.ScriptFullName) - Len("\AIPortable.vbs"))

Dim oShell, oFso
Set oShell = CreateObject("WScript.Shell")
Set oFso = CreateObject("Scripting.FileSystemObject")
oShell.CurrentDirectory = sDir

Dim sPackaged, sElectron
sPackaged = sDir & "\dist\win-unpacked\LocalAI.exe"
sElectron = sDir & "\node_modules\electron\dist\electron.exe"

If oFso.FileExists(sPackaged) Then
  oShell.Run """" & sPackaged & """", 1, False
ElseIf oFso.FileExists(sElectron) Then
  oShell.Run """" & sElectron & """ """ & sDir & """", 1, False
Else
  MsgBox "Setup isn't finished yet." & vbCrLf & vbCrLf & _
    "Double-click Setup-Windows.bat in this folder first." & vbCrLf & _
    "It needs an internet connection once. After it finishes, double-click " & _
    "this file again.", vbExclamation, "AIPortable"
End If
