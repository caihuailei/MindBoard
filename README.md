# StudyKit

本地 AI 学习工作台。课堂录音转写 + AI 导师对话 + 课程管理。

## 功能

- **语音转写** — 基于 Qwen3-ASR 模型，支持高精度中文转写、ASS 字幕生成、AI 双语翻译
- **AI 导师** — 多角色切换（数学/语文/英语/物理/编程/通用），流式输出，自动追问
- **Nanobot 记忆管家** — 基于持久化文件的自主 AI Agent，支持自我学习与偏好更新
- **课程管理** — 周课表、课程提醒、硬件监控

## 快速开始

### 环境要求

- Python 3.10+
- CUDA 12.x（GPU 加速，可选）

### 安装

```bash
pip install -r requirements.txt
# 安装 Qwen3-ASR（参考 https://github.com/QwenLM/Qwen3-ASR）
pip install qwen-asr[transformers]
```

### 配置

复制 `.env.example` 为 `.env`，修改模型路径和服务端口：

```bash
cp .env.example .env
```

### 启动

```bash
python asr_api_server.py
# 或双击 start.bat (Windows)
```

访问 http://localhost:8000

## 项目结构

```
asr_api_server.py      # 主服务（FastAPI）
config.py              # 配置管理
nanobot_manager.py     # Nanobot Agent 管理
frontend/              # 前端 SPA（HTML/CSS/JS）
requirements.txt       # Python 依赖
.env.example           # 环境变量模板
```

## 技术栈

- **后端**: FastAPI + Qwen3-ASR + WebSocket + SSE
- **前端**: 原生 HTML/CSS/JS，SPA 路由
- **AI**: OpenAI 兼容 API（支持多提供商切换）
