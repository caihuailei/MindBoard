@echo off
chcp 65001 >nul
title ASR API 服务 - 安装与启动
cd /d %~dp0

echo ============================================
echo   ASR API 服务 - 一键安装与启动
echo   流式润色 / .md 保存 / 自动排队
echo ============================================
echo.

:: 检查 Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Python，请先安装 Anaconda3
    pause
    exit /b 1
)
echo [OK] Python 版本:
python --version

:: 检查必要的 Python 包
echo.
echo [1/4] 检查 Python 依赖...
pip show fastapi >nul 2>&1
if %errorlevel% neq 0 (
    echo   -^> 安装 fastapi uvicorn openai requests pydantic...
    pip install fastapi uvicorn openai requests pydantic
) else (
    echo   -^> fastapi 已安装
)

pip show openai >nul 2>&1
if %errorlevel% neq 0 (
    echo   -^> 安装 openai...
    pip install openai
) else (
    echo   -^> openai 已安装
)

pip show safetensors >nul 2>&1
if %errorlevel% neq 0 (
    echo   -^> 安装 safetensors...
    pip install safetensors
) else (
    echo   -^> safetensors 已安装
)

:: 安装 qwen_asr
echo.
echo [2/4] 检查 qwen_asr 包...
python -c "from qwen_asr import Qwen3ASRModel" >nul 2>&1
if %errorlevel% neq 0 (
    echo   -^> 从源码安装 qwen_asr...
    cd qwen_asr_source\Qwen3-ASR-main
    pip install -e .
    cd %~dp0
) else (
    echo   -^> qwen_asr 已安装
)

:: 检查模型
echo.
echo [3/4] 检查模型文件...
if not exist "models\Qwen3-ASR-1.7B\" (
    echo   [警告] 未找到 ASR 模型 models\Qwen3-ASR-1.7B\
    echo   请将模型放入 models\ 目录后再启动
) else (
    echo   -^> ASR 模型 OK
)
if not exist "models\Qwen3-ForcedAligner-0.6B\" (
    echo   [警告] 未找到对齐器模型 models\Qwen3-ForcedAligner-0.6B\
    echo   请将模型放入 models\ 目录后再启动
) else (
    echo   -^> 强制对齐器模型 OK
)

:: 检查 ffmpeg
echo.
echo [4/4] 检查 ffmpeg...
where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
    echo   [警告] ffmpeg 未在 PATH 中找到（视频转音频需要它）
    echo   下载 https://ffmpeg.org/download.html 并添加到 PATH
) else (
    echo   -^> ffmpeg OK
)

echo.
echo ============================================
echo  启动服务...
echo  浏览器打开: http://localhost:8000
echo  按 Ctrl+C 停止服务
echo ============================================
echo.

python asr_api_server.py

pause
