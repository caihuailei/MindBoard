@echo off
cd /d D:\work\asr-server

REM Check if Electron is available
npx electron --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Electron not found, falling back to browser mode...
    start "" wscript.exe "%~dp0start-browser.vbs"
    exit /b
)

REM Launch Electron desktop mode
npx electron electron/main.js
