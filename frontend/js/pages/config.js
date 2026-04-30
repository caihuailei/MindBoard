// Config page — LLM configuration, per-preset independent keys
import { toast } from '../ui.js';
import { API } from '../api.js';

const PRESETS = {
  deepseek:   { url: 'https://api.deepseek.com',                    model: 'deepseek-chat',          label: 'DeepSeek' },
  openai:     { url: 'https://api.openai.com/v1',                   model: 'gpt-4o',                 label: 'OpenAI' },
  modelscope: { url: 'https://api-inference.modelscope.cn/v1',       model: 'ZhipuAI/GLM-5',          label: '魔搭 ModelScope' },
  ollama:     { url: 'http://localhost:11434/v1',                    model: 'qwen2.5:7b',             label: 'Ollama 本地' },
  lmstudio:   { url: 'http://localhost:1234/v1',                    model: '',                       label: 'LM Studio' },
  custom:     { url: '',                                            model: '',                       label: '自定义' },
};

function storageKey(preset) {
  return `asr_llm_config_${preset}`;
}

function loadPresetConfig(preset) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(preset)) || '{}');
  } catch { return {}; }
}

function getActivePreset() {
  return localStorage.getItem('asr_llm_config_active') || 'deepseek';
}

function setActivePreset(name) {
  localStorage.setItem('asr_llm_config_active', name);
}

export function render() {
  const activePreset = getActivePreset();
  const saved = loadPresetConfig(activePreset);

  let presetBtns = Object.entries(PRESETS).map(([key, p]) =>
    `<button class="preset-btn ${key === activePreset ? 'active' : ''}" data-preset="${key}">${p.label}</button>`
  ).join('');

  return `
    <div class="card">
      <h2>预设模板（每个预设独立保存）</h2>
      <div class="presets" id="presetBtns">${presetBtns}</div>

      <form id="configForm">
        <div class="form-group">
          <label>API 地址</label>
          <input type="text" class="form-input" id="apiUrl" value="${saved.api_url || PRESETS[activePreset].url}" placeholder="https://api.deepseek.com">
        </div>
        <div class="form-group">
          <label>API Key</label>
          <input type="password" class="form-input" id="apiKey" value="${saved.api_key || ''}" placeholder="sk-..." autocomplete="off">
          <div class="form-hint" style="color:var(--warning)">每个预设独立保存，切换预设不会串 Key</div>
        </div>
        <div class="form-group">
          <label>模型名称</label>
          <input type="text" class="form-input" id="modelName" value="${saved.model_name || PRESETS[activePreset].model}" placeholder="deepseek-chat">
        </div>
        <div class="form-group">
          <label>系统提示词</label>
          <textarea class="form-input" id="systemPrompt" rows="4"></textarea>
        </div>
        <div class="form-group">
          <label>Temperature: <span id="tempValue">${saved.temperature || 0.3}</span></label>
          <input type="range" class="form-input" id="temperature" min="0" max="1" step="0.05" value="${saved.temperature || 0.3}">
        </div>
        <div class="btn-group">
          <button type="button" class="btn btn-primary" id="saveTestBtn">保存并测试</button>
          <button type="button" class="btn btn-secondary" id="saveBtn">仅保存</button>
          <button type="button" class="btn btn-danger" id="clearBtn">清除此预设</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>连接状态</h2>
      <div class="status-indicator">
        <span class="status-dot gray" id="statusDot"></span>
        <span id="statusText">未配置</span>
      </div>
      <div class="config-summary mt-8">
        <p>当前预设: <code id="currentPreset">${PRESETS[activePreset].label}</code></p>
        <p>API 地址: <code id="currentUrl">${saved.api_url || '-'}</code></p>
        <p>模型: <code id="currentModel">${saved.model_name || '-'}</code></p>
        <p>Key 已设置: <code id="currentKey">${saved.api_key ? '是' : '否'}</code></p>
      </div>
    </div>

    <div id="testResult" class="hidden" style="padding:12px;border-radius:var(--radius-sm);margin-bottom:16px"></div>

    <div class="card">
      <h2>背景设置</h2>
      <div class="form-group">
        <label>背景图片 URL（可选）</label>
        <input type="text" class="form-input" id="bgImageInput" value="${localStorage.getItem('asr_bg_image') || ''}" placeholder="https://example.com/wallpaper.jpg">
        <div class="form-hint">设置后页面背景将使用此图片，半透明遮罩保证内容可读。留空恢复默认。</div>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-secondary" id="setBgBtn">应用背景</button>
        <button type="button" class="btn btn-ghost" id="clearBgBtn">清除背景</button>
      </div>
    </div>
  `;
}

export function init() {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      switchPreset(btn.dataset.preset);
    });
  });

  document.getElementById('temperature').addEventListener('input', (e) => {
    document.getElementById('tempValue').textContent = parseFloat(e.target.value).toFixed(2);
  });

  document.getElementById('saveTestBtn').addEventListener('click', saveAndTest);
  document.getElementById('saveBtn').addEventListener('click', () => { saveConfig(); toast('配置已保存', 'success'); });
  document.getElementById('clearBtn').addEventListener('click', clearPreset);

  // Init textarea with active preset's system_prompt
  const activePreset = getActivePreset();
  const saved = loadPresetConfig(activePreset);
  document.getElementById('systemPrompt').value = saved.system_prompt || '';
  document.getElementById('tempValue').textContent = saved.temperature || 0.3;

  // Background image
  document.getElementById('setBgBtn').addEventListener('click', () => {
    const url = document.getElementById('bgImageInput').value.trim();
    if (url) {
      localStorage.setItem('asr_bg_image', url);
      document.body.style.setProperty('--bg-image', `url("${url.replace(/"/g, '\\"')}")`);
      toast('背景已应用', 'success');
    } else {
      localStorage.removeItem('asr_bg_image');
      document.body.style.setProperty('--bg-image', 'none');
      toast('已清除背景', 'info');
    }
  });
  document.getElementById('clearBgBtn').addEventListener('click', () => {
    document.getElementById('bgImageInput').value = '';
    localStorage.removeItem('asr_bg_image');
    document.body.style.setProperty('--bg-image', 'none');
    toast('背景已清除', 'info');
  });

  updateStatus();
}

function switchPreset(name) {
  setActivePreset(name);
  const saved = loadPresetConfig(name);
  const defaults = PRESETS[name];

  document.getElementById('apiUrl').value = saved.api_url || defaults.url || '';
  document.getElementById('apiKey').value = saved.api_key || '';
  document.getElementById('modelName').value = saved.model_name || defaults.model || '';
  document.getElementById('systemPrompt').value = saved.system_prompt || '';
  document.getElementById('temperature').value = saved.temperature || 0.3;
  document.getElementById('tempValue').textContent = saved.temperature || 0.3;

  // Clear test result
  const el = document.getElementById('testResult');
  el.classList.add('hidden');
  updateStatus();
}

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  document.getElementById('apiUrl').value = p.url;
  document.getElementById('modelName').value = p.model;
}

function getConfig() {
  return {
    api_url: document.getElementById('apiUrl').value.trim(),
    api_key: document.getElementById('apiKey').value.trim(),
    model_name: document.getElementById('modelName').value.trim(),
    system_prompt: document.getElementById('systemPrompt').value.trim(),
    temperature: parseFloat(document.getElementById('temperature').value) || 0.3,
  };
}

function getCurrentPresetName() {
  return document.querySelector('.preset-btn.active')?.dataset?.preset || 'custom';
}

function saveConfig() {
  const preset = getCurrentPresetName();
  localStorage.setItem(storageKey(preset), JSON.stringify(getConfig()));
  updateStatus();
}

async function saveAndTest() {
  const c = getConfig();
  if (!c.api_url || !c.api_key || !c.model_name) {
    toast('请填写 API 地址、Key 和模型名称', 'error');
    return;
  }
  saveConfig();
  const el = document.getElementById('testResult');
  el.className = '';
  el.textContent = '正在测试连接...';
  el.classList.remove('hidden');
  try {
    const r = await API.llmTest(c);
    el.className = '';
    el.style.background = 'var(--success-bg)';
    el.style.color = 'var(--success)';
    el.style.border = '1px solid var(--success)';
    el.textContent = '连接成功！' + (r.reply ? '回复: ' + r.reply : '');
    updateStatus(true);
  } catch (e) {
    el.style.background = 'var(--error-bg)';
    el.style.color = 'var(--error)';
    el.style.border = '1px solid var(--error)';
    el.textContent = '连接失败: ' + e.message;
    updateStatus(false);
  }
  el.classList.remove('hidden');
}

function clearPreset() {
  const preset = getCurrentPresetName();
  localStorage.removeItem(storageKey(preset));
  const defaults = PRESETS[preset];
  document.getElementById('apiKey').value = '';
  document.getElementById('apiUrl').value = defaults.url || '';
  document.getElementById('modelName').value = defaults.model || '';
  document.getElementById('testResult').classList.add('hidden');
  updateStatus();
  toast('当前预设配置已清除', 'info');
}

function updateStatus(connected) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  const preset = getCurrentPresetName();
  const c = loadPresetConfig(preset);

  document.getElementById('currentPreset').textContent = PRESETS[preset]?.label || preset;
  document.getElementById('currentUrl').textContent = c.api_url || '-';
  document.getElementById('currentModel').textContent = c.model_name || '-';
  document.getElementById('currentKey').textContent = c.api_key ? '是' : '否';

  if (!c.api_url || !c.api_key || !c.model_name) {
    dot.className = 'status-dot gray';
    txt.textContent = '未配置';
  } else if (connected === true) {
    dot.className = 'status-dot green';
    txt.textContent = '已连接';
  } else if (connected === false) {
    dot.className = 'status-dot red';
    txt.textContent = '连接失败';
  } else {
    dot.className = 'status-dot yellow';
    txt.textContent = '已配置（未测试）';
  }
}
