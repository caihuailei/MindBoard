"""快速测试：ASR 模型 + 自适应合并"""
import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
from pathlib import Path

import torch
from qwen_asr import Qwen3ASRModel

BASE_DIR = Path(__file__).parent
MODEL_PATH = str(BASE_DIR / "models" / "Qwen3-ASR-1.7B")
ALIGNER_PATH = str(BASE_DIR / "models" / "Qwen3-ForcedAligner-0.6B")

# 1. 加载模型
print("加载模型...")
model = Qwen3ASRModel.from_pretrained(
    pretrained_model_name_or_path=MODEL_PATH,
    dtype=torch.bfloat16,
    device_map="cuda:0",
    attn_implementation="sdpa",
    max_inference_batch_size=1,
    max_new_tokens=512,
    forced_aligner=ALIGNER_PATH,
    forced_aligner_kwargs=dict(
        dtype=torch.bfloat16,
        device_map="cuda:0",
        attn_implementation="sdpa",
    ),
)
print("模型加载完成！")

# 2. 测试转写
test_audio = "https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-ASR-Repo/asr_en.wav"

print(f"\n转写: {test_audio}")
gen = model.transcribe_streaming(
    audio=test_audio,
    language="English",
    return_time_stamps=True,
)

all_words = []
total_duration = 0.0

for chunk in gen:
    print(f"  [块 {chunk.chunk_index}] {chunk.offset_sec:.1f}s: {chunk.text[:60]}")
    total_duration = max(total_duration, chunk.offset_sec + chunk.duration_sec)
    if chunk.time_stamps:
        for item in chunk.time_stamps.items:
            all_words.append({
                "start": item.start_time,
                "end": item.end_time,
                "word": item.text,
            })

# Debug: 打印前 10 个原始 word 看格式
print("\n原始 words 样例:")
for w in all_words[:10]:
    print(f"  [{w['start']:.2f}-{w['end']:.2f}] '{w['word']}'")

# 3. 自适应合并（含空格处理）
SPLIT_PUNCTUATION = ['。', '!', '?', '…', ' ', '、', '，', '？', '！', '.', ',', ';', ':']
ALL_PUNCTUATION = SPLIT_PUNCTUATION + ['"', "'", '「', '」', '『', '』', '《', '》', '・']


def has_chinese(text):
    return any('一' <= ch <= '鿿' for ch in text)


def remove_punctuation(text):
    for p in ALL_PUNCTUATION:
        text = text.replace(p, '')
    return text


def merge_segments_adaptive(words, max_chars=50, pause_threshold=0.3):
    if not words:
        return []
    full_text = "".join(w["word"] for w in words)
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

    is_chinese = has_chinese(full_text)
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
                text = _join_words(sub_buf, is_chinese)
                result.append({"start": sub_buf[0]["start"], "end": sub_buf[-1]["end"], "text": text})
                sub_buf = [w]
                sub_text_clean = w_clean
            else:
                sub_buf.append(w)
                sub_text_clean = sub_text_clean + w_clean if sub_text_clean else w_clean
        if sub_buf:
            text = _join_words(sub_buf, is_chinese)
            result.append({"start": sub_buf[0]["start"], "end": sub_buf[-1]["end"], "text": text})

    return result


def _join_words(words_list, is_chinese):
    """根据语言类型用合适的方式连接词序列"""
    if not words_list:
        return ""
    if is_chinese:
        return "".join(w["word"] for w in words_list).strip()
    # 英文：空格连接，然后清理标点前多余空格
    import re
    joined = " ".join(w["word"] for w in words_list)
    joined = re.sub(r'\s+([.,!?;:\'"])', r'\1', joined)
    joined = re.sub(r'\s+', ' ', joined)
    return joined.strip()


# 测试一下
segments = merge_segments_adaptive(all_words, max_chars=50, pause_threshold=0.3)

print(f"\n=== 结果 ===")
print(f"  总词数: {len(all_words)}")
print(f"  总段数: {len(segments)}")
for s in segments:
    print(f"  [{s['start']:.2f}s - {s['end']:.2f}s] {s['text']}")

print(f"\n=== 汇总 ===")
print(f"时长: {total_duration:.1f}s")
print("测试通过！")
