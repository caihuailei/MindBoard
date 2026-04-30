// ASS Subtitle page
import { toast, downloadText, formatFileSize } from '../ui.js';
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
      <div id="assStatus" class="mt-8 text-sm text-dim"></div>
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
    if (e.dataTransfer.files.length) {
      handleAssFile(e.dataTransfer.files[0]);
    }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleAssFile(fileInput.files[0]);
    fileInput.value = '';
  });

  document.getElementById('assGenerateBtn').addEventListener('click', generateAss);

  renderHistory();
}

let selectedAssFile = null;

function handleAssFile(file) {
  selectedAssFile = file;
  document.getElementById('assDropZone').innerHTML = `<p>已选择: ${file.name} (${formatFileSize(file.size)})</p>`;
}

async function generateAss() {
  if (!selectedAssFile) {
    toast('请先选择文件', 'error');
    return;
  }

  const btn = document.getElementById('assGenerateBtn');
  const status = document.getElementById('assStatus');
  btn.disabled = true;
  status.textContent = '正在处理...';
  status.className = 'mt-8 text-sm';

  try {
    const assContent = await API.transcribeAss(selectedAssFile, {
      language: document.getElementById('assLang').value,
      context: document.getElementById('assContext').value,
    });

    const filename = selectedAssFile.name.replace(/\.[^.]+$/, '') + '.ass';
    downloadText(assContent, filename);
    toast('ASS 字幕已下载', 'success');
    status.textContent = '下载完成';
    status.className = 'mt-8 text-sm';

    // Save to history
    const history = JSON.parse(localStorage.getItem('ass_history') || '[]');
    history.unshift({ filename, date: new Date().toISOString() });
    if (history.length > 10) history.length = 10;
    localStorage.setItem('ass_history', JSON.stringify(history));
    renderHistory();

  } catch (e) {
    status.textContent = '生成失败: ' + e.message;
    status.style.color = 'var(--error)';
    toast('生成失败: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
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
