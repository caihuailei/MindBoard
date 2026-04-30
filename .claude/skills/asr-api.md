---
name: asr-api
description: 调用本机 ASR 语音转写服务，将课堂录音/视频转写为文字，可选 LLM 润色
---

# ASR 语音转写服务 — AI Agent 使用指南

本技能用于调用本机的 **ASR API 服务**，将课堂录音或视频转写为文字，并可选接入 LLM 对结果进行润色。

## 第一步：确认服务器地址

在开始之前，请用户确认服务器 IP 地址。让用户运行：

```bash
ipconfig
```

从输出中找到本机的局域网 IP（通常是 `192.168.x.x`）。需要用户确认使用哪个 IP 来访问服务。

> 如果 ASR 服务未启动，请用户先启动：
> ```bash
> cd 项目目录 && python asr_api_server.py
> ```

## 第二步：API 端点速查

| 端点 | 方法 | 说明 |
|---|---|---|
| `/health` | GET | 健康检查 |
| `/transcribe` | POST | 上传文件转写 |
| `/transcribe_url` | POST | 传 URL 转写 |
| `/transcribe_status/{file_id}` | GET | 查看进度 |
| `/transcribe_list` | GET | 列出进行中的任务 |
| `/refine` | POST | LLM 润色文本 |
| `/full_pipeline` | POST | ASR + LLM 完整流水线 |

## 第三步：常见调用场景

### 场景 A：上传视频/音频转写

```bash
curl -X POST http://{SERVER_IP}:8000/transcribe \
  -F "file=@/path/to/lecture.mp4" \
  -F "language=Chinese" \
  -F "max_chars=50" \
  -F "pause_threshold=0.3" \
  --max-time 3600 \
  -o result.json
```

支持格式：`.mp4 .avi .mkv .mov .wav .mp3 .m4a` 等。

### 场景 B：通过 URL 转写（无需上传文件）

```bash
curl -X POST http://{SERVER_IP}:8000/transcribe_url \
  -F "url=https://example.com/lecture.mp4" \
  -F "language=Chinese"
```

### 场景 C：轮询进度

```bash
# 列出所有进行中的任务
curl http://{SERVER_IP}:8000/transcribe_list

# 查看某个任务详情（含已转写出的文字）
curl http://{SERVER_IP}:8000/transcribe_status/{file_id}
```

### 场景 D：ASR + LLM 润色一步到位

```bash
curl -X POST http://{SERVER_IP}:8000/full_pipeline \
  -F "file=@lecture.mp4" \
  -F "language=Chinese" \
  -F "enable_llm=true" \
  -F "api_key=ms-你的魔搭token" \
  -F "api_url=https://api-inference.modelscope.cn/v1" \
  -F "model_name=ZhipuAI/GLM-5"
```

## 第四步：返回结果格式

转写完成后返回 JSON：

```json
{
  "success": true,
  "file_id": "a1b2c3d4",
  "text": "完整转写文本……",
  "language": "Chinese",
  "duration_sec": 10583.3,
  "segments": [
    {"start": 0.0, "end": 5.2, "text": "大家好今天我们来讲网络安全"}
  ],
  "words": [
    {"start": 0.0, "end": 0.5, "word": "大家"}
  ]
}
```

## 注意事项

- **长音频耗时**：3 小时音频约需 1-3 小时处理，建议轮询进度
- **GPU 满载**：转写时 GPU 100%，不要同时启动多个任务
- **LLM 润色**：建议先转写拿到文本后，再单独调 `/refine`，不要和转写同时跑
- **远程调用**：局域网内其他设备直接用 `http://{SERVER_IP}:8000` 访问
