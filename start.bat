@echo off
chcp 65001 >nul
title ASR API Service
cd /d %~dp0
echo ============================================
echo   ASR API Server
echo ============================================
echo.
python asr_api_server.py
pause
