// Config page — LLM configuration, per-preset independent keys
import { toast } from '../ui.js';
import { API } from '../api.js';

const NANOBOT_PRESETS = {
  sensenova:  { url: 'https://token.sensenova.cn/v1',                  model: 'deepseek-v4-flash',        label: 'SenseNova' },
  deepseek:   { url: 'https://api.deepseek.com',                    model: 'deepseek-chat',          label: 'DeepSeek' },
  openai:     { url: 'https://api.openai.com/v1',                   model: 'gpt-4o',                 label: 'OpenAI' },
  ollama:     { url: 'http://localhost:11434/v1',                    model: 'qwen2.5:7b',             label: 'Ollama 本地' },
};

const PRESETS = {
  sensenova:  { url: 'https://token.sensenova.cn/v1',                  model: 'deepseek-v4-flash',        label: 'SenseNova' },
  deepseek:   { url: 'https://api.deepseek.com',                    model: 'deepseek-chat',          label: 'DeepSeek' },
  openai:     { url: 'https://api.openai.com/v1',                   model: 'gpt-4o',                 label: 'OpenAI' },
  modelscope: { url: 'https://api-inference.modelscope.cn/v1',       model: 'ZhipuAI/GLM-5',          label: '魔搭 ModelScope' },
  ollama:     { url: 'http://localhost:11434/v1',                    model: 'qwen2.5:7b',             label: 'Ollama 本地' },
  lmstudio:   { url: 'http://localhost:1234/v1',                    model: '',                       label: 'LM Studio' },
  nanobot:    { url: 'http://127.0.0.1:18900/v1',                   model: 'nanobot',                label: 'Nanobot 记忆增强' },
  custom:     { url: '',                                            model: '',                       label: '自定义' },
};

const DEFAULT_PROMPTS = {
  deepseek:   '你是一个专业的文本助手。请根据用户提供的转写文本进行润色、整理或分析。保持原文的核心信息，改善表达流畅度。',
  sensenova:  '你是一个专业的文本助手。请根据用户提供的转写文本进行润色、整理或分析。保持原文的核心信息，改善表达流畅度。',
  openai:     '你是一个专业的文本助手。请根据用户提供的转写文本进行润色、整理或分析。保持原文的核心信息，改善表达流畅度。',
  modelscope: '你是一个专业的文本助手。请根据用户提供的转写文本进行润色、整理或分析。保持原文的核心信息，改善表达流畅度。',
  ollama:     '你是一个本地AI助手，请帮助我整理和分析文本。',
  lmstudio:   '你是一个AI助手，请帮助我处理文本任务。',
  nanobot:    '',   // 由 SOUL.md 控制
  custom:     '',
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
  return localStorage.getItem('asr_llm_config_active') || 'sensenova';
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
    <div class="card" style="border:2px solid var(--primary)">
      <h2>智能记忆管家（Nanobot）</h2>
      <div class="form-hint" style="margin-bottom:12px">
        Nanobot 会学习你的文本偏好，越用越懂你。启动后在对话页和润色/分析中自动带上你的风格。
      </div>
      <div id="nanobotSection">
        <div class="text-dim" style="text-align:center;padding:12px">加载中...</div>
      </div>
    </div>

    <div class="card">
      <h2>LLM 预设模板（每个预设独立保存）</h2>
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
      <details>
        <summary style="cursor:pointer"><h2 style="display:inline;font-size:1.15em">背景设置</h2></summary>
        <div style="margin-top:12px">
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
      </details>
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
  document.getElementById('systemPrompt').value = saved.system_prompt || DEFAULT_PROMPTS[activePreset] || '';
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
  initNanobot();
}

function switchPreset(name) {
  setActivePreset(name);
  const saved = loadPresetConfig(name);
  const defaults = PRESETS[name];

  document.getElementById('apiUrl').value = saved.api_url || defaults.url || '';
  document.getElementById('apiKey').value = saved.api_key || '';
  document.getElementById('modelName').value = saved.model_name || defaults.model || '';
  document.getElementById('systemPrompt').value = saved.system_prompt || DEFAULT_PROMPTS[name] || '';
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

async function saveConfig() {
  const preset = getCurrentPresetName();
  const config = getConfig();
  localStorage.setItem(storageKey(preset), JSON.stringify(config));
  // Sync to backend so /chat endpoint knows the API key
  try {
    await API.setLlmConfig(config);
  } catch {}
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
  document.getElementById('systemPrompt').value = DEFAULT_PROMPTS[preset] || '';
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

// ============ nanobot 记忆管家 ============
import * as Sidebar from '../components/sidebar.js';

async function initNanobot() {
  const section = document.getElementById('nanobotSection');
  if (!section) return;

  try {
    const [st, provider] = await Promise.all([
      API.nanobotStatus(),
      API.getNanobotProvider(),
    ]);
    Sidebar.updateNanobotStatus(st.running);
    renderNanobotSection(st, provider);
    loadAllNanobotFiles();
  } catch (e) {
    section.innerHTML = `<div class="text-dim" style="padding:8px">nanobot 服务不可用（后端可能未启动）</div>`;
  }
}

function renderNanobotSection(st, provider) {
  const section = document.getElementById('nanobotSection');
  if (!section) return;

  const enabled = st.enabled;
  const running = st.running;

  // Status bar
  const statusHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <span class="status-dot ${running ? 'green' : 'yellow'}"></span>
      <span>${running ? '运行中' : (enabled ? '已启用（未启动）' : '未启用')}</span>
      ${running ? '<span class="badge badge-completed">就绪</span>' : ''}
      <button class="btn ${enabled ? 'btn-danger' : 'btn-primary'}" id="nbToggleBtn" style="margin-left:auto">
        ${enabled ? '停止 Nanobot' : '一键启动 Nanobot'}
      </button>
      <button class="btn btn-ghost btn-sm" id="nbRefreshBtn" title="刷新">刷新</button>
    </div>
  `;

  // File editors (all collapsible)
  const editors = [
    { file: 'SOUL.md', title: 'SOUL.md 人设', desc: 'AI 的角色定义和行为风格' },
    { file: 'USER.md', title: 'USER.md 用户档案', desc: '用户偏好、常用术语、风格偏好' },
    { file: 'MEMORY.md', title: 'MEMORY.md 项目记忆', desc: 'Dream 自动学习的项目记忆' },
    { file: 'AGENTS.md', title: 'AGENTS.md', desc: '智能体配置规则' },
    { file: 'TOOLS.md', title: 'TOOLS.md', desc: '工具定义和使用说明' },
    { file: 'HEARTBEAT.md', title: 'HEARTBEAT.md', desc: '心跳任务配置' },
  ];

  const editorsHTML = editors.map(e => `
    <details style="margin-bottom:12px">
      <summary style="cursor:pointer;font-size:0.95em;color:var(--muted-fg)"><strong>${e.title}</strong> <span class="text-dim text-sm">${e.desc}</span></summary>
      <div style="margin-top:12px">
        <div class="form-group">
          <textarea class="form-input" id="nbContent_${e.file.replace(/[^a-zA-Z]/g, '_')}" rows="6" style="font-family:var(--font-mono,monospace);font-size:0.85em" placeholder="加载中..."></textarea>
          <div class="flex gap-8 mt-8" style="flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" data-nb-save="${e.file}">保存</button>
            <button class="btn btn-ghost btn-sm" data-nb-reset="${e.file}">恢复默认</button>
            <span class="text-sm text-dim" id="nbStatus_${e.file.replace(/[^a-zA-Z]/g, '_')}"></span>
          </div>
        </div>
      </div>
    </details>
  `).join('');

  // Dream settings
  const dreamIntervals = [
    [0.5, '30分钟'], [1, '1小时'], [2, '2小时'], [4, '4小时'], [0, '关闭'],
  ];
  const savedInterval = localStorage.getItem('asr_nanobot_dream_interval');
  const currentInterval = savedInterval != null ? parseFloat(savedInterval) : 2;

  const dreamHTML = `
    <details style="margin-top:12px;border-top:1px solid var(--border);padding-top:8px">
      <summary style="cursor:pointer;font-size:0.85em;color:var(--muted-fg)">Dream 机制设置</summary>
      <div style="margin-top:12px">
        <div class="form-group">
          <label>Dream 间隔</label>
          <select class="form-input" id="nbDreamInterval">
            ${dreamIntervals.map(([v, l]) => `<option value="${v}" ${v === currentInterval ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <div class="form-hint">Dream 会在后台定期从交互历史中提取偏好、术语，自动更新 USER.md 和 MEMORY.md。</div>
        </div>
        <div class="flex gap-8 mt-8" style="flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="nbDreamSave">保存间隔</button>
          <button class="btn btn-ghost btn-sm" id="nbDreamTrigger">手动触发 Dream</button>
          <button class="btn btn-ghost btn-sm" id="nbDreamClearHistory">清空交互历史</button>
        </div>
      </div>
    </details>
  `;

  // Provider settings (existing)
  const providerHTML = `
    <details style="margin-top:12px;border-top:1px solid var(--border);padding-top:8px">
      <summary style="cursor:pointer;font-size:0.85em;color:var(--muted-fg)">高级设置（独立 LLM 配置）</summary>
      <div style="margin-top:8px">
        <div style="margin-bottom:8px">
          <label style="font-size:0.82em;color:var(--muted-fg)">快捷预设</label>
          <div id="nbPresets" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
            ${Object.entries(NANOBOT_PRESETS).map(([k, p]) =>
              `<button type="button" class="preset-btn nb-preset ${k === 'sensenova' ? 'active' : ''}" data-nbpreset="${k}">${p.label}</button>`
            ).join('')}
          </div>
        </div>
        <div class="form-group" style="margin-bottom:8px">
          <label>API 地址</label>
          <input type="text" class="form-input form-input-sm" id="nbApiUrl" value="${provider?.api_url || ''}" placeholder="https://token.sensenova.cn/v1">
        </div>
        <div class="form-group" style="margin-bottom:8px">
          <label>API Key</label>
          <input type="password" class="form-input form-input-sm" id="nbApiKey" value="" placeholder="sk-..." autocomplete="off">
          <div class="form-hint text-sm" style="color:var(--warning)">独立保存，切换回继承模式不会丢失</div>
        </div>
        <div class="form-group" style="margin-bottom:8px">
          <label>模型名称</label>
          <input type="text" class="form-input form-input-sm" id="nbModelName" value="${provider?.model_name || ''}" placeholder="deepseek-v4-flash">
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="nbProviderSave">保存（独立配置生效）</button>
          <button class="btn btn-ghost btn-sm" id="nbInherit">恢复继承模式</button>
        </div>
      </div>
    </details>
  `;

  section.innerHTML = statusHTML + editorsHTML + dreamHTML + providerHTML;

  // Wire events
  document.getElementById('nbToggleBtn').addEventListener('click', async () => {
    const btn = document.getElementById('nbToggleBtn');
    btn.disabled = true;
    try {
      if (!enabled) {
        const r = await API.nanobotStart();
        if (r.success) { toast(r.message, 'success'); reloadNanobotStatus(); loadAllNanobotFiles(); }
        else { toast(r.message, 'error'); }
      } else {
        const r = await API.nanobotStop();
        if (r.success) { toast('Nanobot 已停止', 'info'); reloadNanobotStatus(); }
        else { toast(r.message, 'error'); }
      }
    } catch (err) { toast('操作失败: ' + err.message, 'error'); }
    btn.disabled = false;
  });

  document.getElementById('nbRefreshBtn').addEventListener('click', () => { loadAllNanobotFiles(); });

  // Save buttons
  document.querySelectorAll('[data-nb-save]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const filename = btn.dataset.nbSave;
      const id = filename.replace(/[^a-zA-Z]/g, '_');
      const ta = document.getElementById('nbContent_' + id);
      const statusEl = document.getElementById('nbStatus_' + id);
      if (!ta) return;
      btn.disabled = true;
      try {
        const r = await API.saveNanobotWorkspace(filename, ta.value);
        if (r.success) {
          statusEl.innerHTML = '<span style="color:var(--success)">已保存</span>';
          toast(filename + ' 已保存', 'success');
          setTimeout(() => { if (statusEl) statusEl.innerHTML = ''; }, 2000);
        }
      } catch (err) {
        statusEl.innerHTML = '<span style="color:var(--error)">保存失败</span>';
      }
      btn.disabled = false;
    });
  });

  // Reset buttons
  document.querySelectorAll('[data-nb-reset]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const filename = btn.dataset.nbReset;
      const id = filename.replace(/[^a-zA-Z]/g, '_');
      const ta = document.getElementById('nbContent_' + id);
      if (!ta) return;
      try {
        const r = await API.resetNanobotMemory(filename);
        if (r.success) {
          ta.value = (await API.getNanobotFile(filename)).content || '';
          toast(filename + ' 已恢复默认', 'info');
        }
      } catch (err) { toast('重置失败: ' + err.message, 'error'); }
    });
  });

  // Nanobot preset buttons
  document.querySelectorAll('.nb-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nb-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const p = NANOBOT_PRESETS[btn.dataset.nbpreset];
      document.getElementById('nbApiUrl').value = p.url;
      document.getElementById('nbModelName').value = p.model;
    });
  });

  document.getElementById('nbProviderSave')?.addEventListener('click', async () => {
    const c = {
      api_url: document.getElementById('nbApiUrl').value.trim(),
      api_key: document.getElementById('nbApiKey').value.trim(),
      model_name: document.getElementById('nbModelName').value.trim(),
      mode: 'independent',
    };
    if (!c.api_url || !c.api_key || !c.model_name) {
      toast('请填写 API 地址、Key 和模型名称', 'error'); return;
    }
    try {
      const r = await API.setNanobotProvider(c);
      toast(r.message || '已保存（下次启动生效）', 'success');
    } catch (err) { toast('保存失败: ' + err.message, 'error'); }
  });

  document.getElementById('nbInherit')?.addEventListener('click', async () => {
    try {
      await API.setNanobotProvider({ mode: 'inherit' });
      toast('已切换为继承模式（使用当前 LLM 预设）', 'success');
      reloadNanobotStatus();
    } catch (err) { toast('切换失败: ' + err.message, 'error'); }
  });

  // Dream interval save
  document.getElementById('nbDreamSave')?.addEventListener('click', async () => {
    const interval = parseFloat(document.getElementById('nbDreamInterval').value);
    localStorage.setItem('asr_nanobot_dream_interval', String(interval));
    try {
      await API.setNanobotConfig({ enabled: st.enabled, dream_interval_h: interval });
      toast('Dream 间隔已保存', 'success');
    } catch (err) { toast('保存失败: ' + err.message, 'error'); }
  });

  // Dream manual trigger
  document.getElementById('nbDreamTrigger')?.addEventListener('click', () => {
    toast('Dream 任务已触发（请查看 Nanobot 日志确认）', 'info');
  });

  // Clear history
  document.getElementById('nbDreamClearHistory')?.addEventListener('click', () => {
    if (!confirm('确定清空所有交互历史？Dream 将失去历史上下文。\n\n请手动删除: ' + (st.workspace || '.nanobot-workspace') + '/memory/history.jsonl')) return;
  });
}

async function loadAllNanobotFiles() {
  const files = ['SOUL.md', 'USER.md', 'MEMORY.md', 'AGENTS.md', 'TOOLS.md', 'HEARTBEAT.md'];
  for (const fn of files) {
    const id = fn.replace(/[^a-zA-Z]/g, '_');
    const ta = document.getElementById('nbContent_' + id);
    if (!ta) continue;
    try {
      const r = await API.getNanobotFile(fn);
      ta.value = r.content || '';
    } catch { ta.value = ''; }
  }
}

async function reloadNanobotStatus() {
  try {
    const [st, provider] = await Promise.all([
      API.nanobotStatus(),
      API.getNanobotProvider(),
    ]);
    renderNanobotSection(st, provider);
    loadAllNanobotFiles();
  } catch {}
}
