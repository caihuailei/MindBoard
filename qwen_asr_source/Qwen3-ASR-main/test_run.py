"""Quick test: verify Qwen3-ASR runs on this machine with 8GB optimization."""
import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

import torch
from qwen_asr import Qwen3ASRModel

device = "cuda:0" if torch.cuda.is_available() else "cpu"
print(f"Using device: {device}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")

# Test GPU compute
x = torch.randn(1, 1).to(device)
print(f"GPU compute test: OK")

test_audio = "https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-ASR-Repo/asr_en.wav"

# Load model with 8GB-optimized settings
print("\nLoading model (this takes a moment)...")
model = Qwen3ASRModel.from_pretrained(
    pretrained_model_name_or_path="D:/models/Qwen3-ASR-1.7B",
    dtype=torch.bfloat16,
    device_map=device,
    attn_implementation="sdpa",          # Use PyTorch SDPA instead of flash-attn
    max_inference_batch_size=1,          # Process one chunk at a time
    max_new_tokens=512,
    forced_aligner="D:/models/Qwen3-ForcedAligner-0.6B",
    forced_aligner_kwargs=dict(
        dtype=torch.bfloat16,
        device_map=device,
        attn_implementation="sdpa",
    )
)
print("Model loaded successfully!")

# Test with streaming generator (memory efficient)
print("\nRunning transcription...")
gen = model.transcribe_streaming(
    audio=test_audio,
    language="English",
    return_time_stamps=True,
)
for chunk in gen:
    text_preview = chunk.text[:60] + "..." if len(chunk.text) > 60 else chunk.text
    print(f"[{chunk.offset_sec:.1f}s - {chunk.offset_sec + chunk.duration_sec:.1f}s] {text_preview}")
    if chunk.time_stamps:
        for item in chunk.time_stamps.items[:3]:
            print(f"    {item.start_time:.2f}s - {item.end_time:.2f}s: {item.text}")

info = gen.return_value
print(f"\n=== Result ===")
print(f"Language: {info.language}")
print(f"Text: {info.text}")
print(f"Duration: {info.duration:.1f}s")
print("\nAll tests passed!")
