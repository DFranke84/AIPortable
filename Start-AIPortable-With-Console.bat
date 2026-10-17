@echo off
REM Start-AIPortable-With-Console.bat - plain-text alternative to
REM AIPortable.vbs that keeps a console open for log output. Same logic:
REM prefer a packaged build if present, otherwise run from source via
REM Electron's own executable (Node.js is not needed at launch time).

cd /d "%~dp0"

if exist "dist\win-unpacked\LocalAI.exe" (
    "dist\win-unpacked\LocalAI.exe" --enable-logging
    goto :eof
)

if exist "node_modules\electron\dist\electron.exe" (
    "node_modules\electron\dist\electron.exe" "%~dp0." --enable-logging
    goto :eof
)

echo Setup isn't finished yet.
echo.
echo Double-click Setup-Windows.bat in this folder first (needs an internet
echo connection once). After it finishes, run this file again.
pause
