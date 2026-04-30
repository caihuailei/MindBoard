"""
Qwen3-ASR API Server v2
参考 Transby2 的 merge 逻辑 + LLM 后处理
"""
import os, sys, json, uuid, tempfile, re, time, subprocess
from pathlib import Path
from typing import Optional, List

os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

import torch
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, PlainTextResponse, HTMLResponse
from pydantic import BaseModel
from qwen_asr import Qwen3ASRModel

# ============ 配置 ============
BASE_DIR = Path(__file__).parent
MODEL_PATH = str(BASE_DIR / "models" / "Qwen3-ASR-1.7B")
ALIGNER_PATH = str(BASE_DIR / "models" / "Qwen3-ForcedAligner-0.6B")
DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"
TEMP_DIR = Path(tempfile.gettempdir()) / "asr_api"
TEMP_DIR.mkdir(exist_ok=True)

app = FastAPI(title="ASR API 服务", version="2.0")
model: Optional[Qwen3ASRModel] = None

# ============ 转写进度追踪 ============
import threading
_progress_lock = threading.Lock()
_transcription_progress: dict = {}  # file_id -> {"status": str, "words": list, "chunks_done": int, "total_duration": float}


def _update_progress(file_id: str, **kwargs):
    with _progress_lock:
        if file_id not in _transcription_progress:
            _transcription_progress[file_id] = {"words": [], "chunks_done": 0, "total_duration": 0.0}
        _transcription_progress[file_id].update(kwargs)

# ============ Transby2 的自适应合并逻辑（精简版）============
SPLIT_PUNCTUATION = ['。', '!', '?', '…', ' ', '、', '，', '？', '！', '.', ',', ';', ':']
ALL_PUNCTUATION = SPLIT_PUNCTUATION + ['"', "'", '「', '」', '『', '』', '《', '》', '・']


def has_chinese(text):
    return any('一' <= ch <= '鿿' for ch in text)


def remove_punctuation(text):
    for p in ALL_PUNCTUATION:
        text = text.replace(p, '')
    return text


def _join_words(words_list, is_chinese):
    """根据语言类型用合适的方式连接词序列"""
    if not words_list:
        return ""
    if is_chinese:
        return "".join(w["word"] for w in words_list).strip()
    import re
    joined = " ".join(w["word"] for w in words_list)
    joined = re.sub(r'\s+([.,!?;:\'"])', r'\1', joined)
    joined = re.sub(r'\s+', ' ', joined)
    return joined.strip()


def merge_segments_adaptive(words: list, max_chars: int = 50, pause_threshold: float = 0.3) -> list:
    """
    自适应合并：按标点分句 → 按 max_chars 和 pause_threshold 细分
    words: [{"start": float, "end": float, "word": str}, ...]
    返回: [{"start": float, "end": float, "text": str}, ...]
    """
    if not words:
        return []

    is_chinese = has_chinese("".join(w["word"] for w in words))
    full_text = "".join(w["word"] for w in words)

    # 找概念句边界
    conceptual = []
    buf = []
    for ch in full_text:
        buf.append(ch)
        if ch in SPLIT_PUNCTUATION:
            s = "".join(buf).strip()
            if s:
                conceptual.append({"original": s, "clean": remove_punctuation(s).strip()})
            buf = []
    if buf:
        s = "".join(buf).strip()
        if s:
            conceptual.append({"original": s, "clean": remove_punctuation(s).strip()})

    if not conceptual:
        return []

    result = []
    word_idx = 0

    for sent in conceptual:
        clean = sent["clean"]
        if not clean:
            continue
        sent_words = []
        consumed = ""
        while word_idx < len(words):
            w_clean = remove_punctuation(words[word_idx]["word"]).strip()
            remaining = clean[len(consumed):]
            if w_clean and remaining.startswith(w_clean):
                sent_words.append(words[word_idx])
                consumed += w_clean
                word_idx += 1
            else:
                break
        if not sent_words:
            continue

        sub_buf = []
        sub_text_clean = ""
        for w in sent_words:
            w_clean = remove_punctuation(w["word"]).strip()
            is_pause = sub_buf and (w["start"] - sub_buf[-1]["end"]) > pause_threshold
            new_len = len(sub_text_clean) + len(w_clean) if sub_text_clean else len(w_clean)
            is_long = sub_buf and new_len > max_chars
            if is_pause or is_long:
                result.append({
                    "start": sub_buf[0]["start"],
                    "end": sub_buf[-1]["end"],
                    "text": _join_words(sub_buf, is_chinese),
                })
                sub_buf = [w]
                sub_text_clean = w_clean
            else:
                sub_buf.append(w)
                sub_text_clean = sub_text_clean + w_clean if sub_text_clean else w_clean
        if sub_buf:
            result.append({
                "start": sub_buf[0]["start"],
                "end": sub_buf[-1]["end"],
                "text": _join_words(sub_buf, is_chinese),
            })

    return result


# ============ 模型加载 ============
def load_model():
    global model
    if model is not None:
        return model
    print(f"加载模型中... (device={DEVICE})")
    model = Qwen3ASRModel.from_pretrained(
        pretrained_model_name_or_path=MODEL_PATH,
        dtype=torch.bfloat16,
        device_map=DEVICE,
        attn_implementation="sdpa",
        max_inference_batch_size=1,
        max_new_tokens=512,
        forced_aligner=ALIGNER_PATH,
        forced_aligner_kwargs=dict(
            dtype=torch.bfloat16,
            device_map=DEVICE,
            attn_implementation="sdpa",
        ),
    )
    print("模型加载完成！")
    return model


def extract_audio(video_path: str, audio_path: str):
    """ffmpeg 提取音频（不捕获输出，避免编码问题）"""
    subprocess.run([
        "ffmpeg", "-i", video_path, "-vn",
        "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", "-y", audio_path
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


# ============ API ============

@app.get("/health")
async def health():
    return {
        "status": "ok", "device": DEVICE,
        "model_loaded": model is not None,
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    }


# ============ AI Agent / 开发者指南 ============
AGENT_GUIDE_HTML = r"""
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>ASR API — AI Agent 接入指南</title>
<meta name="description" content="ASR API 接入文档 — 面向 AI Agent 和开发者的完整指南">
<style>
body{font-family:'Segoe UI',sans-serif;max-width:960px;margin:40px auto;padding:20px;line-height:1.7;background:#1a1a2e;color:#e0e0e0}
h1{color:#00d2ff;border-bottom:2px solid #00d2ff;padding-bottom:8px}
h2{color:#ffd700;margin-top:32px}
h3{color:#7ec8e3}
code{background:#2d2d4e;padding:2px 6px;border-radius:3px;font-size:.92em}
pre{background:#2d2d4e;padding:16px;border-radius:6px;overflow-x:auto;border-left:3px solid #00d2ff}
pre code{background:none;padding:0}
.alert{background:#3d2e2e;border-left:4px solid #ff6b6b;padding:12px 16px;margin:16px 0;border-radius:4px}
.info{background:#2e3d3e;border-left:4px solid #00d2ff;padding:12px 16px;margin:16px 0;border-radius:4px}
.endpoint{background:#2d2d4e;padding:8px 16px;border-radius:20px;display:inline-block;font-family:monospace;margin:4px 0}
table{border-collapse:collapse;width:100%;margin:12px 0}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #3d3d5e}
th{background:#2d2d4e;color:#ffd700}
</style></head>
<body>
<h1>ASR API — AI Agent 接入指南</h1>
<p>这是一份面向 <strong>AI Agent</strong> 和开发者的接入文档。服务器运行在 Windows 11 + RTX 5060 环境下，提供课堂录音/视频的 ASR 转写服务。</p>

<div class="alert">
<strong>服务器地址</strong><br>
<code>http://{host}:8000</code><br>
当前设备 IP（由服务器动态获取），如果 agent 在同一局域网，直接用此地址访问。
</div>

<div style="margin-bottom:32px;display:flex;gap:12px">
<a href="/config" style="display:inline-block;padding:10px 20px;background:#00d2ff;color:#1a1a2e;border-radius:6px;text-decoration:none;font-weight:600">配置 LLM</a>
<a href="/openapi.json" style="display:inline-block;padding:10px 20px;border:1px solid #00d2ff;color:#00d2ff;border-radius:6px;text-decoration:none">OpenAPI 规范</a>
</div>

<h2>一、如何上传视频/音频</h2>
<p>有两种方式将文件传给本服务：</p>

<h3>方式 A：直接上传（推荐）</h3>
<p>用 HTTP multipart/form-data 上传文件：</p>
<pre><code>curl -X POST http://{host}:8000/transcribe \
  -F "file=@/path/to/your/video.mp4" \
  -F "language=Chinese" \
  -F "max_chars=50" \
  -F "pause_threshold=0.3" \
  --max-time 3600 \
  -o result.json</code></pre>
<p>支持格式：<code>.mp4 .avi .mkv .mov .wmv .webm .ts .wav .mp3 .m4a</code> 等。</p>

<h3>方式 B：通过 URL 下载（无需上传文件）</h3>
<p>如果文件已经在某个 HTTP/HTTPS 地址上，直接传链接即可：</p>
<pre><code>curl -X POST http://{host}:8000/transcribe_url \
  -F "url=https://example.com/lecture.mp4" \
  -F "language=Chinese"</code></pre>
<p>服务器会自行下载到本地再处理。</p>

<h2>二、API 端点列表</h2>

<table>
<tr><th>端点</th><th>方法</th><th>说明</th></tr>
<tr><td><code>/health</code></td><td>GET</td><td>健康检查</td></tr>
<tr><td><code>/transcribe</code></td><td>POST</td><td>上传文件并转写</td></tr>
<tr><td><code>/transcribe_url</code></td><td>POST</td><td>传 URL 转写</td></tr>
<tr><td><code>/transcribe_status/{file_id}</code></td><td>GET</td><td>查看转写进度</td></tr>
<tr><td><code>/transcribe_list</code></td><td>GET</td><td>列出所有进行中的任务</td></tr>
<tr><td><code>/transcribe_ass</code></td><td>POST</td><td>转写并下载 ASS 字幕</td></tr>
<tr><td><code>/refine</code></td><td>POST</td><td>LLM 润色文本</td></tr>
<tr><td><code>/full_pipeline</code></td><td>POST</td><td>ASR + LLM 完整流水线</td></tr>
<tr><td><code>/openapi.json</code></td><td>GET</td><td>OpenAPI 规范（AI 自动发现）</td></tr>
</table>

<h2>三、AI Agent 最佳流程</h2>

<div class="info"><strong>推荐流程：</strong>作为 AI agent，建议按以下步骤操作：</div>

<h3>Step 1 — 获取文件</h3>
<p>如果你能直接拿到文件：</p>
<ul>
<li>用 <code>/transcribe</code> 上传（multipart/form-data）</li>
<li>用 <code>/transcribe_url</code> 传 URL（适合文件已在网上的情况）</li>
</ul>

<h3>Step 2 — 轮询进度</h3>
<p>转写返回的 <code>file_id</code> 可以用来查进度：</p>
<pre><code># 获取所有进行中的任务
curl http://{host}:8000/transcribe_list

# 查看具体任务的进度（含已转写出的文字片段）
curl http://{host}:8000/transcribe_status/{{file_id}}</code></pre>
<p>返回示例：</p>
<pre><code>{
  "file_id": "a1b2c3d4",
  "status": "transcribing",       // uploading → transcribing → merging → completed
  "words": [{"start":0.0, "end":0.5, "word":"你好"}],
  "chunks_done": 5,
  "total_duration": 180.5
}</code></pre>

<h3>Step 3 — 获取结果</h3>
<p>转写完成后，<code>/transcribe</code> 会直接返回完整结果：</p>
<pre><code>{
  "success": true,
  "file_id": "a1b2c3d4",
  "text": "完整转写文本……",
  "language": "Chinese",
  "duration_sec": 10583.3,
  "segments": [
    {"start": 0.0, "end": 5.2, "text": "大家好今天我们来讲网络安全"},
    ...
  ],
  "words": [...]      // 每个词的详细时间戳
}</code></pre>

<h3>Step 4 — (可选) LLM 润色</h3>
<p>提供三种方式，任选其一：</p>

<p><strong>方式 A：DeepSeek API（推荐，最快）</strong></p>
<pre><code>curl -X POST http://{host}:8000/refine \
  -F "text=需要润色的文本..." \
  -F "api_key=sk-你的deepseek密钥" \
  -F "api_url=https://api.deepseek.com" \
  -F "model_name=deepseek-chat"</code></pre>
<p>注册获取 Key：<a href="https://platform.deepseek.com" style="color:#00d2ff">platform.deepseek.com</a>，新用户送额度。</p>

<p><strong>方式 B：魔搭 ModelScope（推荐 GLM-5）</strong></p>
<pre><code>curl -X POST http://{host}:8000/refine \
  -F "text=需要润色的文本..." \
  -F "api_key=ms-你的魔搭token" \
  -F "api_url=https://api-inference.modelscope.cn/v1" \
  -F "model_name=ZhipuAI/GLM-5"</code></pre>
<p>Token 获取：<a href="https://modelscope.cn" style="color:#00d2ff">modelscope.cn</a> → 个人中心 → 创建 API Token</p>

<p><strong>方式 C：Ollama 本地免费模型</strong></p>
<pre><code># 1. 安装 Ollama（https://ollama.com）
# 2. 拉取模型（终端执行）：
#    ollama pull qwen2.5:7b
# 3. 调用：
curl -X POST http://{host}:8000/refine \
  -F "text=需要润色的文本..." \
  -F "api_key=ollama" \
  -F "api_url=http://localhost:11434/v1" \
  -F "model_name=qwen2.5:7b"</code></pre>

<p><strong>方式 C：LM Studio（图形化）</strong></p>
<pre><code># 1. 安装 LM Studio（https://lmstudio.ai）
# 2. 下载模型（如 Qwen2.5-7B-GGUF）
# 3. 开启 Local Server（设置 → OpenAI API）
# 4. 调用：
curl -X POST http://{host}:8000/refine \
  -F "text=需要润色的文本..." \
  -F "api_key=not-needed" \
  -F "api_url=http://localhost:1234/v1" \
  -F "model_name=你加载的模型名"</code></pre>

<p><strong>完整流水线一步到位：</strong></p>
<pre><code>curl -X POST http://{host}:8000/full_pipeline \
  -F "file=@lecture.mp4" \
  -F "enable_llm=true" \
  -F "api_key=你的密钥" \
  -F "api_url=https://api.deepseek.com" \
  -F "model_name=deepseek-chat"</code></pre>

<h2>四、重要提醒</h2>
<ul>
<li><strong>长音频：</strong>3 小时视频约需 1-3 小时处理，建议先用 <code>transcribe_list</code> 轮询</li>
<li><strong>GPU 占用：</strong>转写时 GPU 100% 满载，VRAM 占用 ~7.8GB/8GB</li>
<li><strong>文件自动清理：</strong>处理完成后临时文件会自动删除</li>
<li><strong>进度查询：</strong>任何时候都可以通过 <code>transcribe_status</code> 查看已转写出的文字</li>
</ul>

<h2>五、OpenAPI / Swagger</h2>
<p>标准的 OpenAPI 规范可以在以下地址获得，主流 AI 框架可以直接解析：</p>
<ul>
<li>Swagger UI: <a href="http://{host}:8000/docs" style="color:#00d2ff">http://{host}:8000/docs</a></li>
<li>OpenAPI JSON: <a href="http://{host}:8000/openapi.json" style="color:#00d2ff">http://{host}:8000/openapi.json</a></li>
</ul>
<p style="text-align:center;margin-top:60px;color:#888">—— 本页面由 ASR API 服务器自动生成 ——</p>
</body></html>"""


@app.get("/")
async def root():
    """重定向到 AI Agent 指南"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/guide")


@app.get("/guide")
async def agent_guide():
    """AI Agent / 开发者接入指南页面"""
    import socket
    hostname = socket.gethostbyname(socket.gethostname())
    html = AGENT_GUIDE_HTML.replace("{host}", hostname)
    return HTMLResponse(html)


# ============ LLM 配置页面 ============
CONFIG_HTML = r"""
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>LLM 配置 — ASR API</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:#1a1a2e;color:#e0e0e0;min-height:100vh;display:flex;flex-direction:column}
.header{background:#16213e;padding:16px 24px;border-bottom:1px solid #0f3460;display:flex;align-items:center;justify-content:space-between}
.header h1{color:#00d2ff;font-size:1.3em}
.header a{color:#888;text-decoration:none;font-size:.9em}
.header a:hover{color:#00d2ff}
.main{max-width:720px;margin:40px auto;padding:0 20px;flex:1}
.card{background:#16213e;border:1px solid #0f3460;border-radius:8px;padding:24px;margin-bottom:20px}
.card h2{color:#ffd700;margin-bottom:16px;font-size:1.1em}
.presets{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}
.preset-btn{padding:10px 18px;border:1px solid #0f3460;border-radius:6px;background:#1a1a2e;color:#e0e0e0;cursor:pointer;font-size:.9em;transition:all .2s}
.preset-btn:hover{border-color:#00d2ff;color:#00d2ff}
.preset-btn.active{border-color:#00d2ff;background:#0f3460;color:#00d2ff}
.form-group{margin-bottom:16px}
.form-group label{display:block;margin-bottom:6px;font-size:.9em;color:#aaa}
.form-group input,.form-group select{width:100%;padding:10px 12px;border:1px solid #0f3460;border-radius:6px;background:#1a1a2e;color:#e0e0e0;font-size:.95em;font-family:monospace}
.form-group input:focus{outline:none;border-color:#00d2ff}
.form-hint{font-size:.8em;color:#666;margin-top:4px}
.btn-row{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}
.btn{padding:10px 24px;border:none;border-radius:6px;cursor:pointer;font-size:.95em;font-weight:600;transition:all .2s}
.btn-primary{background:#00d2ff;color:#1a1a2e}
.btn-primary:hover{background:#33ddff}
.btn-secondary{background:transparent;border:1px solid #0f3460;color:#e0e0e0}
.btn-secondary:hover{border-color:#00d2ff}
.btn-danger{background:transparent;border:1px solid #ff6b6b;color:#ff6b6b}
.btn-danger:hover{background:#3d2e2e}
.result{padding:12px;border-radius:6px;margin-top:16px;font-family:monospace;font-size:.9em;display:none}
.result.success{display:block;background:#1e3d2e;border:1px solid #2ecc71;color:#2ecc71}
.result.error{display:block;background:#3d2e2e;border:1px solid #ff6b6b;color:#ff6b6b}
.result.info{display:block;background:#2e3d3e;border:1px solid #00d2ff;color:#7ec8e3}
.status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px}
.status-dot.connected{background:#2ecc71}
.status-dot.disconnected{background:#ff6b6b}
code{background:#2d2d4e;padding:2px 6px;border-radius:3px}
.footer{text-align:center;padding:20px;color:#666;font-size:.85em}
</style></head>
<body>

<div class="header">
  <h1>LLM 配置</h1>
  <a href="/guide">返回指南</a>
</div>

<div class="main">

  <div class="card">
    <h2>预设模板</h2>
    <div class="presets" id="presets">
      <button class="preset-btn active" data-preset="deepseek">DeepSeek</button>
      <button class="preset-btn" data-preset="openai">OpenAI</button>
      <button class="preset-btn" data-preset="modelscope">魔搭 ModelScope</button>
      <button class="preset-btn" data-preset="ollama">Ollama 本地</button>
      <button class="preset-btn" data-preset="lmstudio">LM Studio</button>
      <button class="preset-btn" data-preset="custom">自定义</button>
    </div>
    <form id="configForm">
      <div class="form-group">
        <label>API 地址 (base_url)</label>
        <input type="text" id="apiUrl" value="https://api.deepseek.com" placeholder="https://api.deepseek.com">
        <div class="form-hint">OpenAI 兼容接口地址，不需要加 /v1/chat/completions</div>
      </div>
      <div class="form-group">
        <label>API Key</label>
        <input type="password" id="apiKey" value="" placeholder="sk-..." autocomplete="off">
        <div class="form-hint">密钥仅保存在浏览器 localStorage，不会上传到服务器</div>
      </div>
      <div class="form-group">
        <label>模型名称</label>
        <input type="text" id="modelName" value="deepseek-chat" placeholder="deepseek-chat">
      </div>
      <div class="form-group">
        <label>系统提示词</label>
        <input type="text" id="systemPrompt" value="你是一个专业的文档整理助手。请对以下课堂录音文本进行处理：
1. 合并被切断的句子
2. 修正ASR识别错误
3. 补充专业术语的准确表述
4. 恢复正确的标点符号
5. 按语义分段，输出清晰的文档格式
直接输出结果，不要多余的解释。" placeholder="自定义润色指令...">
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" onclick="saveAndTest()">保存并测试</button>
        <button type="button" class="btn btn-secondary" onclick="saveConfig()">仅保存</button>
        <button type="button" class="btn btn-danger" onclick="clearConfig()">清除配置</button>
      </div>
      <div id="result" class="result"></div>
    </form>
  </div>

  <div class="card">
    <h2>当前连接状态</h2>
    <p><span class="status-dot" id="statusDot"></span><span id="statusText">未配置</span></p>
    <div style="margin-top:12px;font-size:.85em;color:#888">
      <p>API 地址: <code id="currentUrl">-</code></p>
      <p>模型: <code id="currentModel">-</code></p>
      <p>Key 已设置: <code id="currentKey">-</code></p>
    </div>
  </div>

</div>

<div class="footer">&mdash; 配置保存在浏览器本地，不会上传 &mdash;</div>

<script>
const PRESETS = {
  deepseek: { url:"https://api.deepseek.com", model:"deepseek-chat", desc:"云端 DeepSeek，性价比高" },
  openai:   { url:"https://api.openai.com/v1", model:"gpt-4o", desc:"云端 OpenAI" },
  modelscope: { url:"https://api-inference.modelscope.cn/v1", model:"ZhipuAI/GLM-5", desc:"魔搭 ModelScope，推荐 GLM-5" },
  ollama:   { url:"http://localhost:11434/v1", model:"qwen2.5:7b", desc:"本地免费，需安装 Ollama" },
  lmstudio: { url:"http://localhost:1234/v1", model:"", desc:"本地免费，需安装 LM Studio" },
  custom:   { url:"", model:"", desc:"手动填写" }
};

// Init
const saved = JSON.parse(localStorage.getItem('asr_llm_config') || '{}');
let currentPreset = saved._preset || 'deepseek';
applyPreset(currentPreset, false);
document.getElementById('apiKey').value = saved.api_key || '';
document.getElementById('systemPrompt').value = saved.system_prompt || document.getElementById('systemPrompt').value;
updateStatus();

// Preset buttons
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentPreset = btn.dataset.preset;
    applyPreset(currentPreset, true);
  });
});

function applyPreset(name, overwriteUrl) {
  const p = PRESETS[name];
  if (!p) return;
  if (overwriteUrl || !document.getElementById('apiUrl').value) {
    document.getElementById('apiUrl').value = p.url;
  }
  if (overwriteUrl || !document.getElementById('modelName').value) {
    document.getElementById('modelName').value = p.model;
  }
}

function getConfig() {
  return {
    api_url: document.getElementById('apiUrl').value.trim(),
    api_key: document.getElementById('apiKey').value.trim(),
    model_name: document.getElementById('modelName').value.trim(),
    system_prompt: document.getElementById('systemPrompt').value.trim(),
    _preset: currentPreset
  };
}

function saveConfig() {
  const c = getConfig();
  localStorage.setItem('asr_llm_config', JSON.stringify(c));
  showResult('info', '配置已保存到浏览器本地存储');
  updateStatus();
}

async function saveAndTest() {
  saveConfig();
  const c = getConfig();
  if (!c.api_url || !c.api_key || !c.model_name) {
    showResult('error', '请填写 API 地址、API Key 和模型名称');
    return;
  }
  showResult('info', '正在测试连接...');
  try {
    // 通过服务器的 /llm_test 端点测试
    const r = await fetch('/llm_test', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({api_url:c.api_url, api_key:c.api_key, model_name:c.model_name})
    });
    const data = await r.json();
    if (data.success) {
      showResult('success', '连接成功！模型可用');
      updateStatus(true);
    } else {
      showResult('error', '连接失败: ' + data.detail);
      updateStatus(false);
    }
  } catch(e) {
    showResult('error', '测试失败: ' + e.message);
  }
}

function clearConfig() {
  localStorage.removeItem('asr_llm_config');
  document.getElementById('apiKey').value = '';
  showResult('info', '配置已清除');
  updateStatus();
}

function showResult(type, msg) {
  const el = document.getElementById('result');
  el.className = 'result ' + type;
  el.textContent = msg;
}

function updateStatus(connected) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  const c = JSON.parse(localStorage.getItem('asr_llm_config') || '{}');
  document.getElementById('currentUrl').textContent = c.api_url || '-';
  document.getElementById('currentModel').textContent = c.model_name || '-';
  document.getElementById('currentKey').textContent = c.api_key ? '是' : '否';
  if (c.api_url && c.api_key && c.model_name) {
    dot.className = 'status-dot ' + (connected === true ? 'connected' : (connected === false ? 'disconnected' : ''));
    txt.textContent = connected === true ? '已连接' : (connected === false ? '连接失败' : '已配置（未测试）');
  } else {
    dot.className = 'status-dot disconnected';
    txt.textContent = '未配置';
  }
}
</script>
</body></html>"""


@app.get("/config")
async def config_page():
    """LLM 配置页面（网页端配置 API 信息）"""
    return HTMLResponse(CONFIG_HTML)


@app.post("/llm_test")
def llm_test(
    api_url: str = Form(...),
    api_key: str = Form(...),
    model_name: str = Form(...),
):
    """测试 LLM 连接是否可用"""
    try:
        response = _call_llm(api_key, api_url, model_name,
                             system_prompt="你是一个助手。",
                             user_text="请回复'连接成功'。",
                             temperature=0.1)
        reply = response.choices[0].message.content.strip()
        return {"success": True, "reply": reply}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/transcribe_status/{file_id}")
async def transcribe_status(file_id: str):
    """查看转写进度"""
    with _progress_lock:
        p = _transcription_progress.get(file_id)
        if p is None:
            return {"status": "not_found"}
        return {"file_id": file_id, **p}


@app.get("/transcribe_list")
async def transcribe_list():
    """列出所有进行中的转写任务"""
    with _progress_lock:
        items = {k: {"status": v["status"], "chunks_done": v["chunks_done"], "total_duration": v["total_duration"]}
                 for k, v in _transcription_progress.items()}
        return {"active": items}


@app.post("/transcribe_url")
def transcribe_url(
    url: str = Form(..., description="音频/视频文件的直接下载链接"),
    language: str = Form("Chinese"),
    context: str = Form(""),
    max_chars: int = Form(50),
    pause_threshold: float = Form(0.3),
):
    """通过 URL 下载音视频 → ASR 转写（适合 AI agent 直接传链接）"""
    import requests
    mdl = load_model()
    file_id = str(uuid.uuid4())[:8]
    _update_progress(file_id, status="downloading")

    # 从 URL 推断扩展名
    url_path = url.split("?")[0]
    ext = Path(url_path).suffix.lower() or ".wav"
    input_path = TEMP_DIR / f"{file_id}{ext}"

    # 下载文件
    r = requests.get(url, stream=True, timeout=300)
    r.raise_for_status()
    with open(input_path, "wb") as f:
        for chunk in r.iter_content(chunk_size=8192):
            f.write(chunk)
    _update_progress(file_id, status="downloaded")

    return _transcribe_file(mdl, file_id, str(input_path), ext, language, context, max_chars, pause_threshold)


@app.post("/transcribe")
def transcribe(
    file: UploadFile = File(...),
    language: str = Form("Chinese"),
    context: str = Form(""),
    max_chars: int = Form(50, description="每段最大字符数"),
    pause_threshold: float = Form(0.3, description="停顿阈值（秒）"),
):
    """
    上传音视频 → ASR 转写 → 自适应合并 → 返回带时间轴的结果
    """
    mdl = load_model()
    file_id = str(uuid.uuid4())[:8]
    _update_progress(file_id, status="uploaded")
    ext = Path(file.filename).suffix.lower() if file.filename else ".wav"
    input_path = TEMP_DIR / f"{file_id}{ext}"
    with open(input_path, "wb") as f:
        f.write(file.file.read())

    return _transcribe_file(mdl, file_id, str(input_path), ext, language, context, max_chars, pause_threshold)


def _transcribe_file(mdl, file_id, input_path, ext, language, context, max_chars, pause_threshold):
    """内部：给定文件路径 → 转写 → 合并 → 返回结果"""
    video_exts = {".mp4", ".avi", ".mkv", ".mov", ".flv", ".wmv", ".webm", ".ts", ".mts"}
    try:
        audio_input = input_path
        if ext in video_exts:
            wav_path = str(Path(input_path).with_suffix(".wav"))
            extract_audio(input_path, wav_path)
            audio_input = wav_path

        # 转写
        gen = mdl.transcribe_streaming(
            audio=audio_input,
            language=language,
            context=context,
            return_time_stamps=True,
        )

        # 收集所有带时间戳的词（同时更新进度）
        all_words = []
        total_duration = 0.0
        chunk_index = 0
        for chunk in gen:
            chunk_index += 1
            total_duration = max(total_duration, chunk.offset_sec + chunk.duration_sec)
            if chunk.time_stamps:
                for item in chunk.time_stamps.items:
                    all_words.append({
                        "start": item.start_time,
                        "end": item.end_time,
                        "word": item.text,
                    })
            # 每处理完一个块，更新进度
            _update_progress(file_id,
                             status="transcribing",
                             chunks_done=chunk_index,
                             total_duration=total_duration,
                             words=list(all_words[-200:]))  # 只保留最近200词避免内存爆炸

        # 自适应合并成句子
        _update_progress(file_id, status="merging", chunks_done=chunk_index, total_duration=total_duration)
        segments = merge_segments_adaptive(all_words, max_chars=max_chars, pause_threshold=pause_threshold)

        full_text = "".join(s["text"] for s in segments)

        return {
            "success": True,
            "file_id": file_id,
            "text": full_text,
            "language": language,
            "duration_sec": round(total_duration, 2),
            "segments": segments,
            "words": all_words,
        }

    except Exception as e:
        _update_progress(file_id, status="error")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        with _progress_lock:
            _transcription_progress.pop(file_id, None)
        try:
            os.unlink(input_path)
            if ext in video_exts:
                wav_path = TEMP_DIR / f"{file_id}.wav"
                if wav_path.exists():
                    os.unlink(wav_path)
        except Exception:
            pass


@app.post("/transcribe_ass")
def transcribe_ass(
    file: UploadFile = File(...),
    language: str = Form("Chinese"),
    context: str = Form(""),
):
    """
    上传音视频 → ASS 字幕格式输出
    """
    result = transcribe(file=file, language=language, context=context)
    segments = result["segments"]

    # 生成 ASS
    ass = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: 原文,苹方 中等,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    for s in segments:
        start = _fmt_time(s["start"])
        end = _fmt_time(s["end"])
        text = s["text"].replace("\n", "\\N")
        ass += f"Dialogue: 0,{start},{end},原文,,0,0,0,,{text}\n"

    return PlainTextResponse(ass, media_type="text/plain; charset=utf-8-sig",
                             headers={"Content-Disposition": "attachment; filename=subtitle.ass"})


def _fmt_time(sec: float) -> str:
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec % 60
    return f"{h:01d}:{m:02d}:{s:05.2f}"


# ============ LLM 后处理端点 ============
class LLMConfig(BaseModel):
    api_key: str = ""
    api_url: str = "https://api.deepseek.com"
    model: str = "deepseek-v4-flash"
    temperature: float = 0.3
    system_prompt: str = ""
    batch_size: int = 200


def _call_llm(api_key, api_url, model_name, system_prompt, user_text, temperature):
    """调用 LLM API（支持非流式和流式回退）"""
    from openai import OpenAI
    client = OpenAI(api_key=api_key, base_url=api_url)
    response = client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
        temperature=temperature,
        stream=False,
    )
    # 某些 API（如 ModelScope DeepSeek-V4-Flash）非流式返回空 choices，回退到流式
    if response.choices is None:
        stream_resp = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_text},
            ],
            temperature=temperature,
            stream=True,
        )
        full_content = ""
        for chunk in stream_resp:
            if chunk.choices and chunk.choices[0].delta.content:
                full_content += chunk.choices[0].delta.content
        # 模拟非流式响应结构
        from openai.types.chat import ChatCompletion, ChatCompletionMessage
        from openai.types.chat.chat_completion import Choice
        response = ChatCompletion(
            id="stream-fallback",
            choices=[Choice(index=0, finish_reason="stop",
                            message=ChatCompletionMessage(role="assistant", content=full_content))],
            created=0, model=model_name, object="chat.completion",
        )
    return response


@app.post("/refine")
def refine_text(
    text: str = Form(..., description="待处理的文本"),
    system_prompt: str = Form("你是一个专业的文档整理助手。请对以下课堂录音文本进行处理：\n1. 合并被切断的句子\n2. 修正ASR识别错误\n3. 补充专业术语的准确表述\n4. 恢复正确的标点符号\n5. 按语义分段，输出清晰的文档格式\n直接输出结果，不要多余的解释。"),
    api_key: str = Form(""),
    api_url: str = Form("https://api.deepseek.com"),
    model_name: str = Form("deepseek-v4-flash"),
    temperature: float = Form(0.3),
):
    """用 LLM 对 ASR 结果进行润色、合并断句、专业知识注入"""
    if not api_key:
        raise HTTPException(status_code=400, detail="需要提供 API Key")

    response = _call_llm(api_key, api_url, model_name, system_prompt, text, temperature)

    cleaned = response.choices[0].message.content
    return {
        "success": True,
        "refined_text": cleaned,
        "token_usage": response.usage.total_tokens if response.usage else 0,
    }


@app.post("/full_pipeline")
def full_pipeline(
    file: UploadFile = File(...),
    language: str = Form("Chinese"),
    context: str = Form(""),
    enable_llm: bool = Form(False, description="是否启用 LLM 后处理"),
    api_key: str = Form("", description="LLM API Key"),
    api_url: str = Form("https://api.deepseek.com", description="LLM API URL"),
    model_name: str = Form("deepseek-v4-flash", description="LLM 模型名"),
    system_prompt: str = Form("你是一个专业的课堂笔记整理助手。请对以下课堂录音文本进行处理：\n1. 合并被音频切块切断的句子\n2. 修正ASR识别错误的词语\n3. 对专业术语进行准确的补充和规范化\n4. 恢复正确的标点符号和分段\n5. 按语义逻辑重新组织段落\n\n请直接输出整理后的文本，不要加解释。"),
    temperature: float = Form(0.3),
    max_chars: int = Form(50),
    pause_threshold: float = Form(0.3),
):
    """完整流水线：ASR 转写 → 自适应合并 → (可选) LLM 润色 → 返回干净文档"""
    # Step 1: ASR
    result = transcribe(
        file=file, language=language, context=context,
        max_chars=max_chars, pause_threshold=pause_threshold,
    )

    if not enable_llm or not api_key:
        return {**result, "refined": False}

    # Step 2: LLM 后处理
    asr_text = result["text"]
    refine_result = refine_text(
        text=asr_text,
        system_prompt=system_prompt,
        api_key=api_key,
        api_url=api_url,
        model_name=model_name,
        temperature=temperature,
    )

    return {
        **result,
        "refined": True,
        "refined_text": refine_result["refined_text"],
        "token_usage": refine_result["token_usage"],
    }


# ============ 启动 ============
if __name__ == "__main__":
    print(f"PyTorch: {torch.__version__} | CUDA: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"GPU: {torch.cuda.get_device_name(0)} | VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
    import socket
    try:
        host_ip = socket.gethostbyname(socket.gethostname())
    except Exception:
        host_ip = "127.0.0.1"
    print(f"\nAPI 服务启动成功！")
    print(f"  本机访问: http://localhost:8000")
    print(f"  本机访问: http://{host_ip}:8000")
    print(f"  局域网:   http://{host_ip}:8000  (其他设备用此地址)\n")
    print(f"  端点列表:")
    print(f"    POST /transcribe      - ASR 转写")
    print(f"    POST /transcribe_ass  - ASS 字幕下载")
    print(f"    POST /refine          - LLM 润色文本")
    print(f"    POST /full_pipeline   - 完整流水线（ASR + LLM）")
    print(f"    GET  /health          - 健康检查")
    print(f"    GET  /guide           - AI Agent 接入指南")
    print(f"    GET  /config          - LLM 配置页面\n")
    uvicorn.run(app, host="0.0.0.0", port=8000)
