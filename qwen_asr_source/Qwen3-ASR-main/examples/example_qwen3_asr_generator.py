"""
Example: Use transcribe_streaming() generator for memory-efficient ASR on 8GB GPUs.

This example demonstrates the generator-based streaming transcription that processes
audio chunk by chunk, clearing GPU cache between chunks to minimize VRAM usage.
"""
import torch
from qwen_asr import Qwen3ASRModel, ASRTranscriptionChunk, ASRTranscriptionInfo

model_path = "Qwen/Qwen3-ASR-1.7B"
audio_path = "path/to/your/audio.wav"

# Initialize model with memory-optimized settings for 8GB GPUs
model = Qwen3ASRModel.from_pretrained(
    pretrained_model_name_or_path=model_path,
    dtype=torch.bfloat16,
    device_map="cuda:0",
    attn_implementation="flash_attention_2",
    max_inference_batch_size=1,  # Small batch size reduces VRAM usage
    max_new_tokens=512,
    forced_aligner="Qwen/Qwen3-ForcedAligner-0.6B",
    forced_aligner_kwargs=dict(
        dtype=torch.bfloat16,
        device_map="cuda:0",
        attn_implementation="flash_attention_2",
    )
)

print("Processing audio with generator-based streaming ...\n")

# Use the generator to process chunk by chunk
gen = model.transcribe_streaming(
    audio=audio_path,
    language="Chinese",
    return_time_stamps=True,
)

for chunk in gen:
    print(f"[Chunk {chunk.chunk_index}] (offset: {chunk.offset_sec:.1f}s, "
          f"duration: {chunk.duration_sec:.1f}s)")
    print(f"  Text: {chunk.text}")

    # Print timestamps for this chunk
    if chunk.time_stamps:
        for item in chunk.time_stamps.items:
            print(f"  {item.start_time:.2f}s - {item.end_time:.2f}s: {item.text}")
    print()

# The generator's return value contains merged results (via gen.return_value)
info = gen.return_value
print(f"=== Final Result ===")
print(f"Language: {info.language}")
print(f"Total duration: {info.duration:.1f}s")
print(f"Full text: {info.text}")
