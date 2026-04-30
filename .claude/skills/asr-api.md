---
name: asr-api
description: 调用本机 ASR 语音转写服务，将课堂录音/视频转写为文字，可选 LLM 润色、生成 ASS 字幕
---

# ASR 语音转写服务 — AI Agent 使用指南

本技能用于调用本机的 **ASR API 服务**，将课堂录音或视频转写为文字，并可选接入 LLM 对结果进行润色。

## 第一步：确认服务器地址

让用户确认局域网 IP：

```bash
ipconfig
```

从输出中找到 `192.168.x.x` 格式的 IP。如果服务未启动：

```bash
cd 项目目录 && python asr_api_server.py
```

## 第二步：API 端点速查

| 端点 | 方法 | 说明 |
|---|---|---|
| `/health` | GET | 健康检查（设备/GPU/模型状态） |
| `/transcribe_async` | POST | 非阻塞上传，返回 file_id + 排队 |
| `/transcribe_status/{file_id}` | GET | 轮询转写进度（含已转出文字） |
| `/transcribe_stream/{file_id}` | GET | SSE 实时推送转写进度 |
| `/transcribe_list` | GET | 列出所有活跃任务 |
| `/transcribe` | POST | 阻塞式转写（等全部完成返回） |
| `/transcribe_ass` | POST | 转写 + 生成 ASS 字幕文件 |
| `/refine` | POST | LLM 润色文本（非流式） |
| `/refine_stream` | POST | LLM 润色文本（流式 SSE） |
| `/full_pipeline` | POST | ASR + LLM 一步到位 |
| `/output_dir` | GET/POST | 获取/设置输出目录 |
| `/save_result` | POST | 保存转写结果到输出目录（.md） |
| `/save_text` | POST | 保存任意文本到输出目录 |
| `/results` | GET | 列出已持久化的结果 |
| `/results/{file_id}` | GET | 获取单个结果的完整 JSON |
| `/files` | GET | 列出输出目录所有文件 |
| `/download/{filename}` | GET | 下载输出目录中的文件 |
| `/llm_config` | GET/POST | 获取/设置 LLM 配置 |

## 第三步：常见调用场景

### 场景 A：异步上传 + 轮询进度（推荐）

```bash
# 1. 上传文件，立刻返回 file_id
curl -X POST http://{SERVER_IP}:8000/transcribe_async \
  -F "file=@lecture.mp4" \
  -F "language=Chinese" \
  -F "max_chars=50" \
  -F "pause_threshold=0.3"
# 返回: {"file_id": "a1b2c3d4", "position": 1, "status": "queued"}

# 2. 轮询进度
curl http://{SERVER_IP}:8000/transcribe_status/a1b2c3d4

# 3. 完成后获取完整结果
curl http://{SERVER_IP}:8000/results/a1b2c3d4
```

### 场景 B：SSE 实时流式获取进度

```bash
# SSE 事件流，每 0.3 秒推送一次最新状态
curl -N http://{SERVER_IP}:8000/transcribe_stream/a1b2c3d4
```

每个事件格式：`data: {"status": "transcribing", "words": [...], "chunks_done": 5, "total_duration": 180.5}`

### 场景 C：ASR + LLM 润色一步到位

```bash
curl -X POST http://{SERVER_IP}:8000/full_pipeline \
  -F "file=@lecture.mp4" \
  -F "language=Chinese" \
  -F "enable_llm=true" \
  -F "api_key=sk-xxx" \
  -F "api_url=https://api.deepseek.com" \
  -F "model_name=deepseek-chat"
```

### 场景 D：单独调用 LLM 润色已有文本

```bash
curl -X POST http://{SERVER_IP}:8000/refine \
  -F "text=需要润色的文本..." \
  -F "api_key=sk-xxx" \
  -F "api_url=https://api.deepseek.com" \
  -F "model_name=deepseek-chat"
```

### 场景 E：生成 ASS 字幕

```bash
curl -X POST http://{SERVER_IP}:8000/transcribe_ass \
  -F "file=@lecture.mp4" \
  -F "language=Chinese" \
  -o subtitle.ass
```

### 场景 F：下载已保存的文件

```bash
# 列出输出目录所有文件
curl http://{SERVER_IP}:8000/files

# 下载具体文件
curl -O http://{SERVER_IP}:8000/download/lecture.md
curl -O http://{SERVER_IP}:8000/download/subtitle.ass
```

### 场景 G：远程管理 LLM 配置

```bash
# 查看当前配置
curl http://{SERVER_IP}:8000/llm_config

# 设置配置
curl -X POST http://{SERVER_IP}:8000/llm_config \
  -H "Content-Type: application/json" \
  -d '{"api_url":"https://api.deepseek.com","api_key":"sk-xxx","model_name":"deepseek-chat","system_prompt":"你是一个助手。","temperature":0.3}'
```

## 第四步：返回结果格式

### 异步上传响应
```json
{"file_id": "a1b2c3d4", "position": 1, "status": "queued"}
```

### 进度查询响应
```json
{
  "status": "transcribing",
  "words": [{"start": 0.0, "end": 0.5, "word": "大家"}],
  "chunks_done": 5,
  "total_duration": 180.5,
  "source": "upload"
}
```

### 完整结果（/results/{file_id}）
```json
{
  "file_id": "a1b2c3d4",
  "filename": "lecture.mp4",
  "full_text": "完整转写文本……",
  "segments": [
    {"start": 0.0, "end": 5.2, "text": "大家好今天我们来讲网络安全"}
  ],
  "duration_sec": 10583.3,
  "language": "Chinese",
  "completed_at": 1714000000.0
}
```

## 第五步：推荐工作流

```
上传文件 → /transcribe_async → 拿到 file_id
     ↓
轮询进度 → /transcribe_status/{file_id} （每 3-5 秒一次）
     ↓
完成后获取 → /results/{file_id} （拿到 full_text + segments）
     ↓
(可选) LLM 润色 → /refine （传入 full_text）
     ↓
保存到输出目录 → /save_result
     ↓
下载文件 → /download/{filename}.md
```

## 注意事项

- **长音频耗时**：3 小时音频约需 1-3 小时处理，建议轮询进度
- **GPU 满载**：转写时 GPU 100%、VRAM ~7.8GB/8GB，不要同时启动多个任务
- **LLM 润色**：建议先转写拿到文本后，再单独调 `/refine`，不要和转写同时跑
- **远程调用**：局域网内其他设备直接用 `http://{SERVER_IP}:8000` 访问
- **文件自动清理**：处理完成后临时文件自动删除，但 chunk 文件可能在异常中断时残留
