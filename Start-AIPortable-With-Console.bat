@echo off
REM Start-AIPortable.bat — plain-text alternative to AIPortable.vbs, for
REM anyone who'd rather see exactly what's running than double-click a
REM .vbs file. Does the same thing: prefer a packaged build if present,
REM otherwise run from source via the local Electron install.

cd /d "%~dp0"

if exist "dist\win-unpacked\LocalAI.exe" (
    start "" "dist\win-unpacked\LocalAI.exe"
    goto :eof
)

if exist "node_modules\.bin\electron.cmd" (
    call node_modules\.bin\electron.cmd .
    goto :eof
)

echo Setup isn't finished yet.
echo.
echo Open a command prompt in this folder and run:
echo     npm install
echo.
echo That needs an internet connection once. After it finishes, run this
echo file again.
pause
