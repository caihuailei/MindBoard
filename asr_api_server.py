"""
Qwen3-ASR API Server v2
参考 Transby2 的 merge 逻辑 + LLM 后处理
"""
import logging
import os, sys, json, uuid, tempfile, re, time, subprocess, asyncio, random
from pathlib import Path
from typing import Optional, List

os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

from config import settings
import torch
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, PlainTextResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from contextlib import asynccontextmanager
from qwen_asr import Qwen3ASRModel

# ============ 日志 ============
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("asr-api")

# ============ 配置（从 .env / 环境变量加载）============
BASE_DIR = Path(__file__).parent
MODEL_PATH = str(BASE_DIR / settings.model_path)
ALIGNER_PATH = str(BASE_DIR / settings.aligner_path)
DEVICE = settings.device if torch.cuda.is_available() else "cpu"
TEMP_DIR = Path(tempfile.gettempdir()) / settings.temp_dir
TEMP_DIR.mkdir(exist_ok=True)
RESULTS_DIR = BASE_DIR / settings.results_dir
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

@asynccontextmanager
async def _lifespan(app):
    """启动时清理残留 chunk、创建目录、启动定时清理"""
    logger.info(f"Temp dir: {TEMP_DIR}")
    logger.info(f"Results dir: {RESULTS_DIR}")

    # Clean up leftover chunk files from interrupted sessions
    chunks = list(RESULTS_DIR.glob("*_chunk_*.json"))
    for cf in chunks:
        try:
            cf.unlink()
        except Exception:
            pass
    if chunks:
        logger.info(f"Cleaned {len(chunks)} leftover chunk files")

    output_dir = BASE_DIR / settings.output_dir
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
    logger.info(f"加载模型中... (device={DEVICE})")
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
    logger.info("模型加载完成！")
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


@app.get("/transcribe_stream/{file_id}")
def transcribe_stream(file_id: str):
    """SSE 流式推送转写进度，前端用 fetch + ReadableStream 接收"""
    from fastapi.responses import StreamingResponse

    def event_stream():
        last_words_len = 0
        while True:
            with _progress_lock:
                p = _transcription_progress.get(file_id)
                if p is None:
                    yield f"data: {json.dumps({'status': 'not_found'}, ensure_ascii=False)}\n\n"
                    break

                status = p.get("status", "")
                chunks_done = p.get("chunks_done", 0)
                total_duration = p.get("total_duration", 0)
                words = p.get("words", [])
                full_text = p.get("full_text", "")
                segments = p.get("segments", [])
                duration_sec = p.get("duration_sec", 0)
                language = p.get("language", "")

                # Only send words if changed
                words_data = words if len(words) != last_words_len else []
                if words_data:
                    last_words_len = len(words)

                payload = {
                    "status": status,
                    "chunks_done": chunks_done,
                    "total_duration": total_duration,
                    "words": words_data,
                }

                if status == "completed":
                    payload["full_text"] = full_text
                    payload["segments"] = segments
                    payload["duration_sec"] = duration_sec
                    payload["language"] = language
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                    yield "data: [DONE]\n\n"
                    break

                if status == "error":
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                    yield "data: [DONE]\n\n"
                    break

                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

            import time
            time.sleep(0.3)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/transcribe_list")
async def transcribe_list():
    """列出所有进行中的转写任务"""
    with _progress_lock:
        items = {k: {"status": v["status"], "chunks_done": v["chunks_done"],
                     "total_duration": v["total_duration"], "source": v.get("source", "")}
                 for k, v in _transcription_progress.items()}
        return {"active": items}


# [已移除] POST /transcribe_url — 不再支持 URL 下载，只允许上传文件


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

    # 从进度中获取文件名
    with _progress_lock:
        filename = _transcription_progress.get(file_id, {}).get("filename", "unknown")

    try:
        audio_input = input_path
        if ext in video_exts:
            wav_path = str(Path(input_path).with_suffix(".wav"))
            extract_audio(input_path, wav_path)
            audio_input = wav_path

        # 转写 —— 每块同时落盘
        gen = mdl.transcribe_streaming(
            audio=audio_input,
            language=language,
            context=context,
            return_time_stamps=True,
        )

        all_words_in_mem = []  # 用于前端实时轮询（最近200词）
        total_duration = 0.0
        chunk_index = 0
        for chunk in gen:
            chunk_index += 1
            total_duration = max(total_duration, chunk.offset_sec + chunk.duration_sec)
            chunk_words = []
            if chunk.time_stamps:
                for item in chunk.time_stamps.items:
                    w = {"start": item.start_time, "end": item.end_time, "word": item.text}
                    all_words_in_mem.append(w)
                    chunk_words.append(w)

            # 分块结果写入磁盘
            if chunk_words:
                cf = RESULTS_DIR / f"{file_id}_chunk_{chunk_index:04d}.json"
                json.dump(chunk_words, open(cf, "w", encoding="utf-8"), ensure_ascii=False)

            _update_progress(file_id,
                             status="transcribing",
                             chunks_done=chunk_index,
                             total_duration=total_duration,
                             words=list(all_words_in_mem[-200:]))

        # 从磁盘读取所有分块用于合并
        _update_progress(file_id, status="merging", chunks_done=chunk_index, total_duration=total_duration)
        chunk_files = sorted(RESULTS_DIR.glob(f"{file_id}_chunk_*.json"))
        all_words_from_disk = []
        for cf in chunk_files:
            try:
                all_words_from_disk.extend(json.load(open(cf, "r", encoding="utf-8")))
            except Exception:
                pass

        segments = merge_segments_adaptive(all_words_from_disk, max_chars=max_chars, pause_threshold=pause_threshold)
        full_text = "".join(s["text"] for s in segments)

        # 最终结果写入磁盘（持久化）
        result_data = {
            "file_id": file_id,
            "filename": filename,
            "full_text": full_text,
            "segments": segments,
            "duration_sec": round(total_duration, 2),
            "language": language,
            "completed_at": time.time(),
        }
        json.dump(result_data, open(RESULTS_DIR / f"{file_id}.json", "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)

        # 删除分块零碎文件
        for cf in chunk_files:
            try:
                cf.unlink()
            except Exception:
                pass

        # 完成时保存完整结果到进度（供前端轮询），不删除
        _update_progress(file_id, status="completed", full_text=full_text, segments=segments,
                         words=all_words_from_disk, duration_sec=round(total_duration, 2),
                         language=language)

        return {
            "success": True,
            "file_id": file_id,
            "text": full_text,
            "language": language,
            "duration_sec": round(total_duration, 2),
            "segments": segments,
            "words": all_words_from_disk,
        }

    except Exception as e:
        _update_progress(file_id, status="error")
        logger.exception(f"Transcription error for file_id={file_id}: {e}")
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

    # 生成 ASS（重叠检测 + 双样式头部）
    ass = _generate_ass_header()
    last_end_s = 0
    for s in segments:
        start_s = float(s["start"])
        end_s = float(s["end"])
        # 防止时间轴重叠
        if start_s < last_end_s:
            start_s = last_end_s
        if end_s <= start_s:
            end_s = start_s + 0.01
        start = _fmt_ass_time(start_s)
        end = _fmt_ass_time(end_s)
        text = s["text"].replace("\n", "\\N")
        ass += f"Dialogue: 0,{start},{end},原文,,0,0,0,,{text}\n"
        last_end_s = end_s

    return PlainTextResponse(ass, media_type="text/plain; charset=utf-8-sig",
                             headers={"Content-Disposition": "attachment; filename=subtitle.ass"})


def _fmt_ass_time(sec: float) -> str:
    """秒数 → ASS 时间 h:mm:ss.cc（centisecond 精度）"""
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    cs = int((sec - int(sec)) * 100)
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def _generate_ass_header() -> str:
    """生成标准 ASS 文件头部（Aegisub 兼容、双样式、1080p）"""
    return """[Script Info]
; Script generated by Aegisub 9212-dev-3a38bf16a
; http://www.aegisub.org/
Title:
ScriptType: v4.00+
PlayDepth: 0
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: no
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: 原文,思源黑体 CN,70,&H00FFFFFF,&H000019FF,&H1E000000,&H9E000000,-1,0,0,0,100,100,1,0,1,3.5,0,2,6,6,10,1
Style: 对话,思源黑体 CN,70,&H00FFFFFF,&H000019FF,&H1E000000,&H9E000000,-1,0,0,0,100,100,1,0,1,3.5,0,2,6,6,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


# ============ ASS 辅助函数 ============
_ASS_DIALOGUE_RE = re.compile(
    r'Dialogue:\s*([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),(.*)'
)


def _parse_ass_dialogue(line: str):
    """解析 ASS Dialogue 行 → dict"""
    m = _ASS_DIALOGUE_RE.match(line.strip())
    if not m:
        return None
    p = m.groups()
    return {
        'Layer': p[0], 'Start': p[1], 'End': p[2], 'Style': p[3], 'Name': p[4],
        'MarginL': p[5], 'MarginR': p[6], 'MarginV': p[7], 'Effect': p[8], 'Text': p[9],
    }


def _ass_time_to_seconds(ass_time: str) -> float:
    """ASS 时间 h:mm:ss.cc → 秒数"""
    try:
        parts = ass_time.split(':')
        secs = parts[2].split('.')
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(secs[0]) + (int(secs[1]) if len(secs) > 1 else 0) / 100
    except Exception:
        return 0.0


def _parse_ass_file(ass_text: str) -> list:
    """解析 ASS 全文 → Dialogue 行列表"""
    dialogues = []
    for line in ass_text.splitlines():
        d = _parse_ass_dialogue(line)
        if d:
            dialogues.append(d)
    return dialogues


def _extract_ass_header(ass_text: str) -> str:
    """提取 ASS 头部（[Events] Format 行及之前）"""
    lines = ass_text.splitlines()
    header_end = -1
    for i, line in enumerate(lines):
        if line.strip().startswith('Format: Layer, Start, End, Style'):
            header_end = i
            break
    if header_end < 0:
        return _generate_ass_header()
    return '\n'.join(lines[:header_end]) + '\n'


def _clean_json_string(raw: str) -> str:
    """修复 LLM 返回的 JSON（去除 markdown 代码块、修复常见格式问题）"""
    s = raw.strip()
    # Remove markdown code blocks
    if s.startswith('```'):
        lines = s.split('\n')
        if lines[0].startswith('```'):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith('```'):
            lines = lines[:-1]
        s = '\n'.join(lines)
    # Find JSON object boundaries
    start = s.find('{')
    end = s.rfind('}')
    if start >= 0 and end > start:
        s = s[start:end + 1]
    return s


def _prepare_ass_input(dialogue_lines: list) -> tuple:
    """从 Dialogue 行提取 API 输入 + context_map"""
    api_items = []
    context_map = {}
    for d in dialogue_lines:
        api_items.append({"timestamp": d['Start'], "text": d['Text']})
        context_map[d['Start']] = d
    return api_items, context_map


def _reconstruct_ass_from_response(api_response: dict, context_map: dict) -> tuple:
    """根据 AI 翻译结果重建 ASS Dialogue 行（Style=对话）"""
    if 'translatedSentences' not in api_response:
        return [], []

    new_lines = []
    log_entries = []
    for sent in api_response['translatedSentences']:
        translated_text = sent.get('sentence', '')
        related = sent.get('relatedInputItems', [])
        if not related:
            continue
        first_ts = related[0]['timestamp']
        last_ts = related[-1]['timestamp']
        if first_ts not in context_map or last_ts not in context_map:
            continue
        meta = context_map[first_ts]
        start_time = meta['Start']
        end_time = context_map[last_ts]['End']
        # 标点替换：中文逗号/句号 → 空格，引号 → 日文样式
        processed = translated_text
        for old, new in [('，', ' '), ('。', ' '), ('、', ' '), ('"', '「'), ('"', '」'),
                          ('《', '『'), ('》', '』'), ('！', ' '), ('？', ' ')]:
            processed = processed.replace(old, new)
        line = (f"Dialogue: {meta['Layer']},{start_time},{end_time},对话,{meta['Name']},"
                f"{meta['MarginL']},{meta['MarginR']},{meta['MarginV']},{meta['Effect']},{processed}")
        new_lines.append(line)
        log_entries.append(f"{translated_text}")
        for item in related:
            log_entries.append(f"{item['text']},{item['timestamp']},{end_time}")
        log_entries.append("")
    return new_lines, log_entries


def _segment_by_time_window(segments: list, window_minutes: int) -> list:
    """按时间窗分割 ASS segments → 重叠时间段列表"""
    if not segments:
        return []
    window_sec = window_minutes * 60
    start_sec = _ass_time_to_seconds(segments[0]['Start'])
    end_sec = _ass_time_to_seconds(segments[-1]['End'])
    windows = []
    current = start_sec
    while current < end_sec:
        win_end = current + window_sec
        win_segs = [
            s for s in segments
            if _ass_time_to_seconds(s['Start']) < win_end and _ass_time_to_seconds(s['End']) > current
        ]
        if win_segs:
            windows.append(win_segs)
        current += window_sec
    return windows


def _build_window_text(window_segments: list) -> str:
    """将时间段 segments 格式化为文本"""
    return '\n'.join(f"[{s['Start']}] {s['Text']}" for s in window_segments)


# ============ ASS 翻译 ============
@app.post("/ass_translate")
def ass_translate(
    file: UploadFile = File(...),
    api_key: str = Form(""),
    api_url: str = Form("https://api.deepseek.com"),
    model_name: str = Form("deepseek-chat"),
    system_prompt: str = Form("你是一个专业的翻译助手。请将提供的字幕文本翻译为目标语言，保持时间戳和格式不变。"),
    temperature: float = Form(0.3),
    batch_size: int = Form(200),
    target_language: str = Form("Chinese"),
):
    """上传 ASS 文件 → AI 翻译 → 输出双语 ASS（原文 + 译文双样式）"""
    if not api_key:
        raise HTTPException(status_code=400, detail="需要提供 API Key")

    raw = file.file.read().decode('utf-8-sig')
    header = _extract_ass_header(raw)
    dialogue_lines = [line for line in raw.splitlines() if line.strip().startswith('Dialogue:')]

    if not dialogue_lines:
        raise HTTPException(status_code=400, detail="ASS 文件中没有 Dialogue 行")

    api_items, context_map = _prepare_ass_input([_parse_ass_dialogue(l) for l in dialogue_lines if _parse_ass_dialogue(l)])

    # Batch translation
    total_batches = (len(api_items) + batch_size - 1) // batch_size
    logger.info(f"ASS 翻译: {len(api_items)} 行, {total_batches} 批")

    all_new_lines = []
    all_log = []
    for batch_num in range(total_batches):
        start_idx = batch_num * batch_size
        end_idx = min((batch_num + 1) * batch_size, len(api_items))
        batch_items = api_items[start_idx:end_idx]
        user_text = json.dumps(batch_items, ensure_ascii=False, indent=2)

        try:
            response = _call_llm(api_key, api_url, model_name, system_prompt, user_text, temperature)
            content = response.choices[0].message.content
            cleaned = _clean_json_string(content)
            parsed = json.loads(cleaned)
            new_lines, log_entries = _reconstruct_ass_from_response(parsed, context_map)
            all_new_lines.extend(new_lines)
            all_log.extend(log_entries)
        except Exception as e:
            logger.error(f"ASS 翻译批次 {batch_num + 1} 失败: {e}")

    # Build output: header + original lines + translated lines
    output = header + '\n' + '\n'.join(dialogue_lines) + '\n' + '\n'.join(all_new_lines) + '\n'
    basename = (file.filename or 'subtitle').rsplit('.', 1)[0] if file.filename else 'subtitle'

    return PlainTextResponse(
        '﻿' + output,  # UTF-8 BOM
        media_type="text/plain; charset=utf-8-sig",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{basename}_bilingual.ass"},
    )


# ============ ASS 水印 ============
@app.post("/ass_watermark")
def ass_watermark(
    file: UploadFile = File(...),
    text: str = Form(...),
):
    """上传 ASS 文件 → 添加随机位置水印 → 下载"""
    raw = file.file.read().decode('utf-8-sig')
    lines = raw.splitlines()

    # 找到最后一个 Dialogue 行的结束时间
    last_end_sec = 0.0
    for line in lines:
        d = _parse_ass_dialogue(line)
        if d:
            end = _ass_time_to_seconds(d['End'])
            if end > last_end_sec:
                last_end_sec = end

    # 生成水印行
    watermark_lines = []
    ms_s = 0; ss_s = 0; mm_s = 0; hh_s = 0
    while True:
        ms_rand = random.randint(40, 100)
        ss_rand = random.randint(35, 145)
        x_pos = random.randint(300, 1600)
        y_pos = random.randint(100, 1000)
        ms_e = ms_s + ms_rand
        ss_e = ss_s + ss_rand
        if ms_e >= 100:
            ss_e = ss_s + ms_e // 100
            ms_e = ms_e - (ms_e // 100) * 100
        if ss_e >= 60:
            ss_e -= 60; mm_s += 1
        if mm_s >= 60:
            mm_s -= 60; hh_s += 1
        mm_e = mm_s; hh_e = hh_s
        if ms_e >= 100:
            ss_e += 1; ms_e -= 100
        if ss_e >= 60:
            ss_e -= 60; mm_e += 1
        if mm_e >= 60:
            mm_e -= 60; hh_e += 1

        ass_tag = f"{{\\pos({x_pos},{y_pos})}}"
        item = f"Dialogue: 1,{hh_s:01d}:{mm_s:02d}:{ss_s:02d}.{ms_s:02d},{hh_e:01d}:{mm_e:02d}:{ss_e:02d}.{ms_e:02d},水印,,0,0,0,,{ass_tag}{text}"
        watermark_lines.append(item)

        ms_s = ms_e; ss_s = ss_e; mm_s = mm_e; hh_s = hh_e
        if hh_e * 3600 + mm_e * 60 + ss_e > last_end_sec:
            break

    output = raw.rstrip() + '\n' + '\n'.join(watermark_lines) + '\n'
    basename = (file.filename or 'subtitle').rsplit('.', 1)[0] if file.filename else 'subtitle'

    return PlainTextResponse(
        output,
        media_type="text/plain; charset=utf-8-sig",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{basename}_watermarked.ass"},
    )


# ============ ASS 轴审 ============
@app.post("/ass_audit")
def ass_audit(file: UploadFile = File(...)):
    """上传 ASS 文件 → 检测闪轴/叠轴 → 返回问题列表"""
    raw = file.file.read().decode('utf-8-sig')
    lines = raw.splitlines()
    dialogues = [(i, _parse_ass_dialogue(line)) for i, line in enumerate(lines) if _parse_ass_dialogue(line)]

    issues = []
    for idx, (i, front) in enumerate(dialogues):
        for j, back in dialogues[idx + 1:]:
            if front['Style'] != back['Style']:
                continue
            prev_end = _ass_time_to_seconds(front['End'])
            curr_start = _ass_time_to_seconds(back['Start'])
            gap = curr_start - prev_end
            if gap < 0:
                issues.append({"line": idx + 1, "next_line": idx + 2, "gap_ms": round(gap * 1000), "type": "overlap"})
                break
            elif gap < 0.3:
                issues.append({"line": idx + 1, "next_line": idx + 2, "gap_ms": round(gap * 1000), "type": "flash"})
                break

    return {"issues": issues, "total": len(issues)}


# ============ ASS 片段总结 ============
@app.post("/ass_summary")
def ass_summary(
    file: UploadFile = File(...),
    time_window: int = Form(15),
    api_key: str = Form(""),
    api_url: str = Form("https://api.deepseek.com"),
    model_name: str = Form("deepseek-chat"),
    temperature: float = Form(0.3),
):
    """上传 ASS 文件 → 按时间段分割 → AI 总结 → 返回结构化 JSON"""
    if not api_key:
        raise HTTPException(status_code=400, detail="需要提供 API Key")

    raw = file.file.read().decode('utf-8-sig')
    dialogues = _parse_ass_file(raw)
    if not dialogues:
        raise HTTPException(status_code=400, detail="ASS 文件中没有 Dialogue 行")

    windows = _segment_by_time_window(dialogues, time_window)
    logger.info(f"ASS 总结: {len(dialogues)} 行, 分为 {len(windows)} 个时间段")

    segments = []
    for idx, win_segs in enumerate(windows, 1):
        win_text = _build_window_text(win_segs)
        start_time = win_segs[0]['Start']
        end_time = win_segs[-1]['End']

        prompt = f"""请对以下字幕时间段的内容进行结构化总结。返回纯 JSON，格式如下：
{{
  "topic": "本段主题描述（一句话）",
  "flow": "对话流程（简述）",
  "key_points": ["要点1", "要点2", ...],
  "tone": "情感基调（如：学术讨论/轻松对话/严肃演讲等）"
}}

字幕内容：
{win_text}"""

        try:
            response = _call_llm(api_key, api_url, model_name, "你是一个专业的内容分析助手。请对提供的字幕内容进行结构化分析，返回 JSON 格式的总结。", prompt, temperature)
            content = response.choices[0].message.content
            cleaned = _clean_json_string(content)
            summary = json.loads(cleaned)
        except Exception as e:
            summary = {"topic": f"分析失败: {str(e)}", "flow": "", "key_points": [], "tone": ""}

        segments.append({
            "index": idx,
            "start_time": start_time,
            "end_time": end_time,
            "summary": summary,
        })

    return {"segments": segments, "total_windows": len(windows)}


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
    system_prompt: str = Form("你是一个专业的录音文本整理助手。请对以下课堂录音文本进行处理：\n1. 合并被音频切块切断的句子，确保语句完整通顺\n2. 修正ASR识别错误的词语\n3. 对专业术语进行准确的补充和规范化\n4. 恢复正确的标点符号和分段\n5. 按语义逻辑重新组织段落，输出清晰的文档格式\n6. 保留原文的语气和风格，不要过度改写\n7. 在末尾添加简短的内容概要\n直接输出结果，不要加任何解释、不要出现\"以下是对\"等AI相关表述。"),
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


@app.post("/refine_stream")
async def refine_stream(
    text: str = Form(..., description="待处理的文本"),
    system_prompt: str = Form("你是一个专业的录音文本整理助手。请对以下课堂录音文本进行处理：\n1. 合并被音频切块切断的句子，确保语句完整通顺\n2. 修正ASR识别错误的词语\n3. 对专业术语进行准确的补充和规范化\n4. 恢复正确的标点符号和分段\n5. 按语义逻辑重新组织段落，输出清晰的文档格式\n6. 保留原文的语气和风格，不要过度改写\n7. 在末尾添加简短的内容概要\n直接输出结果，不要加任何解释、不要出现\"以下是对\"等AI相关表述。"),
    api_key: str = Form(""),
    api_url: str = Form("https://api.deepseek.com"),
    model_name: str = Form("deepseek-v4-flash"),
    temperature: float = Form(0.3),
):
    """流式 LLM 润色，返回 SSE 事件流，前端逐字展示"""
    if not api_key:
        raise HTTPException(status_code=400, detail="需要提供 API Key")

    from openai import OpenAI
    client = OpenAI(api_key=api_key, base_url=api_url)

    def event_stream():
        try:
            stream = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": text},
                ],
                temperature=temperature,
                stream=True,
            )
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    yield f"data: {json.dumps({'text': content}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    from fastapi.responses import StreamingResponse
    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/full_pipeline")
def full_pipeline(
    file: UploadFile = File(...),
    language: str = Form("Chinese"),
    context: str = Form(""),
    enable_llm: bool = Form(False, description="是否启用 LLM 后处理"),
    api_key: str = Form("", description="LLM API Key"),
    api_url: str = Form("https://api.deepseek.com", description="LLM API URL"),
    model_name: str = Form("deepseek-v4-flash", description="LLM 模型名"),
    system_prompt: str = Form("你是一个专业的录音文本整理助手。请对以下课堂录音文本进行处理：\n1. 合并被音频切块切断的句子，确保语句完整通顺\n2. 修正ASR识别错误的词语\n3. 对专业术语进行准确的补充和规范化\n4. 恢复正确的标点符号和分段\n5. 按语义逻辑重新组织段落，输出清晰的文档格式\n6. 保留原文的语气和风格，不要过度改写\n7. 在末尾添加简短的内容概要\n直接输出结果，不要加任何解释、不要出现\"以下是对\"等AI相关表述。"),
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
    source: str = Form("upload"),
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

    _update_progress(file_id, status="queued", filename=file.filename or "unknown", source=source)
    return {"file_id": file_id, "position": pos, "status": "queued"}


# ============ 输出目录管理 ============
_output_dir = str(BASE_DIR / settings.output_dir)

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
    filename: str = Form("transcription"),
):
    """将转写结果保存到输出目录（.md 格式 + YAML frontmatter）"""
    if not os.path.isdir(_output_dir):
        raise HTTPException(status_code=400, detail="输出目录未配置")

    # 从内存进度或磁盘读取完整数据
    result_data = None
    with _progress_lock:
        p = _transcription_progress.get(file_id)
        if p and p.get("status") == "completed":
            result_data = dict(p)

    if not result_data:
        result_path = RESULTS_DIR / f"{file_id}.json"
        if result_path.exists():
            try:
                result_data = json.load(open(result_path, "r", encoding="utf-8"))
            except Exception:
                pass

    if not result_data:
        raise HTTPException(status_code=400, detail="没有转写文本")

    text = result_data.get("full_text", "")
    if not text:
        raise HTTPException(status_code=400, detail="没有转写文本")

    # Clean filename: strip original extension (e.g. "lecture.mp4" → "lecture")
    clean_name = Path(filename).stem

    # Build frontmatter
    completed_at = result_data.get("completed_at", time.time())
    if isinstance(completed_at, (int, float)):
        created = time.strftime("%Y-%m-%dT%H:%M:%S+08:00", time.localtime(completed_at))
    else:
        created = time.strftime("%Y-%m-%dT%H:%M:%S+08:00")

    frontmatter = f"""---
title: {clean_name}
source: ASR 语音转写
author: ASR 系统
published: {created}
created: {created}
description: {clean_name} 转写结果
tags: [ASR, 语音识别, 转写]
---

"""

    md_content = frontmatter + text
    out_path = Path(_output_dir) / f"{clean_name}.md"
    out_path.write_text(md_content, encoding="utf-8")
    return {"success": True, "path": str(out_path)}


@app.post("/save_text")
def save_text(
    filename: str = Form(...),
    content: str = Form(...),
):
    """将任意文本内容（ASS 字幕等）保存到输出目录"""
    if not os.path.isdir(_output_dir):
        raise HTTPException(status_code=400, detail="输出目录未配置")
    clean_name = Path(filename).name
    out_path = Path(_output_dir) / clean_name
    out_path.write_text(content, encoding="utf-8")
    return {"success": True, "path": str(out_path)}


# ============ LLM 配置管理（AI Agent 可用）============
LLM_CONFIG_PATH = BASE_DIR / "llm_config.json"

def _load_llm_config():
    if LLM_CONFIG_PATH.exists():
        try:
            return json.load(open(LLM_CONFIG_PATH, "r", encoding="utf-8"))
        except Exception:
            pass
    return {"api_url": "", "api_key": "", "model_name": "", "system_prompt": "", "temperature": 0.3}


@app.get("/llm_config")
def get_llm_config():
    """获取 LLM 配置（AI Agent 可调用，无需 Web UI）"""
    return _load_llm_config()


class LLMConfigBody(BaseModel):
    api_url: str = ""
    api_key: str = ""
    model_name: str = ""
    system_prompt: str = ""
    temperature: float = 0.3


@app.post("/llm_config")
def set_llm_config(config: LLMConfigBody):
    """保存 LLM 配置（AI Agent 可调用，无需 Web UI）"""
    data = config.model_dump()
    json.dump(data, open(LLM_CONFIG_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    return {"success": True}


# ============ 持久化结果查询 ============
@app.get("/results")
def list_results():
    """列出所有已持久化的转写结果"""
    files = sorted(RESULTS_DIR.glob("*.json"))
    results = []
    for f in files:
        if "_chunk_" in f.name:
            continue
        try:
            data = json.load(open(f, "r", encoding="utf-8"))
            results.append({
                "id": data.get("file_id", f.stem),
                "filename": data.get("filename", ""),
                "duration_sec": data.get("duration_sec", 0),
                "completed_at": data.get("completed_at", 0),
                "text_length": len(data.get("full_text", "")),
            })
        except Exception:
            pass
    return {"results": results}


@app.get("/results/{file_id}")
def get_result_file(file_id: str):
    """获取单个持久化结果"""
    path = RESULTS_DIR / f"{file_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="结果不存在")
    return json.load(open(path, "r", encoding="utf-8"))


# ============ 文件下载（供局域网其他机器使用）============

@app.get("/download/{filename:path}")
def download_file(filename: str):
    """从输出目录下载文件（支持 .md、.ass、.txt 等）"""
    # Security: prevent path traversal
    clean = Path(filename).name
    path = Path(_output_dir) / clean
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    from fastapi.responses import FileResponse
    return FileResponse(str(path), media_type="text/plain; charset=utf-8",
                        filename=clean, headers={"Content-Disposition": f"attachment; filename*=UTF-8''{clean}"})


@app.get("/files")
def list_files():
    """列出输出目录中的所有文件"""
    output_path = Path(_output_dir)
    if not output_path.exists():
        return {"files": []}
    files = []
    for f in sorted(output_path.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if f.is_file():
            stat = f.stat()
            files.append({
                "name": f.name,
                "size": stat.st_size,
                "modified": stat.st_mtime,
                "url": f"/download/{f.name}",
            })
    return {"files": files, "output_dir": _output_dir}


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
    logger.info(f"PyTorch: {torch.__version__} | CUDA: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        vram_gb = torch.cuda.get_device_properties(0).total_memory / 1024**3
        logger.info(f"GPU: {torch.cuda.get_device_name(0)} | VRAM: {vram_gb:.1f} GB")
    import socket
    try:
        host_ip = socket.gethostbyname(socket.gethostname())
    except Exception:
        host_ip = "127.0.0.1"
    logger.info(f"API 服务启动成功！")
    logger.info(f"  本机访问: http://localhost:{settings.api_port}")
    logger.info(f"  局域网:   http://{host_ip}:{settings.api_port}")
    logger.info(f"  端点列表:")
    logger.info(f"    GET  /                 - SPA 前端首页")
    logger.info(f"    POST /transcribe       - ASR 转写（阻塞）")
    logger.info(f"    POST /transcribe_async - ASR 转写（非阻塞+排队）")
    logger.info(f"    POST /transcribe_ass   - ASS 字幕下载")
    logger.info(f"    POST /ass_translate    - ASS 字幕 AI 翻译（双语输出）")
    logger.info(f"    POST /ass_watermark    - ASS 字幕水印生成")
    logger.info(f"    POST /ass_audit        - ASS 字幕轴审（闪轴/叠轴检测）")
    logger.info(f"    POST /ass_summary      - ASS 字幕片段总结（AI 分析）")
    logger.info(f"    POST /refine           - LLM 润色文本（非流式）")
    logger.info(f"    POST /refine_stream    - LLM 润色文本（流式 SSE）")
    logger.info(f"    POST /full_pipeline    - 完整流水线（ASR + LLM）")
    logger.info(f"    GET  /health           - 健康检查")
    logger.info(f"    GET  /guide            - SPA 指南")
    logger.info(f"    GET  /config           - SPA 配置")
    logger.info(f"    GET  /output_dir       - 获取输出目录")
    logger.info(f"    POST /output_dir       - 设置输出目录")
    logger.info(f"    POST /save_result      - 保存转写结果到输出目录（.md）")
    logger.info(f"    POST /save_text        - 保存任意文本到输出目录")
    logger.info(f"    GET  /transcribe_status/{{file_id}} - 查看转写进度")
    logger.info(f"    GET  /transcribe_stream/{{file_id}} - SSE 流式转写进度")
    logger.info(f"    GET  /transcribe_list   - 列出进行中任务")
    logger.info(f"    GET  /results           - 列出持久化结果")
    logger.info(f"    GET  /results/{{file_id}}   - 获取单个结果（含 full_text）")
    logger.info(f"    GET  /files             - 列出输出目录文件（LAN 访问）")
    logger.info(f"    GET  /download/{{filename}} - 下载输出目录文件（LAN 访问）")
    logger.info(f"    POST /llm_config       - 设置 LLM 配置（AI Agent）")
    uvicorn.run(app, host=settings.api_host, port=settings.api_port)
