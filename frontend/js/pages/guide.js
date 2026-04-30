// Guide page — AI Agent developer guide
import { copyToClipboard, toast } from '../ui.js';

export function render() {
  const host = window.location.hostname || 'localhost';

  return `
    <div class="card guide-content">
      <h1 style="color:var(--accent);border-bottom:2px solid var(--accent);padding-bottom:8px">ASR API — AI Agent 接入指南</h1>
      <p class="mt-8">这是一份面向 <strong>AI Agent</strong> 和开发者的接入文档。服务器提供课堂录音/视频的 ASR 转写服务。</p>

      <div class="alert-box info mt-16">
        <strong>服务器地址</strong><br>
        <code>http://${host}:8000</code><br>
        当前设备 IP 由服务器动态获取，同一局域网可直接访问。
      </div>

      <div style="display:flex;gap:12px;flex-wrap:wrap;margin:16px 0">
        <a href="/openapi.json" class="btn btn-secondary btn-sm" target="_blank">OpenAPI 规范</a>
        <a href="#/config" class="btn btn-primary btn-sm">配置 LLM</a>
      </div>

      <h2>一、如何上传视频/音频</h2>
      <p>通过 HTTP multipart/form-data 上传文件（本服务仅支持文件上传）：</p>
      <pre><code>curl -X POST http://${host}:8000/transcribe \\
  -F "file=@/path/to/video.mp4" \\
  -F "language=Chinese" \\
  -F "max_chars=50" \\
  -F "pause_threshold=0.3" \\
  --max-time 3600 \\
  -o result.json<button class="copy-btn" data-copy="curl -X POST http://${host}:8000/transcribe \\\n  -F \"file=@/path/to/video.mp4\" \\\n  -F \"language=Chinese\" \\\n  -F \"max_chars=50\" \\\n  -F \"pause_threshold=0.3\" \\\n  --max-time 3600 \\\n  -o result.json">复制</button></code></pre>
      <p>支持格式：<code>.mp4 .avi .mkv .mov .wmv .webm .ts .wav .mp3 .m4a</code> 等。</p>

      <h3>异步上传（推荐用于大文件）</h3>
      <p>使用 <code>/transcribe_async</code> 立即返回 file_id，服务器排队依次处理：</p>
      <pre><code>curl -X POST http://${host}:8000/transcribe_async \\
  -F "file=@lecture.mp4" \\
  -F "language=Chinese"<button class="copy-btn" data-copy="curl -X POST http://${host}:8000/transcribe_async \\\n  -F \"file=@lecture.mp4\" \\\n  -F \"language=Chinese\"">复制</button></code></pre>
      <p>返回 <code>{"file_id":"xxx","status":"queued"}</code>，随后用 <code>/transcribe_status/{file_id}</code> 轮询进度。</p>

      <h2>二、API 端点列表</h2>
      <table>
        <tr><th>端点</th><th>方法</th><th>说明</th></tr>
        <tr><td><code>/health</code></td><td>GET</td><td>健康检查</td></tr>
        <tr><td><code>/transcribe</code></td><td>POST</td><td>上传文件并转写（阻塞）</td></tr>
        <tr><td><code>/transcribe_async</code></td><td>POST</td><td>上传文件并转写（非阻塞+排队）</td></tr>
        <tr><td><code>/transcribe_status/{file_id}</code></td><td>GET</td><td>查看转写进度</td></tr>
        <tr><td><code>/transcribe_stream/{file_id}</code></td><td>GET</td><td>SSE 流式转写进度推送</td></tr>
        <tr><td><code>/transcribe_list</code></td><td>GET</td><td>列出所有进行中的任务</td></tr>
        <tr><td><code>/transcribe_ass</code></td><td>POST</td><td>转写 + ASS 字幕下载</td></tr>
        <tr><td><code>/refine</code></td><td>POST</td><td>LLM 润色文本（非流式）</td></tr>
        <tr><td><code>/refine_stream</code></td><td>POST</td><td>LLM 润色文本（流式 SSE）</td></tr>
        <tr><td><code>/full_pipeline</code></td><td>POST</td><td>ASR + LLM 完整流水线</td></tr>
        <tr><td><code>/output_dir</code></td><td>GET</td><td>获取输出目录</td></tr>
        <tr><td><code>/output_dir</code></td><td>POST</td><td>设置输出目录</td></tr>
        <tr><td><code>/save_result</code></td><td>POST</td><td>保存转写结果到目录（.md）</td></tr>
        <tr><td><code>/save_text</code></td><td>POST</td><td>保存任意文本（ASS 等）到目录</td></tr>
        <tr><td><code>/results</code></td><td>GET</td><td>列出已持久化的结果</td></tr>
        <tr><td><code>/results/{file_id}</code></td><td>GET</td><td>获取单个结果的完整 JSON（含 full_text、segments）</td></tr>
        <tr><td><code>/files</code></td><td>GET</td><td>列出输出目录中的所有文件</td></tr>
        <tr><td><code>/download/{filename}</code></td><td>GET</td><td>下载输出目录中的文件（.md/.ass/.txt）</td></tr>
        <tr><td><code>/llm_config</code></td><td>GET</td><td>获取 LLM 配置</td></tr>
        <tr><td><code>/llm_config</code></td><td>POST</td><td>设置 LLM 配置</td></tr>
      </table>

      <h2>三、AI Agent 最佳流程</h2>
      <div class="alert-box info"><strong>推荐流程：</strong>先上传转写拿到文本，再单独调用 LLM 润色。</div>

      <h3>Step 1 — 上传文件</h3>
      <p>用 <code>/transcribe</code> 或 <code>/transcribe_async</code> 上传（multipart/form-data）。</p>

      <h3>Step 2 — 轮询进度</h3>
      <pre><code># 获取所有进行中的任务
curl http://${host}:8000/transcribe_list

# 查看具体任务的进度
curl http://${host}:8000/transcribe_status/{file_id}<button class="copy-btn" data-copy="curl http://${host}:8000/transcribe_list">复制</button></code></pre>

      <h3>Step 3 — (可选) LLM 润色</h3>
      <p><strong>DeepSeek API（推荐）：</strong></p>
      <pre><code>curl -X POST http://${host}:8000/refine \\
  -F "text=需要润色的文本..." \\
  -F "api_key=sk-xxx" \\
  -F "api_url=https://api.deepseek.com" \\
  -F "model_name=deepseek-chat"<button class="copy-btn" data-copy="curl -X POST http://${host}:8000/refine \\\n  -F \"text=需要润色的文本...\" \\\n  -F \"api_key=sk-xxx\" \\\n  -F \"api_url=https://api.deepseek.com\" \\\n  -F \"model_name=deepseek-chat\"">复制</button></code></pre>

      <p><strong>魔搭 ModelScope（推荐 GLM-5）：</strong></p>
      <pre><code>curl -X POST http://${host}:8000/refine \\
  -F "text=需要润色的文本..." \\
  -F "api_key=ms-xxx" \\
  -F "api_url=https://api-inference.modelscope.cn/v1" \\
  -F "model_name=ZhipuAI/GLM-5"<button class="copy-btn" data-copy="curl -X POST http://${host}:8000/refine \\\n  -F \"text=需要润色的文本...\" \\\n  -F \"api_key=ms-xxx\" \\\n  -F \"api_url=https://api-inference.modelscope.cn/v1\" \\\n  -F \"model_name=ZhipuAI/GLM-5\"">复制</button></code></pre>

      <p><strong>完整流水线一步到位：</strong></p>
      <pre><code>curl -X POST http://${host}:8000/full_pipeline \\
  -F "file=@lecture.mp4" \\
  -F "enable_llm=true" \\
  -F "api_key=你的密钥"<button class="copy-btn" data-copy="curl -X POST http://${host}:8000/full_pipeline \\\n  -F \"file=@lecture.mp4\" \\\n  -F \"enable_llm=true\" \\\n  -F \"api_key=你的密钥\"">复制</button></code></pre>

      <h3>Step 4 — (AI Agent) 远程配置 LLM</h3>
      <p>AI Agent 可通过 API 直接管理 LLM 配置，无需 Web UI：</p>
      <pre><code># 查看当前 LLM 配置
curl http://${host}:8000/llm_config

# 设置 LLM 配置
curl -X POST http://${host}:8000/llm_config \\
  -H "Content-Type: application/json" \\
  -d '{"api_url":"https://api.deepseek.com","api_key":"sk-xxx","model_name":"deepseek-chat","system_prompt":"你是一个助手。","temperature":0.3}'<button class="copy-btn" data-copy="curl -X POST http://${host}:8000/llm_config \\\n  -H \"Content-Type: application/json\" \\\n  -d '{\"api_url\":\"https://api.deepseek.com\",\"api_key\":\"sk-xxx\",\"model_name\":\"deepseek-chat\",\"system_prompt\":\"你是一个助手。\",\"temperature\":0.3}'">复制</button></code></pre>

      <h2>四、局域网完整调用流程（其他机器）</h2>
      <div class="alert-box info"><strong>场景：</strong>其他电脑通过 API 调用 ASR 转写 + LLM 润色 → 获取处理后的文稿</div>

      <h3>方式一：分步调用（推荐，可灵活控制）</h3>
      <pre><code># Step 1: 上传文件，获取 file_id
curl -X POST http://${host}:8000/transcribe_async \\
  -F "file=@lecture.mp4" \\
  -F "language=Chinese"

# 返回: {"file_id": "a1b2c3d4", "status": "queued"}

# Step 2: 轮询进度（每 3-5 秒一次）
curl http://${host}:8000/transcribe_status/a1b2c3d4

# Step 3: 转写完成后，获取完整结果（JSON）
curl http://${host}:8000/results/a1b2c3d4

# Step 4: 调用 LLM 润色（拿到处理后的文稿）
curl -X POST http://${host}:8000/refine \\
  -F "text=需要润色的文本..." \\
  -F "api_key=sk-xxx" \\
  -F "api_url=https://api.deepseek.com" \\
  -F "model_name=deepseek-chat"

# Step 5: 保存到服务器输出目录
curl -X POST http://${host}:8000/save_result \\
  -F "file_id=a1b2c3d4" \\
  -F "filename=lecture"

# Step 6: 下载保存的 .md 文件
curl -O http://${host}:8000/download/lecture.md

# 列出输出目录所有文件
curl http://${host}:8000/files<button class="copy-btn" data-copy="curl -X POST http://${host}:8000/transcribe_async \\\n  -F \"file=@lecture.mp4\" \\\n  -F \"language=Chinese\"\n\n# 轮询\ncurl http://${host}:8000/transcribe_status/a1b2c3d4\n\n# 润色\ncurl -X POST http://${host}:8000/refine \\\n  -F \"text=需要润色的文本...\" \\\n  -F \"api_key=sk-xxx\" \\\n  -F \"api_url=https://api.deepseek.com\" \\\n  -F \"model_name=deepseek-chat\"\n\n# 下载\ncurl -O http://${host}:8000/download/lecture.md\n\n# 列出文件\ncurl http://${host}:8000/files">复制</button></code></pre>

      <h3>方式二：一步到位（ASR + LLM）</h3>
      <pre><code>curl -X POST http://${host}:8000/full_pipeline \\
  -F "file=@lecture.mp4" \\
  -F "language=Chinese" \\
  -F "enable_llm=true" \\
  -F "api_key=sk-xxx" \\
  -F "api_url=https://api.deepseek.com" \\
  -F "model_name=deepseek-chat"<button class="copy-btn" data-copy="curl -X POST http://${host}:8000/full_pipeline \\\n  -F \"file=@lecture.mp4\" \\\n  -F \"language=Chinese\" \\\n  -F \"enable_llm=true\" \\\n  -F \"api_key=sk-xxx\" \\\n  -F \"api_url=https://api.deepseek.com\" \\\n  -F \"model_name=deepseek-chat\"">复制</button></code></pre>

      <h2>五、重要提醒</h2>
      <ul>
        <li><strong>长音频：</strong>3 小时视频约需 1-3 小时处理</li>
        <li><strong>GPU 占用：</strong>转写时 GPU 100% 满载</li>
        <li><strong>文件自动清理：</strong>处理完成后临时文件自动删除</li>
        <li><strong>进度查询：</strong>随时可通过 <code>transcribe_status</code> 查看已转写文字</li>
        <li><strong>局域网访问：</strong>使用服务器 IP <code>${host}</code>，端口 8000</li>
      </ul>

      <h2>六、OpenAPI / Swagger</h2>
      <ul>
        <li>Swagger UI: <a href="/docs" style="color:var(--accent)" target="_blank">/docs</a></li>
        <li>OpenAPI JSON: <a href="/openapi.json" style="color:var(--accent)" target="_blank">/openapi.json</a></li>
      </ul>
    </div>
  `;
}

export function init() {
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.copy;
      if (text) {
        copyToClipboard(text);
        toast('已复制', 'success');
      }
    });
  });
}
