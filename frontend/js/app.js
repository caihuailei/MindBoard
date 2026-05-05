// App entry point — 3-column layout
import { initRouter } from './router.js';
import * as Sidebar from './components/sidebar.js';
import * as RightPanel from './components/rightpanel.js';
import { API } from './api.js';
window.API = API;
import { loadStore, createSession, getActiveSession, getAllSessions } from './store.js';

function initTheme() {
  const saved = localStorage.getItem('asr-theme');
  if (saved) {
    document.documentElement.classList.add(saved);
  }
}

function initSidebar() {
  Sidebar.mount(document.getElementById('sidebar'), {
    onNav: (path) => { window.location.hash = path; },
  });
}

function initRightPanel() {
  RightPanel.mount(document.getElementById('right-panel'));
  // Connect WebSocket events to right panel
  if (API.ws) {
    API.ws.on('job', (data) => RightPanel.handleEvent(data));
    API.ws.on('connected', () => console.log('[WS] Connected — right panel ready'));
    API.ws.on('disconnected', (attempt) => console.warn('[WS] Disconnected, reconnect attempt:', attempt));
  }
}

// Persistent top-right menu in main content
function initTopBar() {
  // Update model label from saved config
  const activePreset = localStorage.getItem('asr_llm_config_active') || 'sensenova';
  const labels = { sensenova: 'SenseNova', deepseek: 'DeepSeek', openai: 'OpenAI', modelscope: '魔搭', ollama: 'Ollama', nanobot: 'Nanobot' };
  const modelLabel = document.getElementById('chatModelLabel');
  if (modelLabel) modelLabel.textContent = labels[activePreset] || 'SenseNova';

  // Model selector click
  document.getElementById('chatModelSelect')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleModelPicker();
  });

  // Menu button
  document.getElementById('mainMenuBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMainMenu();
  });
}

function toggleModelPicker() {
  let picker = document.getElementById('chatModelPicker');
  if (picker) {
    picker.remove();
    return;
  }

  const presets = {
    sensenova:  { label: 'SenseNova' },
    deepseek:   { label: 'DeepSeek' },
    openai:     { label: 'OpenAI' },
    modelscope: { label: '魔搭' },
    ollama:     { label: 'Ollama' },
    nanobot:    { label: 'Nanobot' },
  };
  const activePreset = localStorage.getItem('asr_llm_config_active') || 'sensenova';

  picker = document.createElement('div');
  picker.className = 'chat-model-picker';
  picker.id = 'chatModelPicker';
  picker.innerHTML = Object.entries(presets).map(([key, p]) =>
    `<button class="chat-model-option ${key === activePreset ? 'active' : ''}" data-preset="${key}">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      ${p.label}
    </button>`
  ).join('');

  const topbar = document.querySelector('.main-topbar');
  if (!topbar) return;
  topbar.style.position = 'relative';
  topbar.appendChild(picker);

  picker.querySelectorAll('.chat-model-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      localStorage.setItem('asr_llm_config_active', preset);
      const label = document.getElementById('chatModelLabel');
      if (label) label.textContent = presets[preset].label;
      picker.querySelectorAll('.chat-model-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      picker.remove();
      toast(`已切换至: ${presets[preset].label}`, 'success');
    });
  });
}

function toggleMainMenu() {
  let menu = document.getElementById('mainMenu');
  if (menu) {
    menu.remove();
    return;
  }

  menu = document.createElement('div');
  menu.className = 'main-topbar-dropdown';
  menu.id = 'mainMenu';

  const rpVisible = RightPanel.isVisible();
  menu.innerHTML = `
    <button class="main-menu-item" id="menuToggleRP">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="14" y="3" width="7" height="18" rx="1" fill="currentColor" opacity="0.2"/></svg>
      工作流面板 ${rpVisible ? '(已开启)' : '(已关闭)'}
    </button>
  `;

  document.querySelector('.main-topbar')?.appendChild(menu);

  menu.querySelector('#menuToggleRP')?.addEventListener('click', () => {
    RightPanel.toggle();
    menu.remove();
  });
}

// Close menus on outside click
document.addEventListener('click', (e) => {
  const mainMenu = document.getElementById('mainMenu');
  if (mainMenu && !mainMenu.contains(e.target) && !e.target.closest('#mainMenuBtn')) {
    mainMenu.remove();
  }
  const modelPicker = document.getElementById('chatModelPicker');
  if (modelPicker && !modelPicker.contains(e.target) && !e.target.closest('#chatModelSelect')) {
    modelPicker.remove();
  }
});

// Health polling (via WebSocket if available, fallback to HTTP)
function startHealthMonitoring() {
  if (API.ws) {
    API.ws.on('health', (data) => {
      // Could update a status indicator in the sidebar
    });
  }
}

// Global nav handler for inline onclick fallback
window.__asrNav = function(path) {
  window.location.hash = path;
};

function run() {
  try {
    loadStore();
    initTheme();
    initSidebar();
    initStore();
    initTopBar();
    initNanobotStatus();
    initRightPanel();
    startHealthMonitoring();
    initRouter();
    if (API.ws) API.ws.connect();
  } catch (e) {
    console.error('[ASR] Init error:', e);
    const mc = document.getElementById('main-content');
    if (mc) mc.innerHTML = `<div class="card"><h2>加载错误</h2><p>${escapeHtml(e.message)}</p><p class="text-sm text-dim mt-8">请打开浏览器控制台(F12)查看详细错误</p></div>`;
  }
}

async function initNanobotStatus() {
  try {
    const st = await API.nanobotStatus();
    Sidebar.updateNanobotStatus(st.running);
  } catch {
    // Nanobot not running or backend not started — sidebar dot stays gray
  }
}

function initStore() {
  if (!getActiveSession()) {
    createSession();
  }
  refreshSidebarSessions();
}

function refreshSidebarSessions() {
  const sessions = getAllSessions().map(s => ({
    hash: `/chat/${s.id}`,
    title: s.title,
    updated: s.updated,
  }));
  const activeId = getActiveSession()?.id || null;
  Sidebar.updateSessions(sessions, activeId);
}

// ── Electron frameless window setup ──
function initElectronTitlebar() {
  if (!window.electronAPI) return;

  const tb = document.getElementById('titlebar');
  if (!tb) return;
  tb.style.display = 'flex';
  document.documentElement.classList.add('electron-mode');

  document.getElementById('wcMinimize')?.addEventListener('click', () => window.electronAPI.windowMinimize());
  document.getElementById('wcMaximize')?.addEventListener('click', () => window.electronAPI.windowMaximize());
  document.getElementById('wcClose')?.addEventListener('click', () => window.electronAPI.windowClose());

  // Update maximize icon
  const maxIcon = document.getElementById('wcMaxIcon');
  if (maxIcon) {
    window.electronAPI.windowIsMaximized().then(maxed => {
      if (maxed) {
        maxIcon.innerHTML = '<><rect x="3" y="1" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="1" y="3" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2"/></>';
      }
    });
  }
}

// ES modules are deferred — DOM is already ready when this executes
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { run(); initElectronTitlebar(); });
} else {
  run();
  initElectronTitlebar();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (API.ws) API.ws.disconnect();
});
