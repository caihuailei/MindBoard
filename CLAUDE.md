# ASR API 服务 — AI Agent 项目指引

本文件是 Claude Code 的项目指引，包含项目结构、关键文件说明、启动方式和操作注意事项。

## 项目概述

基于 **Qwen3-ASR-1.7B** 的语音转写 API 服务，运行在 **Windows 11 + RTX 5060 (8GB VRAM)** 上。
Python 环境：**Anaconda3 base**，PyTorch 2.11.0+cu128。
功能：音视频上传 → ASR 转写 → 自适应句子合并 → (可选) LLM 专业知识润色 → 返回干净文档。

## 关键文件

| 文件 | 说明 |
|---|---|
| `asr_api_server.py` | FastAPI 服务，所有端点入口 |
| `test_pipeline.py` | 离线测试脚本（不依赖 API） |
| `start.bat` | Windows 一键启动 |
| `models/Qwen3-ASR-1.7B/` | ASR 模型 |
| `models/Qwen3-ForcedAligner-0.6B/` | 时间戳对齐模型 |
| `qwen_asr_source/Qwen3-ASR-main/` | qwen_asr 包源码（pip install -e 安装） |

## 启动/停止

```bash
# 启动（前台，Ctrl+C 停止）
cd 项目根目录 && python asr_api_server.py

# 停止（Windows）
taskkill //F //PID $(netstat -ano | grep ":8000.*LISTEN" | awk '{print $5}')
```

首请求会加载模型（约 3s），后续请求无需重新加载。

## API 端点速查

- `GET /health` — 健康检查
- `POST /transcribe` — 上传文件转写（阻塞）
- `POST /transcribe_async` — 上传文件转写（非阻塞+排队）
- `POST /transcribe_ass` — 转写 + 生成 ASS 字幕
- `GET /transcribe_status/{file_id}` — 查看进度（含已转出的文字）
- `GET /transcribe_stream/{file_id}` — SSE 流式推送转写进度
- `GET /transcribe_list` — 列出所有活跃任务
- `POST /refine` — LLM 润色文本（非流式）
- `POST /refine_stream` — LLM 润色文本（流式 SSE）
- `POST /full_pipeline` — ASR + LLM 完整流水线
- `GET /output_dir` / `POST /output_dir` — 获取/设置输出目录
- `POST /save_result` — 保存转写结果到输出目录（.md+frontmatter）
- `POST /save_text` — 保存任意文本到输出目录
- `GET /results` — 列出已持久化的结果
- `GET /results/{file_id}` — 获取单个结果完整 JSON
- `GET /files` — 列出输出目录所有文件
- `GET /download/{filename}` — 下载输出目录中的文件
- `GET /llm_config` / `POST /llm_config` — 获取/设置 LLM 配置

## LLM 润色配置

`/refine` 和 `/full_pipeline` 使用 OpenAI 兼容接口，支持三种方式：

### DeepSeek API（默认）
```
api_url = https://api.deepseek.com
model_name = deepseek-chat
api_key = sk-xxx    # 从 platform.deepseek.com 获取
```

### Ollama 本地
```
api_url = http://localhost:11434/v1
model_name = qwen2.5:7b
api_key = ollama     # Ollama 不验证 key，随便填
```
安装：ollama.com → `ollama pull qwen2.5:7b`

### LM Studio 本地
```
api_url = http://localhost:1234/v1
model_name = 你加载的模型名
api_key = not-needed
```
安装：lmstudio.ai → 加载模型 → 开启 Local Server

> **重要**：转写时 GPU 已满载（~7.8GB/8GB），LLM 润色和 ASR 转写不要同时跑。建议先单独跑 `/transcribe` 拿到文本，再调 `/refine`。

## 重要注意事项

1. **长音频处理**：3 小时音频约需 1-3 小时。用 `/transcribe_list` + `/transcribe_status` 轮询进度。
2. **GPU 满载**：转写时 GPU 100%、VRAM ~7.8GB/8GB。不要同时启动多个转写任务。
3. **ffmpeg 编码**：`extract_audio()` 使用 `DEVNULL` 重定向输出，避免 Windows GBK 编码问题。
4. **模型路径**：使用相对路径 `BASE_DIR / "models" / ...`，与脚本位置无关。
5. **并发问题**：所有端点都是 `def`（同步），FastAPI 自动分配到线程池执行。但模型是单例，串行处理。
6. **KMP_DUPLICATE_LIB_OK**：已在代码中设置 `os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"`。
7. **临时文件**：上传文件和中间 WAV 文件存放在系统临时目录 `asr_api/`，处理完后自动清理。
8. **进度追踪**：`_transcription_progress` 全局字典，用 `file_id` 索引。线程安全（`_progress_lock`）。

## 代码架构

```
fastapi endpoint
  → load_model() (单例, lazy)
  → 保存上传文件到 TEMP_DIR
  → extract_audio() (如果是视频, ffmpeg → pcm_s16le 16kHz mono)
  → mdl.transcribe_streaming() (generator, 逐块处理)
  → _update_progress() (每块更新全局进度)
  → merge_segments_adaptive() (Transby2 算法: 标点分句 + max_chars + pause_threshold)
  → 返回 JSON
```

### 关键函数

- `_transcribe_file(mdl, file_id, input_path, ext, ...)` — 核心转写逻辑
- `merge_segments_adaptive(words, max_chars, pause_threshold)` — 自适应句子合并
- `_join_words(words_list, is_chinese)` — 中英文空格处理
- `_call_llm(api_key, api_url, ...)` — LLM API 调用（openai 库）
- `_update_progress(file_id, **kwargs)` — 线程安全更新进度

### 自适应合并逻辑

1. 按标点（。！？…, etc.）分"概念句"
2. 每个概念句内，按 `max_chars`（默认 50）和 `pause_threshold`（默认 0.3s）再细分
3. 英文用空格连接，中文直接拼接，标点前多余空格被清理

## 测试

```bash
# 测试 ASR + 合并（需要 GPU）
cd 项目根目录 && python test_pipeline.py
```

## Skill 文件

项目自带一个 `/asr-api` skill，位于 `.claude/skills/asr-api.md`，包含完整的 AI Agent 调用指南。当其他 AI agent 需要调用本服务时，可以告诉它查看这个文件。

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.