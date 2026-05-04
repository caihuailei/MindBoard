// Guide page — Beautiful API documentation
import { copyToClipboard, toast } from '../ui.js';

export function render() {
  const host = window.location.hostname || 'localhost';

  return `
    <div class="guide-page">
      <!-- Hero Header -->
      <div class="guide-hero">
        <div class="guide-hero-icon">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="var(--primary)" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>
        <h1>ASR API 接入指南</h1>
        <p class="guide-subtitle">面向 AI Agent 和开发者的转写服务文档 · 服务器地址 <code>http://${host}:8000</code></p>
        <div class="guide-hero-links">
          <a href="/docs" target="_blank" class="guide-badge-link">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Swagger UI
          </a>
          <a href="/openapi.json" target="_blank" class="guide-badge-link">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            OpenAPI JSON
          </a>
        </div>
      </div>

      <div class="guide-body">
        <!-- Table of Contents -->
        <div class="guide-toc">
          <div class="guide-toc-title">目录</div>
          <a href="#sec-upload" class="guide-toc-link active">一、上传文件</a>
          <a href="#sec-api-list" class="guide-toc-link">二、API 端点列表</a>
          <a href="#sec-flow" class="guide-toc-link">三、最佳调用流程</a>
          <a href="#sec-tips" class="guide-toc-link">四、注意事项</a>
        </div>

        <!-- Content -->
        <div class="guide-prose">
          <section id="sec-upload">
            <h2>一、上传文件</h2>
            <p>通过 HTTP <code>multipart/form-data</code> 上传文件，支持同步和异步两种方式。</p>

            <div class="guide-card">
              <div class="guide-card-header">
                <span class="guide-method post">POST</span>
                <span class="guide-endpoint">/transcribe</span>
              </div>
              <div class="guide-card-body">
                <p class="guide-desc">同步转写 — 等待处理完成后返回结果（适合小文件）</p>
                <div class="guide-code-block">
                  <div class="guide-code-header">
                    <span class="guide-code-lang">bash</span>
                    <button class="guide-code-copy" data-copy="curl -X POST http://${host}:8000/transcribe -F \"file=@video.mp4\" -F \"language=Chinese\" -F \"max_chars=50\" -F \"pause_threshold=0.3\" --max-time 3600">复制</button>
                  </div>
                  <pre><code>curl -X POST http://${host}:8000/transcribe \\
  -F "file=@/path/to/video.mp4" \\
  -F "language=Chinese" \\
  -F "max_chars=50" \\
  -F "pause_threshold=0.3" \\
  --max-time 3600</code></pre>
                </div>
              </div>
            </div>

            <div class="guide-card">
              <div class="guide-card-header">
                <span class="guide-method post">POST</span>
                <span class="guide-endpoint">/transcribe_async</span>
              </div>
              <div class="guide-card-body">
                <p class="guide-desc">异步转写 — 立即返回 <code>file_id</code>，适合大文件（推荐）</p>
                <div class="guide-code-block">
                  <div class="guide-code-header">
                    <span class="guide-code-lang">bash</span>
                    <button class="guide-code-copy" data-copy="curl -X POST http://${host}:8000/transcribe_async -F \"file=@lecture.mp4\" -F \"language=Chinese\"">复制</button>
                  </div>
                  <pre><code>curl -X POST http://${host}:8000/transcribe_async \\
  -F "file=@lecture.mp4" \\
  -F "language=Chinese"

# 返回: {"file_id": "a1b2c3d4", "status": "queued"}</code></pre>
                </div>
              </div>
            </div>
          </section>

          <section id="sec-api-list">
            <h2>二、API 端点列表</h2>
            <div class="guide-table-wrapper">
              <table class="guide-table">
                <thead>
                  <tr><th>方法</th><th>端点</th><th>说明</th></tr>
                </thead>
                <tbody>
                  <tr><td><span class="guide-method get">GET</span></td><td><code>/health</code></td><td>健康检查</td></tr>
                  <tr><td><span class="guide-method post">POST</span></td><td><code>/transcribe</code></td><td>同步上传并转写</td></tr>
                  <tr><td><span class="guide-method post">POST</span></td><td><code>/transcribe_async</code></td><td>异步上传并转写</td></tr>
                  <tr><td><span class="guide-method get">GET</span></td><td><code>/transcribe_status/:id</code></td><td>查询转写进度</td></tr>
                  <tr><td><span class="guide-method get">GET</span></td><td><code>/transcribe_stream/:id</code></td><td>SSE 流式推送</td></tr>
                  <tr><td><span class="guide-method get">GET</span></td><td><code>/transcribe_list</code></td><td>列出所有任务</td></tr>
                  <tr><td><span class="guide-method post">POST</span></td><td><code>/transcribe_ass</code></td><td>转写 + ASS 字幕</td></tr>
                  <tr><td><span class="guide-method post">POST</span></td><td><code>/refine</code></td><td>LLM 润色（非流式）</td></tr>
                  <tr><td><span class="guide-method post">POST</span></td><td><code>/refine_stream</code></td><td>LLM 润色（流式）</td></tr>
                  <tr><td><span class="guide-method post">POST</span></td><td><code>/full_pipeline</code></td><td>ASR + LLM 完整流程</td></tr>
                  <tr><td><span class="guide-method get">GET</span></td><td><code>/results</code></td><td>列出已保存结果</td></tr>
                  <tr><td><span class="guide-method get">GET</span></td><td><code>/results/:id</code></td><td>获取单个结果 JSON</td></tr>
                  <tr><td><span class="guide-method get">GET</span></td><td><code>/files</code></td><td>列出输出目录文件</td></tr>
                  <tr><td><span class="guide-method get">GET</span></td><td><code>/download/:name</code></td><td>下载文件</td></tr>
                  <tr><td><span class="guide-method post">POST</span></td><td><code>/save_result</code></td><td>保存转写结果</td></tr>
                  <tr><td><span class="guide-method get">GET</span></td><td><code>/llm_config</code></td><td>获取 LLM 配置</td></tr>
                  <tr><td><span class="guide-method post">POST</span></td><td><code>/llm_config</code></td><td>设置 LLM 配置</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="sec-flow">
            <h2>三、最佳调用流程</h2>

            <div class="guide-alert guide-alert--info">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              <span>推荐流程：先上传转写拿到文本，再单独调用 LLM 润色</span>
            </div>

            <div class="guide-steps">
              <div class="guide-step">
                <div class="guide-step-number">1</div>
                <div class="guide-step-content">
                  <h3>上传文件</h3>
                  <p>使用 <code>/transcribe_async</code> 上传文件，获取 <code>file_id</code></p>
                </div>
              </div>
              <div class="guide-step">
                <div class="guide-step-number">2</div>
                <div class="guide-step-content">
                  <h3>轮询进度</h3>
                  <p>每 3-5 秒调用 <code>/transcribe_status/:id</code> 查看进度</p>
                  <div class="guide-code-block">
                    <div class="guide-code-header">
                      <span class="guide-code-lang">bash</span>
                      <button class="guide-code-copy" data-copy="curl http://${host}:8000/transcribe_status/a1b2c3d4">复制</button>
                    </div>
                    <pre><code>curl http://${host}:8000/transcribe_status/a1b2c3d4</code></pre>
                  </div>
                </div>
              </div>
              <div class="guide-step">
                <div class="guide-step-number">3</div>
                <div class="guide-step-content">
                  <h3>获取结果</h3>
                  <p>转写完成后通过 <code>/results/:id</code> 获取完整 JSON（含 <code>full_text</code>、<code>segments</code>）</p>
                </div>
              </div>
              <div class="guide-step">
                <div class="guide-step-number">4</div>
                <div class="guide-step-content">
                  <h3>LLM 润色（可选）</h3>
                  <p>使用 <code>/refine</code> 接口，传入 LLM 配置进行文本润色</p>
                  <div class="guide-code-block">
                    <div class="guide-code-header">
                      <span class="guide-code-lang">bash</span>
                      <button class="guide-code-copy" data-copy="curl -X POST http://${host}:8000/refine -F \"text=需要润色的文本...\" -F \"api_key=sk-xxx\" -F \"api_url=https://api.deepseek.com\" -F \"model_name=deepseek-chat\"">复制</button>
                    </div>
                    <pre><code>curl -X POST http://${host}:8000/refine \\
  -F "text=需要润色的文本..." \\
  -F "api_key=sk-xxx" \\
  -F "api_url=https://api.deepseek.com" \\
  -F "model_name=deepseek-chat"</code></pre>
                  </div>
                </div>
              </div>
              <div class="guide-step">
                <div class="guide-step-number">5</div>
                <div class="guide-step-content">
                  <h3>保存 & 下载</h3>
                  <p>保存到输出目录或直接下载 <code>.md</code> 文件</p>
                  <div class="guide-code-block">
                    <div class="guide-code-header">
                      <span class="guide-code-lang">bash</span>
                      <button class="guide-code-copy" data-copy="curl -X POST http://${host}:8000/save_result -F \"file_id=a1b2c3d4\" -F \"filename=lecture\"\n\n# 下载\ncurl -O http://${host}:8000/download/lecture.md">复制</button>
                    </div>
                    <pre><code>curl -X POST http://${host}:8000/save_result \\
  -F "file_id=a1b2c3d4" \\
  -F "filename=lecture"

curl -O http://${host}:8000/download/lecture.md</code></pre>
                  </div>
                </div>
              </div>
            </div>

            <h3>一步到位：完整流水线</h3>
            <div class="guide-code-block">
              <div class="guide-code-header">
                <span class="guide-code-lang">bash</span>
                <button class="guide-code-copy" data-copy="curl -X POST http://${host}:8000/full_pipeline -F \"file=@lecture.mp4\" -F \"enable_llm=true\" -F \"api_key=sk-xxx\" -F \"api_url=https://api.deepseek.com\" -F \"model_name=deepseek-chat\"">复制</button>
              </div>
              <pre><code>curl -X POST http://${host}:8000/full_pipeline \\
  -F "file=@lecture.mp4" \\
  -F "enable_llm=true" \\
  -F "api_key=sk-xxx" \\
  -F "api_url=https://api.deepseek.com" \\
  -F "model_name=deepseek-chat"</code></pre>
            </div>

            <h3>远程配置 LLM</h3>
            <p>AI Agent 可通过 API 直接管理 LLM 配置：</p>
            <div class="guide-code-block">
              <div class="guide-code-header">
                <span class="guide-code-lang">bash</span>
                <button class="guide-code-copy" data-copy="curl -X POST http://${host}:8000/llm_config -H \"Content-Type: application/json\" -d '{\"api_url\":\"https://api.deepseek.com\",\"api_key\":\"sk-xxx\",\"model_name\":\"deepseek-chat\",\"system_prompt\":\"你是一个助手。\",\"temperature\":0.3}'">复制</button>
              </div>
              <pre><code>curl -X POST http://${host}:8000/llm_config \\
  -H "Content-Type: application/json" \\
  -d '{"api_url":"https://api.deepseek.com","api_key":"sk-xxx","model_name":"deepseek-chat"}'</code></pre>
            </div>
          </section>

          <section id="sec-tips">
            <h2>四、注意事项</h2>
            <div class="guide-alert guide-alert--warning">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <div>
                <strong>GPU 占用</strong> — 转写时 GPU 100% 满载，3 小时视频约需 1-3 小时处理
              </div>
            </div>
            <div class="guide-alert guide-alert--success">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <div>
                <strong>文件自动清理</strong> — 处理完成后临时文件自动删除
              </div>
            </div>
            <ul>
              <li>支持格式：<code>.mp4 .avi .mkv .mov .wmv .webm .ts .wav .mp3 .m4a</code> 等</li>
              <li>局域网访问：使用服务器 IP <code>${host}</code>，端口 <code>8000</code></li>
              <li>进度查询：随时可通过 <code>/transcribe_status/:id</code> 查看已转写文字</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  `;
}

export function init() {
  // Copy buttons
  document.querySelectorAll('.guide-code-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.copy;
      if (text) { copyToClipboard(text); toast('已复制', 'success'); }
      btn.textContent = '已复制!';
      setTimeout(() => { btn.textContent = '复制'; }, 1500);
    });
  });

  // TOC scroll tracking
  const tocLinks = document.querySelectorAll('.guide-toc-link');
  const sections = [...tocLinks].map(l => document.querySelector(l.getAttribute('href')));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        tocLinks.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + id));
      }
    });
  }, { rootMargin: '-20% 0px -60% 0px' });

  sections.forEach(s => s && observer.observe(s));
}
