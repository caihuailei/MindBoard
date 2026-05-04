// Upload page — queue management + live transcription display
import { API } from '../api.js';
import { toast, statusBadge, formatDuration, copyToClipboard, downloadText } from '../ui.js';
import { navigate } from '../router.js';

let streamControllers = {};  // fileId -> EventSource
let activeFileId = null;
let currentPollingId = null;
let savedFileIds = new Set(JSON.parse(localStorage.getItem('asr_saved_ids') || '[]'));
let liveWords = [];  // accumulate words across SSE events (server only sends new words)
let uploadedFiles = [];  // track uploaded file metadata {rowId, fileId, filename, fileSize}

export function render() {
  return `
    <div class="card">
      <h2>音视频转写</h2>
      <div class="drop-zone" id="dropZone">
        <p>拖放音视频文件到此处，或点击选择</p>
        <p class="text-dim text-sm mt-8">支持 MP4, AVI, MKV, MOV, WAV, MP3, M4A 等格式</p>
      </div>
      <input type="file" id="fileInput" multiple accept="audio/*,video/*" hidden>
    </div>

    <div id="queueContainer"></div>

    <div id="liveContainer">
      <div class="card">
        <h2>实时转写 <span id="liveStatus" class="text-dim text-sm"></span></h2>
        <div class="transcript-body" id="transcriptBody"><span class="text-dim">等待上传文件后开始转写...</span></div>
        <div class="btn-group" id="liveActions" hidden>
          <button class="btn btn-primary btn-sm" id="copyLiveBtn">复制全文</button>
          <button class="btn btn-secondary btn-sm" id="downloadLiveBtn">下载 TXT</button>
          <button class="btn btn-secondary btn-sm" id="refineLiveBtn">发送到润色</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>输出目录</h3>
      <div class="flex gap-8 items-center">
        <input type="text" class="form-input flex-1" id="outputDirInput" placeholder="输出目录路径...">
        <button class="btn btn-primary btn-sm" id="setOutputDirBtn">设置</button>
      </div>
      <div id="outputDirStatus" class="text-sm text-dim mt-8"></div>
    </div>

    <div class="card">
      <h3>默认参数 <span class="text-dim text-sm" style="font-weight:400">（每个文件可单独覆盖）</span></h3>
      <div class="flex gap-8 items-center" style="flex-wrap:wrap">
        <div class="form-group" style="flex:1;min-width:140px;margin-bottom:0">
          <label>语言</label>
          <select class="form-input" id="defaultLang">
            <option value="Chinese">中文</option>
            <option value="English">英文</option>
            <option value="Japanese">日文</option>
            <option value="Korean">韩文</option>
            <option value="auto">自动检测</option>
          </select>
        </div>
        <div class="form-group" style="flex:1;min-width:100px;margin-bottom:0">
          <label>最大字符</label>
          <input type="number" class="form-input" id="defaultMaxChars" value="50" min="10" max="200">
        </div>
        <div class="form-group" style="flex:1;min-width:100px;margin-bottom:0">
          <label>停顿阈值(秒)</label>
          <input type="number" class="form-input" id="defaultPause" value="0.3" min="0" max="5" step="0.1">
        </div>
      </div>
    </div>
  `;
}

export function init() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFiles(fileInput.files);
    fileInput.value = '';
  });

  document.getElementById('setOutputDirBtn').addEventListener('click', setOutputDir);
  loadOutputDir();

  // Load saved preferences
  const prefs = JSON.parse(localStorage.getItem('asr_prefs') || '{}');
  if (prefs.language) document.getElementById('defaultLang').value = prefs.language;
  if (prefs.maxChars) document.getElementById('defaultMaxChars').value = prefs.maxChars;
  if (prefs.pauseThreshold) document.getElementById('defaultPause').value = prefs.pauseThreshold;

  // Restore active tasks on re-entry
  restoreActiveTasks();

  // Recover any server-persisted results not yet in localStorage
  recoverServerResults();

  // Live action buttons
  document.getElementById('copyLiveBtn')?.addEventListener('click', () => {
    const text = document.getElementById('transcriptBody')?.textContent || '';
    if (text) copyToClipboard(text);
  });
  document.getElementById('downloadLiveBtn')?.addEventListener('click', () => {
    const text = document.getElementById('transcriptBody')?.textContent || '';
    if (text) downloadText(text, `transcript_${Date.now()}.txt`);
  });
  document.getElementById('refineLiveBtn')?.addEventListener('click', () => {
    const text = document.getElementById('transcriptBody')?.textContent || '';
    if (text) {
      sessionStorage.setItem('refine_input', text);
      navigate('/refine');
    }
  });

  // Save prefs on change
  ['defaultLang', 'defaultMaxChars', 'defaultPause'].forEach(id => {
    document.getElementById(id).addEventListener('change', savePrefs);
  });

  return () => {
    // Save state before leaving
    saveUploadState();
    // Cleanup EventSource connections
    Object.values(streamControllers).forEach(c => c.close());
    streamControllers = {};
    liveWords = [];
  };
}

function savePrefs() {
  localStorage.setItem('asr_prefs', JSON.stringify({
    language: document.getElementById('defaultLang').value,
    maxChars: parseInt(document.getElementById('defaultMaxChars').value) || 50,
    pauseThreshold: parseFloat(document.getElementById('defaultPause').value) || 0.3,
  }));
}

function saveUploadState() {
  sessionStorage.setItem('upload_files', JSON.stringify(uploadedFiles));
}

function loadUploadState() {
  try {
    return JSON.parse(sessionStorage.getItem('upload_files') || '[]');
  } catch { return []; }
}

async function loadOutputDir() {
  try {
    const d = await API.getOutputDir();
    document.getElementById('outputDirInput').value = d.path || '';
    document.getElementById('outputDirStatus').textContent = d.exists ? '目录可用' : '目录不存在';
  } catch {}
}

async function setOutputDir() {
  const path = document.getElementById('outputDirInput').value.trim();
  if (!path) { toast('请输入路径', 'error'); return; }
  try {
    await API.setOutputDir(path);
    toast('输出目录已设置', 'success');
    document.getElementById('outputDirStatus').textContent = '已设置';
  } catch (e) {
    toast('设置失败: ' + e.message, 'error');
  }
}

let queueCount = 0;

async function handleFiles(files) {
  const container = document.getElementById('queueContainer');
  const lang = document.getElementById('defaultLang').value;
  const maxChars = parseInt(document.getElementById('defaultMaxChars').value) || 50;
  const pause = parseFloat(document.getElementById('defaultPause').value) || 0.3;

  for (const file of files) {
    queueCount++;
    const id = `q_${Date.now()}_${queueCount}`;
    const row = document.createElement('div');
    row.className = 'queue-item';
    row.id = id;
    row.innerHTML = `
      <div class="info">
        <div class="name">${file.name}</div>
        <div class="meta">${(file.size/1024/1024).toFixed(1)} MB</div>
        <div class="progress-bar hidden" id="${id}_progress"><div class="progress-fill" style="width:0%"></div></div>
      </div>
      <div class="status" id="${id}_status">${statusBadge('queued')}</div>
      <button class="btn btn-danger btn-sm remove-btn" data-id="${id}">✕</button>
    `;
    container.appendChild(row);

    // Remove button
    row.querySelector('.remove-btn').addEventListener('click', () => {
      row.remove();
      uploadedFiles = uploadedFiles.filter(f => f.rowId !== id);
      saveUploadState();
    });

    // Upload
    try {
      row.querySelector('.meta').textContent += ' · 上传中...';
      row.querySelector(`#${id}_status`).innerHTML = statusBadge('uploading');

      const result = await API.transcribeAsync(file, {
        language: lang,
        maxChars,
        pauseThreshold: pause,
        source: 'upload',
      });

      row.querySelector('.meta').textContent += ' · 排队中';
      row.querySelector(`#${id}_status`).innerHTML = statusBadge('queued');
      row.dataset.fileId = result.file_id;

      // Track for state persistence
      uploadedFiles.push({ rowId: id, fileId: result.file_id, filename: file.name, fileSize: file.size });
      saveUploadState();

      // Start polling status
      startPolling(result.file_id, row);

      // Show live transcript for this file
      activeFileId = result.file_id;

    } catch (e) {
      row.querySelector(`#${id}_status`).innerHTML = statusBadge('error');
      row.querySelector('.meta').textContent += ' · ' + e.message;
      toast(file.name + ' 上传失败: ' + e.message, 'error');
    }
  }
}

function startPolling(fileId, row) {
  const progressBar = document.getElementById(row.id + '_progress');
  const statusEl = document.getElementById(row.id + '_status');
  const metaEl = row.querySelector('.meta');

  // Close any existing EventSource for this fileId
  if (streamControllers[fileId]) {
    streamControllers[fileId].close();
  }

  // Reset word accumulator for this fileId
  liveWords = [];

  const es = streamControllers[fileId] = API.createTranscribeEventSource(fileId,
    // onData — each SSE event
    (data) => {
      statusEl.innerHTML = statusBadge(data.status);

      const liveContainer = document.getElementById('liveContainer');
      const liveStatus = document.getElementById('liveStatus');

      if (data.status === 'queued') {
        liveStatus.textContent = '排队中 ( - ω - )';
      } else if (data.status === 'transcribing' || data.status === 'merging') {
        progressBar.classList.remove('hidden');
        progressBar.querySelector('.progress-fill').style.width = '';
        progressBar.querySelector('.progress-fill').classList.add('indeterminate');
        metaEl.textContent = `第 ${data.chunks_done} 块 · ${formatDuration(data.total_duration)}`;
      }

      if (data.status === 'completed') {
        delete streamControllers[fileId];
        es.close();
        progressBar.querySelector('.progress-fill').classList.remove('indeterminate');
        progressBar.classList.add('hidden');
        progressBar.querySelector('.progress-fill').style.width = '100%';
        metaEl.textContent = `${formatDuration(data.duration_sec)} · ${(data.full_text || '').length} 字`;

        saveResult(data, row);
        autoSaveToDir(data);

        if (data.full_text) showLiveTranscript(data);
        toast('转写完成: ' + (row.querySelector('.name')?.textContent || fileId), 'success');

        // Save completed transcription text for page-switch persistence
        sessionStorage.setItem('upload_last_transcript', JSON.stringify({
          fileId,
          filename: row.querySelector('.name')?.textContent || fileId,
          text: data.full_text,
          segments: data.segments,
          duration_sec: data.duration_sec,
        }));
      }

      if (data.status === 'error') {
        delete streamControllers[fileId];
        es.close();
        metaEl.textContent = '转写出错';
        toast('转写出错: ' + fileId, 'error');
      }

      if (data.status === 'not_found') {
        delete streamControllers[fileId];
        es.close();
        metaEl.textContent = '任务不存在';
        toast('任务不存在: ' + fileId, 'error');
      }

      // Accumulate words — server sends ALL words seen so far, not just new ones
      // So we replace, not append
      if (data.status === 'transcribing' && data.words && data.words.length > 0) {
        liveWords = data.words.slice();
        renderLiveWords(liveWords, data);
      }
    },
    // onDone — stream ended, check current status if not yet completed
    () => {
      delete streamControllers[fileId];
    }
  );
}

function saveResult(data, row) {
  // Don't save if already tracked (prevents duplicates across page nav)
  if (savedFileIds.has(data.file_id)) return;
  const results = JSON.parse(localStorage.getItem('asr_results') || '[]');
  const name = row?.querySelector('.name')?.textContent || data.filename || data.file_id;
  results.unshift({
    id: data.file_id,
    filename: name,
    date: new Date().toISOString(),
    duration_sec: data.duration_sec || 0,
    language: data.language || '',
    text: data.full_text || '',
    segments: data.segments || [],
    words: data.words || [],
  });
  // Keep max 20 results
  if (results.length > 20) results.length = 20;
  localStorage.setItem('asr_results', JSON.stringify(results));

  // Track saved IDs to avoid duplicates
  savedFileIds.add(data.file_id);
  localStorage.setItem('asr_saved_ids', JSON.stringify([...savedFileIds]));
}

async function autoSaveToDir(data) {
  try {
    const dir = await API.getOutputDir();
    if (dir.exists) {
      // Strip original extension (e.g. "lecture.mp4" → "lecture")
      const raw = data.filename || data.file_id || 'transcription';
      const cleanName = raw.replace(/[\\/:*?"<>|]/g, '_');
      await API.saveResult(data.file_id, cleanName);
    }
  } catch {
    // Silent — output dir not configured or save failed
  }
}

// 回到页面时恢复活跃任务 + 保存未入库的已完成任务
async function restoreActiveTasks() {
  try {
    const list = await API.transcribeList();
    const active = list.active || {};
    for (const [fid, info] of Object.entries(active)) {
      // Skip ASS-generated tasks
      if (info.source === 'ass') continue;

      // 恢复进行中的任务
      if (info.status === 'transcribing' || info.status === 'queued' || info.status === 'merging') {
        const container = document.getElementById('queueContainer');
        const row = document.createElement('div');
        row.className = 'queue-item';
        row.id = `restore_${fid}`;
        row.innerHTML = `
          <div class="info">
            <div class="name text-mono">${fid}</div>
            <div class="meta">第 ${info.chunks_done || 0} 块 · ${formatDuration(info.total_duration || 0)}</div>
            <div class="progress-bar" id="${row.id}_progress"><div class="progress-fill indeterminate" style="width:30%"></div></div>
          </div>
          <div class="status">${statusBadge(info.status)}</div>
        `;
        container.appendChild(row);

        // Reset word accumulator for restored task
        liveWords = [];

        // 先拉一次当前状态，填充已有词
        try {
          const current = await API.transcribeStatus(fid);
          if (current?.status === 'transcribing' && current.words?.length > 0) {
            liveWords.push(...current.words);
            renderLiveWords(liveWords, current);
          }
        } catch {}

        // 再启动 EventSource 流式接收后续更新
        startPolling(fid, row);
      }

      // 保存已完成的但尚未入库的任务（用户离开页面期间完成的）
      if (info.status === 'completed' && !savedFileIds.has(fid)) {
        const data = await API.transcribeStatus(fid);
        if (data?.full_text) {
          // Add filename if missing
          if (!data.filename) data.filename = fid;
          saveResult(data, null);
          autoSaveToDir(data);
          toast('已恢复完成的任务: ' + (data.filename || fid), 'success');
        }
      }
    }
  } catch (e) {
    // Silent — server might be starting
  }
}

function showLiveTranscript(data) {
  document.getElementById('liveActions').hidden = false;

  const body = document.getElementById('transcriptBody');
  body.innerHTML = '';

  if (data.segments) {
    data.segments.forEach(seg => {
      const div = document.createElement('div');
      div.className = 'transcript-segment';
      div.innerHTML = `<div class="ts">[${formatDuration(seg.start)} - ${formatDuration(seg.end)}]</div><div class="txt">${escapeHtml(seg.text)}</div>`;
      body.appendChild(div);
    });
  } else if (data.full_text) {
    body.textContent = data.full_text;
  }
}

function renderLiveWords(words, data) {
  const body = document.getElementById('transcriptBody');

  // Show segments when merging
  if (data.status === 'merging' && data.words) {
    return;
  }

  // Render as flowing text instead of individual word spans
  body.innerHTML = '';
  const text = words.map(w => w.word).join('');
  body.textContent = text;
  body.scrollTop = body.scrollHeight;

  document.getElementById('liveStatus').textContent =
    `· ${data.chunks_done || 0} 块 · ${formatDuration(data.total_duration || 0)} · ${words.length} 词`;
}

async function recoverServerResults() {
  try {
    const server = await API.listResults();
    const local = JSON.parse(localStorage.getItem('asr_results') || '[]');
    const localIds = new Set(local.map(r => r.id));

    let added = 0;
    for (const item of server.results || []) {
      if (!localIds.has(item.id) && item.text_length > 0) {
        const detail = await API.getResult(item.id);
        local.push({
          id: detail.file_id || item.id,
          filename: detail.filename || item.id,
          date: new Date((detail.completed_at || 0) * 1000).toISOString(),
          duration_sec: detail.duration_sec || 0,
          language: detail.language || '',
          text: detail.full_text || '',
          segments: detail.segments || [],
          words: [],
        });
        savedFileIds.add(item.id);
        added++;
      }
    }
    if (added > 0) {
      local.sort((a, b) => new Date(b.date) - new Date(a.date));
      if (local.length > 20) local.length = 20;
      localStorage.setItem('asr_results', JSON.stringify(local));
      localStorage.setItem('asr_saved_ids', JSON.stringify([...savedFileIds]));
    }
  } catch {
    // Silent
  }
}

function escapeHtml(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
