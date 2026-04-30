// ASS Subtitle page — async upload + SSE streaming + auto-restore
import { toast, downloadText, formatFileSize, formatDuration } from '../ui.js';
import { API } from '../api.js';

export function render() {
  return `
    <div class="card">
      <h2>生成 ASS 字幕</h2>
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
      <div id="assStatus" class="mt-8 text-sm text-dim">${sessionStorage.getItem('ass_in_progress') ? '检测到未完成的任务，正在恢复...' : ''}</div>
      <div id="assProgressBar" class="progress-bar mt-8 ${sessionStorage.getItem('ass_in_progress') ? '' : 'hidden'}"><div class="progress-fill indeterminate" style="width:30%"></div></div>
    </div>

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
  const dropZone = document.getElementById('assDropZone');
  const fileInput = document.getElementById('assFileInput');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleAssFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleAssFile(fileInput.files[0]);
    fileInput.value = '';
  });

  document.getElementById('assGenerateBtn').addEventListener('click', startAssGenerate);
  document.getElementById('assDownloadBtn')?.addEventListener('click', () => {
    const state = JSON.parse(sessionStorage.getItem('ass_state') || '{}');
    if (state.assContent && state.cleanName) {
      downloadText(state.assContent, state.cleanName + '.ass');
    }
  });
  document.getElementById('assSaveToDirBtn')?.addEventListener('click', saveAssToDir);

  // Restore completed result from sessionStorage
  const savedState = JSON.parse(sessionStorage.getItem('ass_state') || 'null');
  if (savedState?.assContent) {
    document.getElementById('assPreview').textContent = savedState.assContent;
    document.getElementById('assResultCard').classList.remove('hidden');
  }

  // Restore in-progress transcription
  const inProgress = JSON.parse(sessionStorage.getItem('ass_in_progress') || 'null');
  if (inProgress) {
    const statusEl = document.getElementById('assStatus');
    const progressBar = document.getElementById('assProgressBar');
    statusEl.textContent = '正在恢复转写状态...';
    progressBar.classList.remove('hidden');
    resumeTranscription(inProgress.fileId, statusEl, progressBar, inProgress.cleanName);
  }

  renderHistory();

  // Cleanup on page leave — save in-progress state
  return () => {
    stopStream();
  };
}

let selectedAssFile = null;
let currentEventSource = null;
let _streamReject = null;

function handleAssFile(file) {
  selectedAssFile = file;
  document.getElementById('assDropZone').innerHTML = `<p>已选择: ${file.name} (${formatFileSize(file.size)})</p>`;
}

function stopStream() {
  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }
  if (_streamReject) {
    _streamReject(new Error('已取消'));
    _streamReject = null;
  }
}

async function startAssGenerate() {
  if (!selectedAssFile) {
    toast('请先选择文件', 'error');
    return;
  }

  const btn = document.getElementById('assGenerateBtn');
  const status = document.getElementById('assStatus');
  const progressBar = document.getElementById('assProgressBar');

  btn.disabled = true;
  status.textContent = '上传中...';
  status.className = 'mt-8 text-sm';
  progressBar.classList.remove('hidden');
  progressBar.querySelector('.progress-fill').className = 'progress-fill indeterminate';
  document.getElementById('assResultCard').classList.add('hidden');

  let fileId;
  try {
    // Step 1: Async upload
    const result = await API.transcribeAsync(selectedAssFile, {
      language: document.getElementById('assLang').value,
      context: document.getElementById('assContext').value,
      source: 'ass',
    });

    fileId = result.file_id;
    const cleanName = (selectedAssFile.name || 'subtitle').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');

    // Save in-progress state for page-switch recovery
    sessionStorage.setItem('ass_in_progress', JSON.stringify({ fileId, cleanName }));

    // Step 2: SSE streaming wait for completion
    const data = await streamUntilDone(fileId, status, progressBar);
    if (!data) return;

    status.textContent = '转写完成，生成字幕...';

    // Step 3: Generate ASS from segments
    const segments = data.segments || [];
    if (segments.length === 0 && data.full_text) {
      segments.push({ start: 0, end: data.duration_sec || 0, text: data.full_text });
    }

    const assContent = generateAssContent(segments);

    // Clear in-progress, save final state
    sessionStorage.removeItem('ass_in_progress');
    sessionStorage.setItem('ass_state', JSON.stringify({ assContent, cleanName, fileId }));
    document.getElementById('assPreview').textContent = assContent;
    document.getElementById('assResultCard').classList.remove('hidden');

    // Auto-download
    downloadText(assContent, cleanName + '.ass');
    toast('ASS 字幕已生成', 'success');
    status.textContent = '完成！文件已下载';

    // Save to history
    const history = JSON.parse(localStorage.getItem('ass_history') || '[]');
    history.unshift({ filename: cleanName + '.ass', date: new Date().toISOString() });
    if (history.length > 10) history.length = 10;
    localStorage.setItem('ass_history', JSON.stringify(history));
    renderHistory();

    // Auto-save to output dir
    autoSaveAss(assContent, cleanName);

  } catch (e) {
    if (e.message === '已取消') {
      // User navigated away — keep ass_in_progress for recovery on return
      return;
    }
    status.textContent = '生成失败: ' + e.message;
    status.style.color = 'var(--error)';
    toast('生成失败: ' + e.message, 'error');
    if (fileId) sessionStorage.removeItem('ass_in_progress');
  } finally {
    btn.disabled = false;
    progressBar.classList.add('hidden');
    stopStream();
  }
}

function streamUntilDone(fileId, statusEl, progressBar) {
  return new Promise((resolve, reject) => {
    _streamReject = reject;
    currentEventSource = API.createTranscribeEventSource(fileId,
      (data) => {
        if (data.status === 'queued') {
          statusEl.textContent = `排队中 · ${data.chunks_done || 0} 块`;
        } else if (data.status === 'transcribing' || data.status === 'merging') {
          statusEl.textContent = `转写中 · 第 ${data.chunks_done || 0} 块 · ${formatDuration(data.total_duration || 0)}`;
        }

        if (data.status === 'completed') {
          _streamReject = null;
          currentEventSource.close();
          currentEventSource = null;
          resolve(data);
        }

        if (data.status === 'error') {
          _streamReject = null;
          currentEventSource.close();
          currentEventSource = null;
          reject(new Error('转写出错'));
        }

        if (data.status === 'not_found') {
          _streamReject = null;
          currentEventSource.close();
          currentEventSource = null;
          reject(new Error('任务不存在'));
        }
      },
      () => {
        // Stream ended without completion (e.g. [DONE] sentinel)
        _streamReject = null;
        currentEventSource = null;
      }
    );
  });
}

async function resumeTranscription(fileId, statusEl, progressBar, cleanName) {
  try {
    // Check current status
    const data = await API.transcribeStatus(fileId);
    if (!data || data.status === 'not_found') {
      sessionStorage.removeItem('ass_in_progress');
      statusEl.textContent = '任务已过期，请重新上传';
      progressBar.classList.add('hidden');
      return;
    }

    if (data.status === 'completed') {
      sessionStorage.removeItem('ass_in_progress');
      progressBar.classList.add('hidden');
      finishAssGeneration(data, cleanName);
      return;
    }

    if (data.status === 'error') {
      sessionStorage.removeItem('ass_in_progress');
      statusEl.textContent = '转写出错，请重新上传';
      status.style.color = 'var(--error)';
      progressBar.classList.add('hidden');
      return;
    }

    // Still in progress — resume SSE stream
    statusEl.textContent = `恢复中 · 第 ${data.chunks_done || 0} 块 · ${formatDuration(data.total_duration || 0)}`;

    const result = await streamUntilDone(fileId, statusEl, progressBar);
    if (result) {
      sessionStorage.removeItem('ass_in_progress');
      progressBar.classList.add('hidden');
      finishAssGeneration(result, cleanName);
    }
  } catch (e) {
    if (e.message === '已取消') return;
    statusEl.textContent = '恢复失败: ' + e.message;
    progressBar.classList.add('hidden');
    sessionStorage.removeItem('ass_in_progress');
  }
}

async function finishAssGeneration(data, cleanName) {
  const segments = data.segments || [];
  if (segments.length === 0 && data.full_text) {
    segments.push({ start: 0, end: data.duration_sec || 0, text: data.full_text });
  }

  const assContent = generateAssContent(segments);
  if (!cleanName) {
    const inProgress = JSON.parse(sessionStorage.getItem('ass_in_progress') || '{}');
    cleanName = inProgress.cleanName || 'subtitle';
  }

  sessionStorage.removeItem('ass_in_progress');
  sessionStorage.setItem('ass_state', JSON.stringify({ assContent, cleanName, fileId: data.file_id }));
  document.getElementById('assPreview').textContent = assContent;
  document.getElementById('assResultCard').classList.remove('hidden');

  downloadText(assContent, cleanName + '.ass');
  toast('ASS 字幕已生成', 'success');
  document.getElementById('assStatus').textContent = '完成！文件已下载';

  const history = JSON.parse(localStorage.getItem('ass_history') || '[]');
  history.unshift({ filename: cleanName + '.ass', date: new Date().toISOString() });
  if (history.length > 10) history.length = 10;
  localStorage.setItem('ass_history', JSON.stringify(history));
  renderHistory();

  autoSaveAss(assContent, cleanName);
}

function generateAssContent(segments) {
  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: 原文,苹方 中等,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  for (const s of segments) {
    const start = fmtAssTime(s.start);
    const end = fmtAssTime(s.end);
    const text = (s.text || '').replace(/\n/g, '\\N');
    ass += `Dialogue: 0,${start},${end},原文,,0,0,0,,${text}\n`;
  }
  return ass;
}

function fmtAssTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2,'0')}:${s.toFixed(2).padStart(5,'0')}`;
}

async function autoSaveAss(content, cleanName) {
  try {
    const dir = await API.getOutputDir();
    if (!dir.exists) return;
    await API.saveText(cleanName + '.ass', content);
  } catch {
    // Silent
  }
}

async function saveAssToDir() {
  const state = JSON.parse(sessionStorage.getItem('ass_state') || '{}');
  if (!state.assContent || !state.cleanName) {
    toast('没有可保存的字幕', 'error');
    return;
  }
  try {
    const r = await API.saveText(state.cleanName + '.ass', state.assContent);
    toast('已保存到: ' + r.path, 'success');
  } catch (e) {
    toast('保存失败: ' + e.message, 'error');
  }
}

function renderHistory() {
  const container = document.getElementById('assHistory');
  const history = JSON.parse(localStorage.getItem('ass_history') || '[]');
  if (history.length === 0) {
    container.innerHTML = '<div class="text-sm text-dim">暂无下载记录</div>';
    return;
  }
  container.innerHTML = history.map(h =>
    `<div class="text-sm" style="padding:4px 0;display:flex;justify-content:space-between">
      <span>${h.filename}</span>
      <span class="text-dim">${new Date(h.date).toLocaleString('zh-CN')}</span>
    </div>`
  ).join('');
}
