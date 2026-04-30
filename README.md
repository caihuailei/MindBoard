# ASR API 服务 — 课堂录音转写 + LLM 润色

基于 Qwen3-ASR 模型的语音转写服务，支持长达 3 小时的课堂录音/视频处理，自适应句子合并，可选 LLM 专业知识注入润色。

## 目录结构

```
项目根目录\
├── asr_api_server.py         # FastAPI 服务主程序
├── start.bat                 # 一键启动
├── setup_and_run.bat         # 一键安装依赖+启动
├── test_pipeline.py          # ASR + 合并测试脚本
├── CLAUDE.md                 # AI Agent 项目指引
├── .claude\                   # Claude Code 配置
│   └── skills\asr-api.md     # ASR API 调用 skill（AI Agent 手册）
├── models\                    # AI 模型（需自行下载）
│   ├── Qwen3-ASR-1.7B\       # ASR 语音识别模型
│   └── Qwen3-ForcedAligner-0.6B\  # 时间戳对齐模型
├── qwen_asr_source\           # qwen_asr Python 包源码
│   └── Qwen3-ASR-main\
└── reference\                 # 参考代码
    └── transby2-main\
```

## 硬件要求

- **GPU**: NVIDIA RTX 3060+ (8GB VRAM)，建议 12GB+
- **磁盘**: 模型约占用 8GB 空间
- **系统**: Windows 10/11（已测试）或 Linux

## 依赖安装

本项目使用 **Anaconda3** 的 base 环境。

### 1. CUDA + cuDNN（GPU 加速必需）

- CUDA 12.8：https://developer.nvidia.com/cuda-12-8-0-download-archive
- cuDNN 9.8：https://developer.nvidia.com/cudnn-9-8-0-download-archive

安装后将 cuDNN 的 `bin/`、`include/`、`lib/x64/` 文件夹内容分别复制到 CUDA 对应目录。

### 2. Python 依赖

所有依赖都安装到 Anaconda3 base 环境：

```bash
# 激活 conda base（如未激活）
conda activate base

# 安装 PyTorch（CUDA 12.8 版本，RTX 5060 Blackwell 需要 PyTorch 2.7+）
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128

# 安装项目依赖
pip install fastapi uvicorn openai requests pydantic

# 安装 qwen_asr 包（dev 模式，从源码安装）
cd 项目根目录\qwen_asr_source\Qwen3-ASR-main
pip install -e .

# safetensors（模型加载必需）
pip install safetensors
```

> 当前已验证环境：PyTorch 2.11.0+cu128 / Python 3.12 / CUDA 12.8

### 3. ffmpeg

用于从视频中提取音频。确保 `ffmpeg` 在系统 PATH 中可用，或将 ffmpeg.exe 放在项目目录下。

### 4. 环境变量

```bash
# Windows 下解决 OpenMP 库冲突
set KMP_DUPLICATE_LIB_OK=TRUE
```

## 启动服务

```bash
cd 项目根目录
python asr_api_server.py
```

或双击 `start.bat`。

服务默认监听 `http://0.0.0.0:8000`，局域网内其他设备可通过服务器 IP 访问。

## API 端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/` | GET | 重定向到 AI Agent 指南 |
| `/guide` | GET | AI Agent / 开发者接入指南页面 |
| `/health` | GET | 健康检查 |
| `/transcribe` | POST | 上传文件并转写 |
| `/transcribe_url` | POST | 传 URL 转写 |
| `/transcribe_status/{file_id}` | GET | 查看转写进度 |
| `/transcribe_list` | GET | 列出所有进行中的任务 |
| `/transcribe_ass` | POST | 转写 + ASS 字幕下载 |
| `/refine` | POST | LLM 润色文本 |
| `/full_pipeline` | POST | ASR + LLM 完整流水线 |
| `/openapi.json` | GET | OpenAPI 规范 |

## AI Agent 调用方式

AI Agent 可以通过 HTTP POST 直接调用：

```bash
# 上传本地视频转写
curl -X POST http://192.168.x.x:8000/transcribe \
  -F "file=@lecture.mp4" \
  -F "language=Chinese" \
  -F "context=网络安全课程" \
  --max-time 3600 \
  -o result.json

# 传 URL 转写
curl -X POST http://192.168.x.x:8000/transcribe_url \
  -F "url=https://example.com/lecture.mp4" \
  -F "language=Chinese"

# 轮询进度
curl http://192.168.x.x:8000/transcribe_status/{file_id}
```

详细信息请访问运行中的 `/guide` 页面。

## LLM 润色配置

`/refine` 和 `/full_pipeline` 支持三种 LLM 方式：

### 方式 A：DeepSeek API（推荐，开箱即用）

1. 去 https://platform.deepseek.com 注册获取 API Key
2. 调用时传入参数：

```bash
curl -X POST http://localhost:8000/refine \
  -F "text=需要润色的文本..." \
  -F "api_key=sk-你的deepseek密钥" \
  -F "api_url=https://api.deepseek.com" \
  -F "model_name=deepseek-chat"
```

或直接用 `/full_pipeline` 一步到位：

```bash
curl -X POST http://localhost:8000/full_pipeline \
  -F "file=@lecture.mp4" \
  -F "enable_llm=true" \
  -F "api_key=sk-你的deepseek密钥" \
  -F "model_name=deepseek-chat"
```

> DeepSeek 新用户送额度，课堂文本量消耗很小，几毛钱能用很久。

### 方式 B：Ollama 本地模型（免费，需安装）

1. 下载安装 Ollama：https://ollama.com
2. 拉取一个中文能力好的模型：

```bash
ollama pull qwen2.5:7b
```

3. Ollama 默认在 `http://localhost:11434` 启动，调用方式：

```bash
curl -X POST http://localhost:8000/refine \
  -F "text=需要润色的文本..." \
  -F "api_key=ollama" \
  -F "api_url=http://localhost:11434/v1" \
  -F "model_name=qwen2.5:7b"
```

> 7B 模型在 RTX 5060 上可以流畅运行，但 ASR 转写时 GPU 已占满，建议转写完成后再跑 LLM 润色，两者不要同时进行。

### 方式 C：LM Studio（图形化，适合新手）

1. 下载安装 LM Studio：https://lmstudio.ai
2. 在 LM Studio 中搜索下载模型（如 `Qwen2.5-7B-GGUF`）
3. 启动 Local Server（设置 → 开启 OpenAI API 兼容）
4. 调用方式同上，`api_url` 改为 LM Studio 的地址（通常是 `http://localhost:1234/v1`）

### 完整流水线参数说明

| 参数 | 说明 | 默认值 |
|---|---|---|
| `enable_llm` | 是否启用 LLM 润色 | `false` |
| `api_key` | LLM API 密钥 | `""` |
| `api_url` | LLM API 地址 | `https://api.deepseek.com` |
| `model_name` | LLM 模型名 | `deepseek-v4-flash` |
| `system_prompt` | 自定义系统提示词 | 专业文档整理助手+5条规则 |
| `temperature` | 生成温度（0-1） | `0.3` |

> **注意**：转写时 GPU 已占满（VRAM ~7.8GB/8GB），建议先完成 ASR 转写，拿到文本后再单独调用 `/refine` 进行润色，而不是用 `/full_pipeline` 同时跑。
