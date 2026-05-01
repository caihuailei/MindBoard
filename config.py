"""统一配置管理 — 从环境变量 / .env 文件加载"""
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # 服务器
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    # 模型路径
    model_path: str = "models/Qwen3-ASR-1.7B"
    aligner_path: str = "models/Qwen3-ForcedAligner-0.6B"

    # 目录
    temp_dir: str = "temp"
    results_dir: str = "results"
    output_dir: str = "output"

    # LLM 默认配置（前端可覆盖）
    llm_api_url: str = "https://api.deepseek.com"
    llm_api_key: Optional[str] = None
    llm_model_name: str = "deepseek-chat"

    # 设备
    device: str = "cuda:0"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
