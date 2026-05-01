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

:: 安装 requirements.txt 中的依赖
echo.
echo [1/3] 安装 Python 依赖...
if exist requirements.txt (
    echo   -^> pip install -r requirements.txt
    pip install -r requirements.txt
) else (
    echo   [警告] 未找到 requirements.txt
)

:: 安装 qwen_asr
echo.
echo [2/3] 检查 qwen_asr 包...
python -c "from qwen_asr import Qwen3ASRModel" >nul 2>&1
if %errorlevel% neq 0 (
    if exist qwen_asr_source\Qwen3-ASR-main\ (
        echo   -^> 从源码安装 qwen_asr...
        cd qwen_asr_source\Qwen3-ASR-main
        pip install -e .
        cd %~dp0
    ) else (
        echo   [警告] 未找到 qwen_asr_source\Qwen3-ASR-main
    )
) else (
    echo   -^> qwen_asr 已安装
)

:: 检查模型
echo.
echo [3/3] 检查模型文件...
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
where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
    echo   [警告] ffmpeg 未在 PATH 中找到（视频转音频需要它）
) else (
    echo   -^> ffmpeg OK
)

:: 提示 .env 配置
echo.
if not exist .env (
    echo [提示] 未找到 .env 文件，如需配置 LLM API Key 请复制 .env.example 为 .env
)

echo.
echo ============================================
echo  启动服务...
echo  浏览器打开: http://localhost:8000
echo  按 Ctrl+C 停止服务
echo ============================================
echo.

:: Kill old process on port 8000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000"') do (
    taskkill /PID %%a /F >nul 2>&1
)

python asr_api_server.py

pause
