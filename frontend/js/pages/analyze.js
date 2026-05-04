// AI 分析页面 — 文本结构化摘要
import { toast, copyToClipboard, downloadText } from '../ui.js';
import { API } from '../api.js';
import { navigate } from '../router.js';

const MODES = [
  { value: 'summarize',   label: '摘要' },
  { value: 'code-review', label: '代码审查' },
  { value: 'security',    label: '安全审计' },
  { value: 'extract',     label: '信息提取' },
];

const MODE_DESC = {
  summarize: '结构化摘要：核心内容、关键议题、待办事项',
  'code-review': '代码审查：问题、架构评估、改进建议',
  security: '安全审计：漏洞清单、修复方案',
  extract: '信息提取：核心要点、实体、时间线',
};

function getActiveConfig() {
  const activePreset = localStorage.getItem('asr_llm_config_active') || 'sensenova';
  return JSON.parse(localStorage.getItem(`asr_llm_config_${activePreset}`) || '{}');
}

function hasConfig() {
  const c = getActiveConfig();
  return !!(c.api_url && c.api_key && c.model_name);
}

function getCustomPrompts() {
  try {
    return JSON.parse(localStorage.getItem('ai_custom_prompts') || '{}');
  } catch { return {}; }
}

export function render() {
  const saved = getActiveConfig();
  const configured = hasConfig();
  const customPrompts = getCustomPrompts();

  const modeTabs = MODES.map(m =>
    `<button class="tab-btn" data-mode="${m.value}">${m.label}</button>`
  ).join('');

  // Custom prompts selector
  const customOpts = Object.keys(customPrompts).map(k =>
    `<option value="custom:${k}">自定义: ${k}</option>`
  ).join('');

  return `
    <div class="card">
      <h2>AI 智能分析</h2>
      ${!configured ? '<div class="text-sm" style="padding:8px 12px;background:var(--warning-bg);border-radius:var(--radius-sm);margin-bottom:12px;color:var(--warning)">请先在 <a href="#/config" style="color:var(--accent)">配置页面</a> 设置 LLM 参数</div>' : ''}

      <!-- 模式选择 -->
      <div class="form-group">
        <label>分析模式</label>
        <div class="tab-bar" id="modeTabs">${modeTabs}</div>
        <select class="form-input mt-8" id="analyzeMode">
          ${MODES.map(m => `<option value="${m.value}">${m.label}</option>`).join('')}
          ${customOpts ? `<optgroup label="自定义">${customOpts}</optgroup>` : ''}
          <option value="custom">自定义提示词</option>
        </select>
        <div id="modeDesc" class="text-sm text-dim mt-4">${MODE_DESC.summarize}</div>
      </div>

      <!-- 自定义提示词（隐藏，选自定义时显示） -->
      <div id="customPromptBox" class="hidden form-group">
        <label>自定义提示词</label>
        <textarea class="form-input" id="customPrompt" rows="5" placeholder="输入你的分析要求..."></textarea>
        <div class="text-sm text-dim mt-4">
          <a href="javascript:void(0)" id="saveAsPreset">保存为预设</a>
        </div>
      </div>

      <!-- 文本输入 -->
      <div class="form-group">
        <label>输入文本</label>
        <textarea class="form-input" id="analyzeInput" rows="8" placeholder="粘贴需要分析的文本，或从转写结果导入..."></textarea>
      </div>

      <div class="btn-group">
        <button class="btn btn-primary" id="analyzeBtn" ${!configured ? 'disabled' : ''}>开始分析</button>
        <button class="btn btn-secondary" id="importResultBtn">从转写结果导入</button>
      </div>

      <div id="analyzeConfigSummary" class="config-summary text-sm mt-8">
        ${configured ? `模型: <code>${saved.model_name}</code> · ${saved.api_url}` : '<span class="text-dim">未配置 LLM</span>'}
      </div>
    </div>

    <div id="analyzeResult" class="hidden">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2>分析结果</h2>
          <span class="badge badge-success" id="analyzeModeBadge"></span>
        </div>
        <div id="analyzeOutput" class="transcript-body" style="white-space:pre-wrap"></div>
        <div class="btn-group">
          <button class="btn btn-primary btn-sm" id="copyAnalyzeBtn">复制</button>
          <button class="btn btn-secondary btn-sm" id="downloadAnalyzeBtn">下载 .md</button>
        </div>
      </div>
    </div>

    <div id="analyzeLoading" class="hidden card" style="text-align:center">
      <div class="spinner" style="margin:0 auto"></div>
      <p class="mt-8 text-dim">正在分析 <span id="analyzeProgress" class="text-dim"></span></p>
    </div>
  `;
}

export function init() {
  document.getElementById('analyzeBtn').addEventListener('click', doAnalyze);
  document.getElementById('importResultBtn').addEventListener('click', importResult);

  // Mode tab buttons
  document.querySelectorAll('#modeTabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#modeTabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      document.getElementById('analyzeMode').value = mode;
      updateModeDisplay(mode);
    });
  });

  // Mode select change
  document.getElementById('analyzeMode').addEventListener('change', (e) => {
    updateModeDisplay(e.target.value);
  });

  // Save custom preset
  document.getElementById('saveAsPreset').addEventListener('click', saveCustomPreset);

  // Copy
  document.getElementById('copyAnalyzeBtn')?.addEventListener('click', () => {
    const text = document.getElementById('analyzeOutput')?.textContent || '';
    if (text) copyToClipboard(text);
  });

  // Download
  document.getElementById('downloadAnalyzeBtn')?.addEventListener('click', () => {
    const text = document.getElementById('analyzeOutput')?.textContent || '';
    if (text) {
      const now = new Date();
      const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      downloadText(text, `analyze_${ts}.md`);
    }
  });

  // Restore from sessionStorage
  const savedInput = sessionStorage.getItem('analyze_input');
  if (savedInput) {
    document.getElementById('analyzeInput').value = savedInput;
    sessionStorage.removeItem('analyze_input');
  }
  const savedResult = sessionStorage.getItem('analyze_result');
  const savedMode = sessionStorage.getItem('analyze_mode');
  if (savedResult) {
    document.getElementById('analyzeOutput').textContent = savedResult;
    document.getElementById('analyzeResult').classList.remove('hidden');
    if (savedMode) document.getElementById('analyzeModeBadge').textContent = savedMode;
  }

  // Activate default tab
  document.querySelector('#modeTabs .tab-btn')?.classList.add('active');
}

function updateModeDisplay(mode) {
  const customBox = document.getElementById('customPromptBox');
  const desc = document.getElementById('modeDesc');

  if (mode === 'custom' || mode.startsWith('custom:')) {
    customBox.classList.remove('hidden');
    desc.textContent = '使用自定义提示词进行分析';

    // Load saved preset
    if (mode.startsWith('custom:')) {
      const name = mode.slice(7);
      const prompts = getCustomPrompts();
      if (prompts[name]) {
        document.getElementById('customPrompt').value = prompts[name];
      }
    }
  } else {
    customBox.classList.add('hidden');
    desc.textContent = MODE_DESC[mode] || '';
  }
}

async function doAnalyze() {
  const config = getActiveConfig();
  if (!config.api_url || !config.api_key || !config.model_name) {
    toast('请先在配置页面设置 LLM', 'error');
    return;
  }

  const text = document.getElementById('analyzeInput').value.trim();
  if (!text) { toast('请输入需要分析的文本', 'error'); return; }

  let mode = document.getElementById('analyzeMode').value;
  let customPrompt = '';

  // Handle custom prompt
  if (mode === 'custom' || mode.startsWith('custom:')) {
    customPrompt = document.getElementById('customPrompt').value.trim();
    if (!customPrompt) { toast('请输入自定义提示词', 'error'); return; }
    mode = 'summarize'; // mode doesn't matter, prompt overrides
  }

  document.getElementById('analyzeBtn').disabled = true;
  document.getElementById('analyzeLoading').classList.remove('hidden');
  document.getElementById('analyzeResult').classList.add('hidden');
  document.getElementById('analyzeProgress').textContent = '';

  const output = document.getElementById('analyzeOutput');
  const modeLabel = MODES.find(m => m.value === mode)?.label || mode;
  document.getElementById('analyzeModeBadge').textContent = modeLabel;

  try {
    const result = await API.aiAnalyze(text, mode, customPrompt, config);
    output.textContent = result.result;
    document.getElementById('analyzeResult').classList.remove('hidden');
    sessionStorage.setItem('analyze_result', result.result);
    sessionStorage.setItem('analyze_mode', modeLabel);
    toast('分析完成', 'success');
  } catch (e) {
    toast('分析失败: ' + e.message, 'error');
    document.getElementById('analyzeResult').classList.remove('hidden');
    if (!output.textContent) output.textContent = '错误: ' + e.message;
  } finally {
    document.getElementById('analyzeBtn').disabled = false;
    document.getElementById('analyzeLoading').classList.add('hidden');
  }
}

function saveCustomPreset() {
  const prompt = document.getElementById('customPrompt').value.trim();
  if (!prompt) { toast('请先输入提示词', 'error'); return; }

  const name = prompt('预设名称（如：会议纪要、代码审查）');
  if (!name) return;

  const prompts = getCustomPrompts();
  prompts[name] = prompt;
  localStorage.setItem('ai_custom_prompts', JSON.stringify(prompts));
  toast(`预设 "${name}" 已保存`, 'success');
}

function importResult() {
  const results = JSON.parse(localStorage.getItem('asr_results') || '[]');
  if (results.length === 0) {
    toast('没有转写结果可以导入', 'info');
    return;
  }
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
      document.getElementById('analyzeInput').value = results[idx].text || '';
      overlay.remove();
    });
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}
