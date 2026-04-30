"""
Qwen3-ASR API Server v2
参考 Transby2 的 merge 逻辑 + LLM 后处理
"""
import os, sys, json, uuid, tempfile, re, time, subprocess, asyncio
from pathlib import Path
from typing import Optional, List

os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

import torch
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, PlainTextResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from contextlib import asynccontextmanager
from qwen_asr import Qwen3ASRModel

# ============ 配置 ============
BASE_DIR = Path(__file__).parent
MODEL_PATH = str(BASE_DIR / "models" / "Qwen3-ASR-1.7B")
ALIGNER_PATH = str(BASE_DIR / "models" / "Qwen3-ForcedAligner-0.6B")
DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"
TEMP_DIR = Path(tempfile.gettempdir()) / "asr_api"
TEMP_DIR.mkdir(exist_ok=True)

@asynccontextmanager
async def _lifespan(app):
    """启动时创建清理任务、输出目录，关闭时清理"""
    output_dir = BASE_DIR / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    cleanup_task = asyncio.create_task(_cleanup_old_progress())
    yield
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass

app = FastAPI(title="ASR API 服务", version="2.0", lifespan=_lifespan)
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
        _transcription_progress[file_id]["_updated_at"] = time.time()

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


# ============ AI Agent / 开发者指南（已迁移到 SPA /#guide）============


@app.get("/")
async def root():
    """SPA 首页"""
    return HTMLResponse((BASE_DIR / "frontend" / "index.html").read_text(encoding="utf-8"))


@app.get("/guide")
async def guide_redirect():
    """重定向到 SPA 指南"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/#guide")





@app.get("/config")
async def config_redirect():
    """重定向到 SPA 配置页面"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/#config")


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

        # 完成时保存完整结果到进度（供前端轮询），不删除
        _update_progress(file_id, status="completed", full_text=full_text, segments=segments,
                         words=all_words, duration_sec=round(total_duration, 2),
                         language=language)

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
        # 删除临时文件，但保留进度条目供前端轮询
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


# ============ 前端 SPA 静态文件服务 ============
FRONTEND_DIR = BASE_DIR / "frontend"
(FRONTEND_DIR / "css").mkdir(parents=True, exist_ok=True)
(FRONTEND_DIR / "js" / "pages").mkdir(parents=True, exist_ok=True)

# 挂载 /assets 提供静态文件（CSS/JS）
app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR)), name="assets")

# ============ 排队系统 ============
_processing_queue: list = []  # [{file_id, input_path, ext, language, context, max_chars, pause_threshold}]
_queue_lock = threading.Lock()
_is_processing = False

def _queue_next():
    """后台处理队列中的文件，一次一个"""
    global _is_processing
    while True:
        item = None
        with _queue_lock:
            if not _processing_queue:
                _is_processing = False
                return
            item = _processing_queue.pop(0)
        _is_processing = True
        try:
            mdl = load_model()
            _transcribe_file(mdl, **item)
        except Exception as e:
            _update_progress(item["file_id"], status="error", detail=str(e))
        finally:
            _is_processing = False


@app.post("/transcribe_async")
def transcribe_async(
    file: UploadFile = File(...),
    language: str = Form("Chinese"),
    context: str = Form(""),
    max_chars: int = Form(50),
    pause_threshold: float = Form(0.3),
):
    """非阻塞上传 + 排队，立刻返回 file_id"""
    file_id = str(uuid.uuid4())[:8]
    ext = Path(file.filename).suffix.lower() if file.filename else ".wav"
    input_path = TEMP_DIR / f"{file_id}{ext}"
    with open(input_path, "wb") as f:
        f.write(file.file.read())

    task = dict(file_id=file_id, input_path=str(input_path), ext=ext,
                language=language, context=context,
                max_chars=max_chars, pause_threshold=pause_threshold)

    with _queue_lock:
        _processing_queue.append(task)
        pos = len(_processing_queue)
        global _is_processing
        if not _is_processing:
            threading.Thread(target=_queue_next, daemon=True).start()

    _update_progress(file_id, status="queued", filename=file.filename or "unknown")
    return {"file_id": file_id, "position": pos, "status": "queued"}


# ============ 输出目录管理 ============
_output_dir = str(BASE_DIR / "output")

@app.get("/output_dir")
def get_output_dir():
    """获取当前输出目录"""
    return {"path": _output_dir, "exists": os.path.isdir(_output_dir)}

@app.post("/output_dir")
def set_output_dir(path: str = Form(...)):
    """设置输出目录"""
    global _output_dir
    p = Path(path).resolve()
    try:
        p.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无法创建目录: {e}")
    _output_dir = str(p)
    return {"success": True, "path": _output_dir}

@app.post("/save_result")
def save_result(
    file_id: str = Form(...),
    filename: str = Form("transcription.txt"),
):
    """将转写结果保存到输出目录"""
    if not os.path.isdir(_output_dir):
        raise HTTPException(status_code=400, detail="输出目录未配置")
    with _progress_lock:
        p = _transcription_progress.get(file_id)
    if not p or p.get("status") != "completed":
        raise HTTPException(status_code=400, detail="任务未完成或不存在")
    text = p.get("full_text", "")
    if not text:
        raise HTTPException(status_code=400, detail="没有转写文本")
    out_path = Path(_output_dir) / filename
    out_path.write_text(text, encoding="utf-8")
    return {"success": True, "path": str(out_path)}


# ============ 进度自动清理 ============
async def _cleanup_old_progress():
    """每分钟清理 10 分钟前的完成/错误任务"""
    while True:
        await asyncio.sleep(60)
        now = time.time()
        with _progress_lock:
            expired = [
                fid for fid, p in _transcription_progress.items()
                if p.get("status") in ("completed", "error")
                and now - p.get("_updated_at", 0) > 600
            ]
            for fid in expired:
                del _transcription_progress[fid]

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
    print(f"    GET  /                 - SPA 前端首页")
    print(f"    POST /transcribe       - ASR 转写（阻塞）")
    print(f"    POST /transcribe_async - ASR 转写（非阻塞+排队）")
    print(f"    POST /transcribe_ass   - ASS 字幕下载")
    print(f"    POST /transcribe_url   - URL 转写")
    print(f"    POST /refine           - LLM 润色文本")
    print(f"    POST /full_pipeline    - 完整流水线（ASR + LLM）")
    print(f"    GET  /health           - 健康检查")
    print(f"    GET  /guide            - SPA 指南")
    print(f"    GET  /config           - SPA 配置")
    print(f"    GET  /output_dir       - 输出目录管理")
    print(f"    POST /save_result      - 保存结果到输出目录\n")
    uvicorn.run(app, host="0.0.0.0", port=8000)
