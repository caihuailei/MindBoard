// LLM Refine page
import { toast, copyToClipboard, downloadText } from '../ui.js';
import { API } from '../api.js';
import { navigate } from '../router.js';

export function render() {
  const saved = JSON.parse(localStorage.getItem('asr_llm_config') || '{}');
  const hasConfig = saved.api_url && saved.api_key && saved.model_name;

  return `
    <div class="card">
      <h2>LLM 文本润色</h2>
      ${!hasConfig ? '<div class="text-sm" style="padding:8px 12px;background:var(--warning-bg);border-radius:var(--radius-sm);margin-bottom:12px;color:var(--warning)">请先在 <a href="#/config" style="color:var(--accent)">配置页面</a> 设置 LLM 参数</div>' : ''}

      <div class="form-group">
        <label>输入文本</label>
        <textarea class="form-input" id="refineInput" rows="8" placeholder="粘贴需要润色的文本，或从结果页面导入...">${sessionStorage.getItem('refine_input') || ''}</textarea>
      </div>

      <div class="btn-group">
        <button class="btn btn-primary" id="refineBtn" ${!hasConfig ? 'disabled' : ''}>润色文本</button>
        <button class="btn btn-secondary" id="importResultBtn">从结果导入</button>
      </div>

      <div id="refineConfigSummary" class="config-summary text-sm mt-8">
        ${hasConfig ? `模型: <code>${saved.model_name}</code> · ${saved.api_url}` : '<span class="text-dim">未配置 LLM</span>'}
      </div>
    </div>

    <div id="refineResult" class="hidden">
      <div class="card">
        <h2>润色结果</h2>
        <div id="refineOutput" class="transcript-body"></div>
        <div class="btn-group">
          <button class="btn btn-primary btn-sm" id="copyRefineBtn">复制结果</button>
          <button class="btn btn-secondary btn-sm" id="downloadRefineBtn">下载</button>
        </div>
      </div>
    </div>

    <div id="refineLoading" class="hidden card text-center" style="text-align:center">
      <div class="spinner" style="margin:0 auto"></div>
      <p class="mt-8 text-dim">正在润色...</p>
    </div>
  `;
}

export function init() {
  document.getElementById('refineBtn').addEventListener('click', doRefine);
  document.getElementById('importResultBtn').addEventListener('click', importResult);
  document.getElementById('copyRefineBtn')?.addEventListener('click', () => {
    const text = document.getElementById('refineOutput')?.textContent || '';
    if (text) copyToClipboard(text);
  });
  document.getElementById('downloadRefineBtn')?.addEventListener('click', () => {
    const text = document.getElementById('refineOutput')?.textContent || '';
    if (text) downloadText(text, `refined_${Date.now()}.txt`);
  });

  // Clear stored input after loading
  sessionStorage.removeItem('refine_input');
}

async function doRefine() {
  const config = JSON.parse(localStorage.getItem('asr_llm_config') || '{}');
  if (!config.api_url || !config.api_key || !config.model_name) {
    toast('请先在配置页面设置 LLM', 'error');
    return;
  }

  const text = document.getElementById('refineInput').value.trim();
  if (!text) { toast('请输入需要润色的文本', 'error'); return; }

  document.getElementById('refineBtn').disabled = true;
  document.getElementById('refineLoading').classList.remove('hidden');
  document.getElementById('refineResult').classList.add('hidden');

  try {
    const result = await API.refineText(text, config);
    document.getElementById('refineResult').classList.remove('hidden');
    document.getElementById('refineOutput').textContent = result.refined_text || '';
    document.getElementById('copyRefineBtn').textContent = '复制结果';
    toast('润色完成', 'success');
  } catch (e) {
    toast('润色失败: ' + e.message, 'error');
    document.getElementById('refineResult').classList.remove('hidden');
    document.getElementById('refineOutput').textContent = '错误: ' + e.message;
  } finally {
    document.getElementById('refineBtn').disabled = false;
    document.getElementById('refineLoading').classList.add('hidden');
  }
}

function importResult() {
  const results = JSON.parse(localStorage.getItem('asr_results') || '[]');
  if (results.length === 0) {
    toast('没有转写结果可以导入', 'info');
    return;
  }
  // Show a simple picker
  const list = results.map((r, i) =>
    `<div style="padding:8px;cursor:pointer;border-bottom:1px solid var(--border)" data-idx="${i}">
      <strong>${r.filename}</strong>
      <span class="text-dim text-sm"> · ${(r.text || '').length} 字 · ${new Date(r.date).toLocaleString('zh-CN')}</span>
    </div>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal"><h3>选择要导入的结果</h3>${list || '<p>没有结果</p>'}</div>`;
  document.body.appendChild(overlay);

  overlay.querySelectorAll('[data-idx]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx);
      document.getElementById('refineInput').value = results[idx].text || '';
      overlay.remove();
    });
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}
