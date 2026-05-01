// ASS Subtitle page — tab-based: Generate / Translate / Toolbox
import { toast, downloadText, formatFileSize, formatDuration } from '../ui.js';
import { API } from '../api.js';

export function render() {
  return `
    <div class="card">
      <h2>ASS 字幕工具</h2>
      <div class="tab-bar" id="assTabBar">
        <button class="tab-btn active" data-tab="generate">从音视频生成</button>
        <button class="tab-btn" data-tab="translate">翻译已有 ASS</button>
        <button class="tab-btn" data-tab="toolbox">工具箱</button>
      </div>

      <!-- 模式 1: 从音视频生成 -->
      <div id="assGenPanel">
        <div class="drop-zone" id="assDropZone">
          <p>拖放音视频文件到此处，或点击选择</p>
        </div>
        <input type="file" id="assFileInput" accept="audio/*,video/*" hidden>

        <div class="form-group mt-16">
          <label>语言</label>
          <select class="form-input" id="assLang">
            <option value="Chinese">中文</option>
            <option value="English">英文</option>
            <option value="Japanese">日文</option>
            <option value="Korean">韩文</option>
            <option value="auto">自动检测</option>
          </select>
        </div>

        <div class="form-group">
          <label>上下文提示（可选）</label>
          <input type="text" class="form-input" id="assContext" placeholder="如: 网络安全课程">
        </div>

        <button class="btn btn-primary" id="assGenerateBtn">生成并下载 ASS</button>
        <div id="assStatus" class="mt-8 text-sm text-dim"></div>
        <div id="assProgressBar" class="progress-bar mt-8 hidden"><div class="progress-fill indeterminate" style="width:30%"></div></div>
      </div>

      <!-- 模式 2: 翻译已有 ASS -->
      <div id="assTransPanel" class="hidden">
        <div class="drop-zone" id="assTransDropZone">
          <p>拖放 ASS 文件到此处，或点击选择</p>
        </div>
        <input type="file" id="assTransFileInput" accept=".ass" hidden>

        <div id="assTransConfig" class="mt-16">
          <div class="form-group">
            <label>LLM 配置</label>
            <div id="assTransLlmStatus" class="text-sm text-dim">未检测到 LLM 配置</div>
          </div>
          <div class="form-group">
            <label>批次大小</label>
            <input type="number" class="form-input" id="assTransBatchSize" value="200" min="50" max="500">
          </div>
          <div class="form-group">
            <label>目标语言</label>
            <select class="form-input" id="assTransTargetLang">
              <option value="Chinese">中文</option>
              <option value="English">英文</option>
              <option value="Japanese">日文</option>
              <option value="Korean">韩文</option>
            </select>
          </div>
        </div>

        <button class="btn btn-primary" id="assTransBtn">开始翻译</button>
        <div id="assTransStatus" class="mt-8 text-sm text-dim"></div>
        <div id="assTransProgress" class="progress-bar mt-8 hidden"><div class="progress-fill indeterminate" style="width:30%"></div></div>
      </div>

      <!-- 模式 3: 工具箱 -->
      <div id="assToolPanel" class="hidden">
        <!-- 水印 -->
        <div class="card" style="border:1px solid var(--border)">
          <h3>水印生成</h3>
          <div class="drop-zone" id="wmDropZone" style="padding:12px">
            <p class="text-sm">拖放 ASS 文件到此处</p>
          </div>
          <input type="file" id="wmFileInput" accept=".ass" hidden>
          <div class="form-group mt-8">
            <input type="text" class="form-input" id="wmText" placeholder="水印文本，如: @我的频道">
          </div>
          <button class="btn btn-secondary btn-sm" id="wmBtn">添加水印并下载</button>
        </div>

        <!-- 轴审 -->
        <div class="card mt-16" style="border:1px solid var(--border)">
          <h3>轴审（检测闪轴/叠轴）</h3>
          <div class="drop-zone" id="auditDropZone" style="padding:12px">
            <p class="text-sm">拖放 ASS 文件到此处</p>
          </div>
          <input type="file" id="auditFileInput" accept=".ass" hidden>
          <button class="btn btn-secondary btn-sm" id="auditBtn">开始审轴</button>
          <div id="auditResult" class="mt-8"></div>
        </div>

        <!-- 片段总结 -->
        <div class="card mt-16" style="border:1px solid var(--border)">
          <h3>片段总结</h3>
          <div class="drop-zone" id="summaryDropZone" style="padding:12px">
            <p class="text-sm">拖放 ASS 文件到此处</p>
          </div>
          <input type="file" id="summaryFileInput" accept=".ass" hidden>
          <div class="form-group mt-8">
            <label>时间窗（分钟）</label>
            <input type="number" class="form-input" id="summaryWindow" value="15" min="1" max="60">
          </div>
          <button class="btn btn-secondary btn-sm" id="summaryBtn">开始总结</button>
          <div id="summaryResult" class="mt-8"></div>
        </div>
      </div>
    </div>

    <!-- 结果预览 -->
    <div id="assResultCard" class="card hidden">
      <h2>字幕预览</h2>
      <div id="assPreview" class="transcript-body" style="max-height:300px;font-family:monospace;font-size:0.8em"></div>
      <div class="btn-group">
        <button class="btn btn-primary btn-sm" id="assDownloadBtn">下载 .ass</button>
        <button class="btn btn-secondary btn-sm" id="assSaveToDirBtn">保存到输出目录</button>
      </div>
    </div>

    <div class="card">
      <h2>最近下载</h2>
      <div id="assHistory"></div>
    </div>
  `;
}

export function init() {
  // === Tab switching ===
  const tabBar = document.getElementById('assTabBar');
  tabBar.addEventListener('click', (e) => {
    if (!e.target.classList.contains('tab-btn')) return;
    tabBar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    const tab = e.target.dataset.tab;
    document.getElementById('assGenPanel').classList.toggle('hidden', tab !== 'generate');
    document.getElementById('assTransPanel').classList.toggle('hidden', tab !== 'translate');
    document.getElementById('assToolPanel').classList.toggle('hidden', tab !== 'toolbox');
  });

  // === Mode 1: Generate from A/V ===
  const dropZone = document.getElementById('assDropZone');
  const fileInput = document.getElementById('assFileInput');
  setupDropZone(dropZone, fileInput, (f) => { selectedAssFile = f; dropZone.innerHTML = `<p>已选择: ${f.name} (${formatFileSize(f.size)})</p>`; });
  document.getElementById('assGenerateBtn').addEventListener('click', startAssGenerate);
  document.getElementById('assDownloadBtn')?.addEventListener('click', () => {
    const state = JSON.parse(sessionStorage.getItem('ass_state') || '{}');
    if (state.assContent && state.cleanName) downloadText(state.assContent, state.cleanName + '.ass');
  });
  document.getElementById('assSaveToDirBtn')?.addEventListener('click', saveAssToDir);

  // Restore completed result
  const savedState = JSON.parse(sessionStorage.getItem('ass_state') || 'null');
  if (savedState?.assContent) {
    document.getElementById('assPreview').textContent = savedState.assContent;
    document.getElementById('assResultCard').classList.remove('hidden');
  }

  // Restore in-progress
  const inProgress = JSON.parse(sessionStorage.getItem('ass_in_progress') || 'null');
  if (inProgress) {
    const statusEl = document.getElementById('assStatus');
    const progressBar = document.getElementById('assProgressBar');
    statusEl.textContent = '正在恢复转写状态...';
    progressBar.classList.remove('hidden');
    resumeTranscription(inProgress.fileId, statusEl, progressBar, inProgress.cleanName);
  }

  // === Mode 2: Translate ASS ===
  const transDropZone = document.getElementById('assTransDropZone');
  const transFileInput = document.getElementById('assTransFileInput');
  setupDropZone(transDropZone, transFileInput, (f) => { selectedTransFile = f; transDropZone.innerHTML = `<p>已选择: ${f.name} (${formatFileSize(f.size)})</p>`; });
  document.getElementById('assTransBtn').addEventListener('click', startAssTranslate);

  // Show LLM config status for translation
  const llmConfig = JSON.parse(localStorage.getItem('asr_llm_config') || '{}');
  const llmStatus = document.getElementById('assTransLlmStatus');
  if (llmConfig.api_key && llmConfig.api_url) {
    llmStatus.textContent = `LLM: ${llmConfig.model_name || '已配置'} (${llmConfig.api_url})`;
    llmStatus.className = 'text-sm text-success';
  }

  // === Mode 3: Toolbox ===
  // Watermark
  const wmDrop = document.getElementById('wmDropZone');
  const wmInput = document.getElementById('wmFileInput');
  setupDropZone(wmDrop, wmInput, (f) => { selectedWmFile = f; wmDrop.innerHTML = `<p class="text-sm">已选择: ${f.name}</p>`; });
  document.getElementById('wmBtn').addEventListener('click', startWatermark);

  // Audit
  const auditDrop = document.getElementById('auditDropZone');
  const auditInput = document.getElementById('auditFileInput');
  setupDropZone(auditDrop, auditInput, (f) => { selectedAuditFile = f; auditDrop.innerHTML = `<p class="text-sm">已选择: ${f.name}</p>`; });
  document.getElementById('auditBtn').addEventListener('click', startAudit);

  // Summary
  const sumDrop = document.getElementById('summaryDropZone');
  const sumInput = document.getElementById('summaryFileInput');
  setupDropZone(sumDrop, sumInput, (f) => { selectedSummaryFile = f; sumDrop.innerHTML = `<p class="text-sm">已选择: ${f.name}</p>`; });
  document.getElementById('summaryBtn').addEventListener('click', startSummary);

  renderHistory();

  return () => { stopStream(); };
}

// ============ File selections ============
let selectedAssFile = null;
let selectedTransFile = null;
let selectedWmFile = null;
let selectedAuditFile = null;
let selectedSummaryFile = null;

// ============ SSE ============
let currentEventSource = null;
let _streamReject = null;

function stopStream() {
  if (currentEventSource) { currentEventSource.close(); currentEventSource = null; }
  if (_streamReject) { _streamReject(new Error('已取消')); _streamReject = null; }
}

// ============ Drop zone helper ============
function setupDropZone(dropZone, fileInput, onFile) {
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) onFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) onFile(fileInput.files[0]);
    fileInput.value = '';
  });
}

// ============ Mode 1: Generate from A/V ============
async function startAssGenerate() {
  if (!selectedAssFile) { toast('请先选择文件', 'error'); return; }
  const btn = document.getElementById('assGenerateBtn');
  const status = document.getElementById('assStatus');
  const progressBar = document.getElementById('assProgressBar');
  btn.disabled = true; status.textContent = '上传中...'; progressBar.classList.remove('hidden');
  document.getElementById('assResultCard').classList.add('hidden');

  let fileId;
  try {
    const result = await API.transcribeAsync(selectedAssFile, {
      language: document.getElementById('assLang').value,
      context: document.getElementById('assContext').value,
      source: 'ass',
    });
    fileId = result.file_id;
    const cleanName = (selectedAssFile.name || 'subtitle').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
    sessionStorage.setItem('ass_in_progress', JSON.stringify({ fileId, cleanName }));

    const data = await streamUntilDone(fileId, status, progressBar);
    if (!data) return;

    const segments = data.segments || [];
    if (segments.length === 0 && data.full_text) {
      segments.push({ start: 0, end: data.duration_sec || 0, text: data.full_text });
    }
    const assContent = generateAssContent(segments);
    sessionStorage.removeItem('ass_in_progress');
    sessionStorage.setItem('ass_state', JSON.stringify({ assContent, cleanName, fileId }));
    document.getElementById('assPreview').textContent = assContent;
    document.getElementById('assResultCard').classList.remove('hidden');
    downloadText(assContent, cleanName + '.ass');
    toast('ASS 字幕已生成', 'success');
    status.textContent = '完成！文件已下载';
    addHistory(cleanName + '.ass', '生成');
    autoSaveAss(assContent, cleanName);
  } catch (e) {
    if (e.message === '已取消') return;
    status.textContent = '生成失败: ' + e.message; status.style.color = 'var(--error)';
    toast('生成失败: ' + e.message, 'error');
    if (fileId) sessionStorage.removeItem('ass_in_progress');
  } finally { btn.disabled = false; progressBar.classList.add('hidden'); stopStream(); }
}

function streamUntilDone(fileId, statusEl, progressBar) {
  return new Promise((resolve, reject) => {
    _streamReject = reject;
    currentEventSource = API.createTranscribeEventSource(fileId,
      (data) => {
        if (data.status === 'queued') statusEl.textContent = `排队中 · ${data.chunks_done || 0} 块`;
        else if (data.status === 'transcribing' || data.status === 'merging')
          statusEl.textContent = `转写中 · 第 ${data.chunks_done || 0} 块 · ${formatDuration(data.total_duration || 0)}`;
        if (data.status === 'completed') { _streamReject = null; currentEventSource.close(); currentEventSource = null; resolve(data); }
        if (data.status === 'error') { _streamReject = null; currentEventSource.close(); currentEventSource = null; reject(new Error('转写出错')); }
        if (data.status === 'not_found') { _streamReject = null; currentEventSource.close(); currentEventSource = null; reject(new Error('任务不存在')); }
      },
      () => { _streamReject = null; currentEventSource = null; }
    );
  });
}

async function resumeTranscription(fileId, statusEl, progressBar, cleanName) {
  try {
    const data = await API.transcribeStatus(fileId);
    if (!data || data.status === 'not_found') {
      sessionStorage.removeItem('ass_in_progress');
      statusEl.textContent = '任务已过期，请重新上传'; progressBar.classList.add('hidden'); return;
    }
    if (data.status === 'completed') { sessionStorage.removeItem('ass_in_progress'); progressBar.classList.add('hidden'); finishAssGeneration(data, cleanName); return; }
    if (data.status === 'error') { sessionStorage.removeItem('ass_in_progress'); statusEl.textContent = '转写出错'; statusEl.style.color = 'var(--error)'; progressBar.classList.add('hidden'); return; }
    statusEl.textContent = `恢复中 · 第 ${data.chunks_done || 0} 块`;
    const result = await streamUntilDone(fileId, statusEl, progressBar);
    if (result) { sessionStorage.removeItem('ass_in_progress'); progressBar.classList.add('hidden'); finishAssGeneration(result, cleanName); }
  } catch (e) { if (e.message === '已取消') return; statusEl.textContent = '恢复失败'; progressBar.classList.add('hidden'); sessionStorage.removeItem('ass_in_progress'); }
}

async function finishAssGeneration(data, cleanName) {
  const segments = data.segments || [];
  if (segments.length === 0 && data.full_text) segments.push({ start: 0, end: data.duration_sec || 0, text: data.full_text });
  const assContent = generateAssContent(segments);
  if (!cleanName) { const p = JSON.parse(sessionStorage.getItem('ass_in_progress') || '{}'); cleanName = p.cleanName || 'subtitle'; }
  sessionStorage.removeItem('ass_in_progress');
  sessionStorage.setItem('ass_state', JSON.stringify({ assContent, cleanName, fileId: data.file_id }));
  document.getElementById('assPreview').textContent = assContent;
  document.getElementById('assResultCard').classList.remove('hidden');
  downloadText(assContent, cleanName + '.ass');
  toast('ASS 字幕已生成', 'success');
  document.getElementById('assStatus').textContent = '完成！文件已下载';
  addHistory(cleanName + '.ass', '生成');
  autoSaveAss(assContent, cleanName);
}

// ============ Mode 2: Translate ASS ============
async function startAssTranslate() {
  if (!selectedTransFile) { toast('请先选择 ASS 文件', 'error'); return; }
  const llmConfig = JSON.parse(localStorage.getItem('asr_llm_config') || '{}');
  if (!llmConfig.api_key) { toast('请先在配置页面设置 LLM API Key', 'error'); return; }

  const btn = document.getElementById('assTransBtn');
  const status = document.getElementById('assTransStatus');
  const progressBar = document.getElementById('assTransProgress');
  btn.disabled = true; status.textContent = '翻译中...'; progressBar.classList.remove('hidden');

  try {
    const result = await API.assTranslate(selectedTransFile, {
      api_key: llmConfig.api_key || '',
      api_url: llmConfig.api_url || 'https://api.deepseek.com',
      model_name: llmConfig.model_name || 'deepseek-chat',
      system_prompt: llmConfig.system_prompt || '',
      temperature: llmConfig.temperature ?? 0.3,
      batch_size: parseInt(document.getElementById('assTransBatchSize').value) || 200,
      target_language: document.getElementById('assTransTargetLang').value,
    });

    const cleanName = (selectedTransFile.name || 'subtitle').replace(/\.[^.]+$/, '') + '_bilingual';
    document.getElementById('assPreview').textContent = result;
    document.getElementById('assResultCard').classList.remove('hidden');
    downloadText(result, cleanName + '.ass');
    toast('翻译完成！双语 ASS 已下载', 'success');
    status.textContent = '完成！文件已下载';
    addHistory(cleanName + '.ass', '翻译');
    autoSaveAss(result, cleanName);
  } catch (e) {
    status.textContent = '翻译失败: ' + e.message; status.style.color = 'var(--error)';
    toast('翻译失败: ' + e.message, 'error');
  } finally { btn.disabled = false; progressBar.classList.add('hidden'); }
}

// ============ Toolbox: Watermark ============
async function startWatermark() {
  if (!selectedWmFile) { toast('请先选择 ASS 文件', 'error'); return; }
  const text = document.getElementById('wmText').value.trim();
  if (!text) { toast('请输入水印文本', 'error'); return; }

  const btn = document.getElementById('wmBtn');
  btn.disabled = true; btn.textContent = '生成中...';
  try {
    const fd = new FormData();
    fd.append('file', selectedWmFile);
    fd.append('text', text);
    const r = await fetch('/ass_watermark', { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await r.text());
    const content = await r.text();
    const cleanName = (selectedWmFile.name || 'subtitle').replace(/\.[^.]+$/, '') + '_watermarked';
    downloadText(content, cleanName + '.ass');
    toast('水印已添加', 'success');
    addHistory(cleanName + '.ass', '水印');
  } catch (e) { toast('水印生成失败: ' + e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '添加水印并下载'; }
}

// ============ Toolbox: Audit ============
async function startAudit() {
  if (!selectedAuditFile) { toast('请先选择 ASS 文件', 'error'); return; }
  const btn = document.getElementById('auditBtn');
  const resultDiv = document.getElementById('auditResult');
  btn.disabled = true; btn.textContent = '审轴中...';
  try {
    const fd = new FormData();
    fd.append('file', selectedAuditFile);
    const r = await fetch('/ass_audit', { method: 'POST', body: fd });
    const data = await r.json();

    if (data.total === 0) {
      resultDiv.innerHTML = '<div class="text-sm text-success">未发现问题</div>';
    } else {
      const items = data.issues.map(i => {
        const typeLabel = i.type === 'flash' ? '闪轴' : '叠轴';
        const color = i.type === 'flash' ? 'var(--info)' : 'var(--error)';
        return `<div class="text-sm" style="padding:2px 0;color:${color}">第 ${i.line} 行与第 ${i.next_line} 行 · ${typeLabel} · ${i.gap_ms} ms</div>`;
      }).join('');
      resultDiv.innerHTML = `<div class="text-sm text-error">发现 ${data.total} 个问题</div>${items}`;
    }
    addHistory(selectedAuditFile.name, '轴审');
  } catch (e) { toast('审轴失败: ' + e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '开始审轴'; }
}

// ============ Toolbox: Summary ============
async function startSummary() {
  if (!selectedSummaryFile) { toast('请先选择 ASS 文件', 'error'); return; }
  const llmConfig = JSON.parse(localStorage.getItem('asr_llm_config') || '{}');
  if (!llmConfig.api_key) { toast('请先在配置页面设置 LLM API Key', 'error'); return; }

  const btn = document.getElementById('summaryBtn');
  const resultDiv = document.getElementById('summaryResult');
  btn.disabled = true; btn.textContent = '总结中...';
  try {
    const fd = new FormData();
    fd.append('file', selectedSummaryFile);
    fd.append('time_window', document.getElementById('summaryWindow').value);
    fd.append('api_key', llmConfig.api_key || '');
    fd.append('api_url', llmConfig.api_url || 'https://api.deepseek.com');
    fd.append('model_name', llmConfig.model_name || 'deepseek-chat');
    fd.append('temperature', String(llmConfig.temperature ?? 0.3));

    const r = await fetch('/ass_summary', { method: 'POST', body: fd });
    const data = await r.json();

    const cards = data.segments.map(s => {
      const summary = s.summary || {};
      const start = fmtAssTime(assTimeToSeconds(s.start_time));
      const end = fmtAssTime(assTimeToSeconds(s.end_time));
      return `<div class="card" style="border:1px solid var(--border);margin-top:8px">
        <div class="text-sm text-accent">${start} — ${end}</div>
        ${summary.topic ? `<div class="text-sm mt-4"><strong>主题:</strong> ${summary.topic}</div>` : ''}
        ${summary.flow ? `<div class="text-sm mt-4"><strong>流程:</strong> ${summary.flow}</div>` : ''}
        ${summary.tone ? `<div class="text-sm mt-4"><strong>基调:</strong> ${summary.tone}</div>` : ''}
        ${summary.key_points && summary.key_points.length ? `<div class="text-sm mt-4"><strong>要点:</strong><ul style="margin:4px 0 0 16px">${summary.key_points.map(p => `<li>${p}</li>`).join('')}</ul></div>` : ''}
      </div>`;
    }).join('');
    resultDiv.innerHTML = `<div class="text-sm text-dim mt-8">共 ${data.total_windows || 0} 个时间段</div>${cards}`;
  } catch (e) { toast('总结失败: ' + e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '开始总结'; }
}

// ============ ASS generation (frontend preview) ============
function generateAssContent(segments) {
  let ass = `[Script Info]
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
`;
  let lastEnd = 0;
  for (const s of segments) {
    let start = s.start, end = s.end;
    if (start < lastEnd) start = lastEnd;
    if (end <= start) end = start + 0.01;
    lastEnd = end;
    const text = (s.text || '').replace(/\n/g, '\\N');
    ass += `Dialogue: 0,${fmtAssTime(start)},${fmtAssTime(end)},原文,,0,0,0,,${text}\n`;
  }
  return ass;
}

// ============ Time utilities ============
function fmtAssTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

function assTimeToSeconds(assTime) {
  const parts = assTime.split(':');
  const secs = parts[2].split('.');
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 +
    parseInt(secs[0]) + (parseInt(secs[1] || '0') / 100);
}

function parseAssDialogue(line) {
  if (!line.startsWith('Dialogue:')) return null;
  const match = line.match(/Dialogue:\s*([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),(.*)/);
  if (!match) return null;
  const p = match.slice(1);
  return { Layer: p[0], Start: p[1], End: p[2], Style: p[3], Name: p[4],
           MarginL: p[5], MarginR: p[6], MarginV: p[7], Effect: p[8], Text: p[9] };
}

// ============ Helpers ============
async function autoSaveAss(content, cleanName) {
  try { const dir = await API.getOutputDir(); if (!dir.exists) return; await API.saveText(cleanName + '.ass', content); } catch {}
}

async function saveAssToDir() {
  const state = JSON.parse(sessionStorage.getItem('ass_state') || '{}');
  if (!state.assContent || !state.cleanName) { toast('没有可保存的字幕', 'error'); return; }
  try { const r = await API.saveText(state.cleanName + '.ass', state.assContent); toast('已保存到: ' + r.path, 'success'); }
  catch (e) { toast('保存失败: ' + e.message, 'error'); }
}

function addHistory(filename, type) {
  const history = JSON.parse(localStorage.getItem('ass_history') || '[]');
  history.unshift({ filename, date: new Date().toISOString(), type: type || '生成' });
  if (history.length > 10) history.length = 10;
  localStorage.setItem('ass_history', JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const container = document.getElementById('assHistory');
  const history = JSON.parse(localStorage.getItem('ass_history') || '[]');
  if (history.length === 0) { container.innerHTML = '<div class="text-sm text-dim">暂无下载记录</div>'; return; }
  container.innerHTML = history.map(h =>
    `<div class="text-sm" style="padding:4px 0;display:flex;justify-content:space-between">
      <span>${h.type ? `<span class="badge" style="background:var(--accent);color:#000;padding:0 4px;border-radius:3px;font-size:0.75em;margin-right:6px">${h.type}</span>` : ''}${h.filename}</span>
      <span class="text-dim">${new Date(h.date).toLocaleString('zh-CN')}</span>
    </div>`
  ).join('');
}
