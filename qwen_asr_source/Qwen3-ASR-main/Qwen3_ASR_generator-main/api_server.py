import torch
from qwen_asr.inference.qwen3_asr import Qwen3ASRModel

print("--- 开始测试 5060 兼容性 ---")
try:
    # 尝试加载一个小规模逻辑
    device = "cuda:0"
    # 只要能把一个 tensor 放到 GPU 上运算，就说明能用
    x = torch.randn(1, 1).to(device)
    print("GPU 运算测试成功！")
    
    # 尝试初始化模型 (路径改一下)
    model = Qwen3ASRModel.from_pretrained(
        pretrained_model_name_or_path="D:/models/Qwen3-ASR-1.7B",
        device_map=device,
        torch_dtype=torch.bfloat16,
        attn_implementation="sdpa" # 避开 flash-attn
    )
    print("模型加载成功！5060 可以起飞！")
except Exception as e:
    print(f"致命错误: {e}")
