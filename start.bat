@echo off
chcp 65001 >nul
title ASR API Service
cd /d %~dp0
echo ============================================
echo   ASR API Server
echo ============================================
echo.

:: Kill old process on port 8000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000"') do (
    echo   Killing PID=%%a
    taskkill /PID %%a /F >nul 2>&1
)
echo.

python asr_api_server.py
pause
