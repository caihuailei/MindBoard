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
      <p>有两种方式将文件传给本服务：</p>

      <h3>方式 A：直接上传（推荐）</h3>
      <p>用 HTTP multipart/form-data 上传文件：</p>
      <pre><code>curl -X POST http://${host}:8000/transcribe \\
  -F "file=@/path/to/video.mp4" \\
  -F "language=Chinese" \\
  -F "max_chars=50" \\
  -F "pause_threshold=0.3" \\
  --max-time 3600 \\
  -o result.json<button class="copy-btn" data-copy="curl -X POST http://${host}:8000/transcribe \\\n  -F \"file=@/path/to/video.mp4\" \\\n  -F \"language=Chinese\" \\\n  -F \"max_chars=50\" \\\n  -F \"pause_threshold=0.3\" \\\n  --max-time 3600 \\\n  -o result.json">复制</button></code></pre>
      <p>支持格式：<code>.mp4 .avi .mkv .mov .wmv .webm .ts .wav .mp3 .m4a</code> 等。</p>

      <h3>方式 B：通过 URL 下载</h3>
      <pre><code>curl -X POST http://${host}:8000/transcribe_url \\
  -F "url=https://example.com/lecture.mp4" \\
  -F "language=Chinese"<button class="copy-btn" data-copy="curl -X POST http://${host}:8000/transcribe_url \\\n  -F \"url=https://example.com/lecture.mp4\" \\\n  -F \"language=Chinese\"">复制</button></code></pre>

      <h2>二、API 端点列表</h2>
      <table>
        <tr><th>端点</th><th>方法</th><th>说明</th></tr>
        <tr><td><code>/health</code></td><td>GET</td><td>健康检查</td></tr>
        <tr><td><code>/transcribe</code></td><td>POST</td><td>上传文件并转写（阻塞）</td></tr>
        <tr><td><code>/transcribe_async</code></td><td>POST</td><td>上传文件并转写（非阻塞+排队）</td></tr>
        <tr><td><code>/transcribe_url</code></td><td>POST</td><td>传 URL 转写</td></tr>
        <tr><td><code>/transcribe_status/{file_id}</code></td><td>GET</td><td>查看转写进度</td></tr>
        <tr><td><code>/transcribe_list</code></td><td>GET</td><td>列出所有进行中的任务</td></tr>
        <tr><td><code>/transcribe_ass</code></td><td>POST</td><td>转写 + ASS 字幕下载</td></tr>
        <tr><td><code>/refine</code></td><td>POST</td><td>LLM 润色文本</td></tr>
        <tr><td><code>/full_pipeline</code></td><td>POST</td><td>ASR + LLM 完整流水线</td></tr>
      </table>

      <h2>三、AI Agent 最佳流程</h2>
      <div class="alert-box info"><strong>推荐流程：</strong>先上传转写拿到文本，再单独调用 LLM 润色。</div>

      <h3>Step 1 — 获取文件</h3>
      <p>用 <code>/transcribe</code> 上传（multipart/form-data）或用 <code>/transcribe_url</code> 传 URL。</p>

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

      <h2>四、重要提醒</h2>
      <ul>
        <li><strong>长音频：</strong>3 小时视频约需 1-3 小时处理</li>
        <li><strong>GPU 占用：</strong>转写时 GPU 100% 满载</li>
        <li><strong>文件自动清理：</strong>处理完成后临时文件自动删除</li>
        <li><strong>进度查询：</strong>随时可通过 <code>transcribe_status</code> 查看已转写文字</li>
      </ul>

      <h2>五、OpenAPI / Swagger</h2>
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
