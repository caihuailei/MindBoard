"""
nanobot 服务管理器 — 子进程生命周期管理 + 工作区初始化
"""
import json
import logging
import subprocess
import time
from pathlib import Path

import httpx

logger = logging.getLogger("asr-api.nanobot")

DEFAULT_PORT = 18900

SOUL_MD = """\
你是一个专业的 ASR 文本润色和分析助手。你的用户是一名音频/视频内容创作者。
你的主要任务是：润色语音转写文本、整理字幕、分析文本内容。

沟通风格：
- 输出使用中文标点符号
- 保持口语和书面语的自然平衡
- 尊重用户的专业术语，不要随意替换
- 输出简洁，不啰嗦
"""

USER_MD = """\
# User Profile

## 偏好
（Dream 会从交互历史中自动学习并填写）

## 常用术语
（自动积累）

## 风格偏好
（自动积累）
"""

MEMORY_MD = """\
# ASR Server Project Memory

## 项目信息
- ASR 语音识别服务，基于 Qwen3-ASR 模型
- 提供转写、润色、分析、ASS 字幕等功能
- 前端是 Vanilla JS SPA，后端是 FastAPI

## 用户习惯
（Dream 会从历史中 auto-learn）
"""


class NanobotManager:
    """nanobot 服务生命周期管理（子进程模式）"""

    def __init__(self, workspace: Path | str | None = None, port: int = DEFAULT_PORT):
        base = Path(__file__).parent
        self.workspace = Path(workspace) if workspace else base / ".nanobot-workspace"
        self.port = port
        self.host = "127.0.0.1"
        self.proc: subprocess.Popen | None = None

    @property
    def api_url(self) -> str:
        return f"http://{self.host}:{self.port}/v1"

    @property
    def health_url(self) -> str:
        return f"http://{self.host}:{self.port}/health"

    def _ensure_workspace(self):
        """首次启动时生成 workspace 文件"""
        self.workspace.mkdir(parents=True, exist_ok=True)
        memory_dir = self.workspace / "memory"
        memory_dir.mkdir(exist_ok=True)

        # SOUL.md
        soul = self.workspace / "SOUL.md"
        if not soul.exists():
            soul.write_text(SOUL_MD, encoding="utf-8")
            logger.info("Created SOUL.md")

        # USER.md
        user = self.workspace / "USER.md"
        if not user.exists():
            user.write_text(USER_MD, encoding="utf-8")
            logger.info("Created USER.md")

        # memory/MEMORY.md
        mem = memory_dir / "MEMORY.md"
        if not mem.exists():
            mem.write_text(MEMORY_MD, encoding="utf-8")
            logger.info("Created MEMORY.md")

        # workspace/config.json
        cfg = self.workspace / "config.json"
        if not cfg.exists():
            config = {
                "agents": {
                    "defaults": {
                        "workspace": str(self.workspace),
                        "model": "deepseek/deepseek-chat",
                        "provider": "custom",
                        "dream": {"intervalH": 2},
                    }
                },
                "providers": {
                    "custom": {
                        "api_key": "",
                        "api_base": "",
                    }
                },
                "api": {
                    "host": self.host,
                    "port": self.port,
                },
            }
            cfg.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
            logger.info("Created config.json")

    def _init_from_asr_config(self, llm_config_path: Path | None = None):
        """如果 ASR 已有 LLM 配置，自动填入 nanobot 的上游 provider"""
        if llm_config_path and llm_config_path.exists():
            try:
                asr_cfg = json.loads(llm_config_path.read_text(encoding="utf-8"))
                if asr_cfg.get("api_url") and asr_cfg.get("api_key"):
                    cfg = self.workspace / "config.json"
                    data = json.loads(cfg.read_text(encoding="utf-8"))
                    api_base = asr_cfg["api_url"]
                    api_key = asr_cfg["api_key"]
                    model = asr_cfg.get("model_name", "deepseek/deepseek-chat")
                    data["providers"]["custom"]["api_base"] = api_base
                    data["providers"]["custom"]["api_key"] = api_key
                    data["agents"]["defaults"]["model"] = model
                    cfg.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
                    logger.info(f"Filled nanobot provider from {llm_config_path}")
            except Exception as e:
                logger.warning(f"Failed to read ASR config for nanobot: {e}")

    def is_running(self) -> bool:
        """检查进程存活 + HTTP 健康检查"""
        if self.proc is None:
            return False
        if self.proc.poll() is not None:
            return False
        try:
            with httpx.Client(timeout=3) as c:
                r = c.get(self.health_url)
                return r.status_code == 200
        except Exception:
            return False

    def start(self, llm_config_path: Path | None = None) -> tuple[bool, str]:
        """启动 nanobot serve 子进程"""
        if self.is_running():
            return True, "nanobot 已在运行中"

        # 检查 CLI 是否存在
        try:
            result = subprocess.run(
                ["nanobot", "--version"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode != 0:
                return False, "nanobot CLI 不可用，请运行: pip install nanobot-ai[api]"
        except FileNotFoundError:
            return False, "nanobot 未安装，请运行: pip install nanobot-ai[api]"

        self._ensure_workspace()
        self._init_from_asr_config(llm_config_path)

        logger.info(f"Starting nanobot serve on port {self.port} (workspace={self.workspace})")
        try:
            self.proc = subprocess.Popen(
                [
                    "nanobot", "serve",
                    "--workspace", str(self.workspace),
                    "--config", str(self.workspace / "config.json"),
                    "--port", str(self.port),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
            )
        except Exception as e:
            return False, f"启动失败: {e}"

        # 等待健康检查通过（最多 30 秒）
        for i in range(60):
            time.sleep(0.5)
            if self.is_running():
                logger.info(f"nanobot started successfully (port {self.port})")
                return True, f"nanobot 已启动 (端口 {self.port})"

        self.stop()
        return False, "nanobot 启动超时，请检查日志"

    def stop(self) -> tuple[bool, str]:
        """关闭子进程"""
        if self.proc is None:
            return True, "nanobot 未运行"

        try:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=5)
            logger.info("nanobot stopped")
            return True, "nanobot 已停止"
        except Exception as e:
            logger.error(f"Error stopping nanobot: {e}")
            self.proc = None
            return False, f"停止失败: {e}"
        finally:
            self.proc = None

    def get_status(self) -> dict:
        """返回状态字典"""
        running = self.is_running()
        return {
            "running": running,
            "port": self.port,
            "workspace": str(self.workspace),
            "api_url": self.api_url if running else "",
        }
