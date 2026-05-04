// Sidebar component — DeepTutor style left nav with grouped sessions
import { toast } from '../ui.js';

const NAV_ITEMS = [
  { hash: '#chat',   icon: chatIcon,    label: '对话' },
  { hash: '#upload', icon: uploadIcon,  label: '转写' },
  { hash: '#refine', icon: refineIcon,  label: '润色' },
  { hash: '#analyze',icon: analyzeIcon, label: '分析' },
  { hash: '#ass',    icon: assIcon,     label: 'ASS' },
  { hash: '#results',icon: resultsIcon, label: '结果' },
  { hash: '#guide',  icon: guideIcon,   label: 'API文档' },
  { hash: '#schedule', icon: scheduleIcon, label: '课程表' },
  { hash: '#config', icon: configIcon,  label: '配置' },
  { hash: '#health', icon: healthIcon,  label: '状态' },
];

let state = { collapsed: false, sessions: [], activeId: null, nanobotRunning: false };
let el = null;
let callbacks = {};
let settingsOpen = false;

export function mount(container, opts) {
  el = container;
  callbacks = opts || {};
  state.collapsed = localStorage.getItem('sidebar-collapsed') === '1';
  render();
}

export function updateNanobotStatus(running) {
  state.nanobotRunning = running;
  const dot = el?.querySelector('#sbNanobot .status-dot');
  if (dot) {
    dot.className = `status-dot ${running ? 'green' : 'gray'}`;
    dot.title = running ? 'Nanobot 运行中' : 'Nanobot 未启动';
  }
}

export function setActive(hash) {
  if (!el) return;
  el.querySelectorAll('.sb-nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.hash === hash);
  });
}

export function updateSessions(sessions, activeId) {
  state.sessions = sessions || [];
  if (activeId) state.activeId = activeId;
  if (el) renderSessions();
}

function render() {
  el.className = 'sidebar' + (state.collapsed ? ' collapsed' : '');
  el.innerHTML = sidebarHTML();

  el.querySelector('.sb-collapse-btn')?.addEventListener('click', () => {
    state.collapsed = !state.collapsed;
    localStorage.setItem('sidebar-collapsed', state.collapsed ? '1' : '0');
    render();
  });

  // Nav items
  el.querySelectorAll('.sb-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const hash = btn.dataset.hash;
      const path = hash.startsWith('#') ? '/' + hash.slice(1) : hash;
      if (callbacks.onNav) callbacks.onNav(path);
    });
  });

  // Nanobot link
  el?.querySelector('#sbNanobot')?.addEventListener('click', () => {
    if (callbacks.onNav) callbacks.onNav('/config');
  });

  // User avatar — open settings modal
  el?.querySelector('#sbUserAvatar')?.addEventListener('click', () => {
    if (settingsOpen) return;
    openSettingsModal();
  });

  // New chat button — reuse existing empty session if one exists
  el.querySelector('#sbNewChat')?.addEventListener('click', async () => {
    const store = await import('../store.js');
    const sessions = store.getAllSessions();
    const empty = sessions.find(s => !s.messages || s.messages.length === 0);
    if (empty) {
      store.setActive(empty.id);
    } else {
      store.createSession();
    }
    refreshSessionsFromStore();

    const hash = window.location.hash.slice(1);
    if (hash === '/chat' || hash.startsWith('/chat')) {
      // Already on chat page — force re-render (hashchange won't fire)
      const chatMod = await import('../pages/chat.js');
      const target = document.getElementById('route-content') || document.getElementById('main-content');
      if (target) {
        target.innerHTML = chatMod.render ? chatMod.render() : '<p>页面加载中...</p>';
        if (typeof chatMod.init === 'function') chatMod.init();
      }
    } else {
      if (callbacks.onNav) callbacks.onNav('/chat');
    }
  });

  // Event delegation on session list — survives DOM re-renders
  const sessionsContainer = el.querySelector('#sbSessions');
  if (sessionsContainer) {
    sessionsContainer.addEventListener('click', async (e) => {
      const deleteBtn = e.target.closest('.sb-session-delete');
      const sessionItem = e.target.closest('.sb-session-item[data-session-id]');
      if (!sessionItem) return;

      const id = sessionItem.dataset.sessionId;
      if (deleteBtn) {
        e.stopPropagation();
        await deleteSession(id);
      } else {
        await loadSession(id);
      }
    });
  }

  renderSessions();
}

function renderSessions() {
  const list = el?.querySelector('#sbSessions');
  if (!list) return;
  if (state.collapsed) { list.innerHTML = ''; return; }

  const sessions = state.sessions || [];
  if (sessions.length === 0) {
    list.innerHTML = '<div class="sb-session-item" style="opacity:0.5">暂无会话</div>';
    return;
  }

  // Group by time
  const now = Date.now();
  const DAY = 86400000;
  const groups = {};
  const order = ['today', 'yesterday', 'week', 'earlier'];
  const labels = { today: '今天', yesterday: '昨天', week: '近 7 天', earlier: '更早' };

  for (const s of sessions) {
    const age = now - (s.updated || 0);
    let key;
    if (age < DAY) key = 'today';
    else if (age < 2 * DAY) key = 'yesterday';
    else if (age < 7 * DAY) key = 'week';
    else key = 'earlier';
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  }

  let html = '';
  for (const key of order) {
    const items = groups[key];
    if (!items || items.length === 0) continue;
    html += `<div class="sb-session-group"><div class="sb-session-group-label">${labels[key]}</div>`;
    for (const s of items.slice(0, 5)) {
      const isActive = s.id === state.activeId;
      html += `<div class="sb-session-item ${isActive ? 'active' : ''}" data-session-id="${s.id}" title="${escHtml(s.title)}"><span class="sb-session-title">${escHtml(s.title)}</span><button class="sb-session-delete" data-session-id="${s.id}" title="删除">&times;</button></div>`;
    }
    html += '</div>';
  }
  list.innerHTML = html || '<div class="sb-session-item" style="opacity:0.5">暂无会话</div>';
}

// Refresh session list from store (used by app.js and sidebar internal calls)
export async function refreshSessionsFromStore() {
  const store = await import('../store.js');
  const sessions = store.getAllSessions().map(s => ({
    id: s.id,
    title: s.title,
    updated: s.updated,
  }));
  state.sessions = sessions;
  state.activeId = store.getActiveSession()?.id || null;
  if (el) renderSessions();
}

async function loadSession(id) {
  const store = await import('../store.js');
  store.setActive(id);

  // Refresh sidebar session list
  await refreshSessionsFromStore();

  // Navigate to /chat/{id} — the id ensures hashchange fires even if already on /chat
  if (callbacks.onNav) callbacks.onNav(`/chat/${id}`);
}

async function deleteSession(id) {
  if (!confirm('确定删除此会话？')) return;

  const store = await import('../store.js');
  store.deleteSession(id);

  // Ensure at least one session exists
  if (!store.getActiveSession()) {
    store.createSession();
  }

  // Refresh sidebar session list
  await refreshSessionsFromStore();

  // Navigate to current route to re-render
  const hash = window.location.hash.slice(1) || '/chat';
  if (callbacks.onNav) callbacks.onNav(hash);
}

function sidebarHTML() {
  const navItems = NAV_ITEMS.map(n =>
    `<a class="sb-nav-item" data-hash="${n.hash}" href="javascript:void(0)">${n.icon()}<span>${n.label}</span></a>`
  ).join('');

  const nbDot = state.nanobotRunning
    ? '<span class="status-dot green" style="width:8px;height:8px" title="Nanobot 运行中"></span>'
    : '<span class="status-dot gray" style="width:8px;height:8px" title="Nanobot 未启动"></span>';

  const userAvatar = localStorage.getItem('user-avatar') || '';
  const avatarInner = userAvatar
    ? `<img src="${userAvatar}" alt="">`
    : '我';

  return `
    <div class="sb-header">
      <span class="sb-logo">ASR Studio</span>
      <button class="sb-collapse-btn" title="折叠侧边栏">${state.collapsed ? expandIcon() : collapseIcon()}</button>
    </div>
    <button class="sb-new-chat" id="sbNewChat">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span>新对话</span>
    </button>
    <nav class="sb-nav">
      ${navItems}
      <div id="sbSessions"></div>
    </nav>
    <div class="sb-footer">
      <div class="sb-footer-item" id="sbNanobot" style="cursor:pointer" title="Nanobot 记忆管家">
        ${nbDot}<span>Nanobot</span>
      </div>
      <div class="sb-footer-item sb-user-avatar-btn" id="sbUserAvatar" style="cursor:pointer" title="用户设置">
        <div class="avatar sb-avatar-small">${avatarInner}</div><span>设置</span>
      </div>
    </div>
  `;
}

// ── Icons (inline SVG) ──
function svg(path) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`; }
function chatIcon()    { return svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'); }
function uploadIcon()  { return svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'); }
function refineIcon()  { return svg('<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>'); }
function analyzeIcon() { return svg('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'); }
function assIcon()     { return svg('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>'); }
function resultsIcon() { return svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'); }
function configIcon()  { return svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'); }
function healthIcon()  { return svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'); }
function guideIcon()    { return svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>'); }
function scheduleIcon() { return svg('<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'); }
function collapseIcon(){ return svg('<polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/>'); }
function expandIcon()  { return svg('<polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/>'); }

// ── Theme ──
function getCurrentTheme() {
  if (document.documentElement.classList.contains('theme-glass')) return 'theme-glass';
  if (document.documentElement.classList.contains('theme-snow')) return 'theme-snow';
  if (document.documentElement.classList.contains('dark')) return 'dark';
  return '';
}

function applyTheme(key) {
  const html = document.documentElement;
  html.classList.remove('dark', 'theme-snow', 'theme-glass');
  if (key) html.classList.add(key);
  localStorage.setItem('asr-theme', key);
}

// ── Settings Modal ──
function openSettingsModal() {
  settingsOpen = true;
  const userAvatar = localStorage.getItem('user-avatar') || '';
  const aiAvatar = localStorage.getItem('ai-avatar') || '';
  const currentTheme = getCurrentTheme();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'settingsModal';
  overlay.innerHTML = `
    <div class="modal settings-modal">
      <div class="settings-modal-header">
        <h3 style="margin:0">用户设置</h3>
        <button class="settings-close-btn" id="settingsClose">&times;</button>
      </div>
      <div class="settings-modal-body">
        <!-- Theme -->
        <div class="settings-section">
          <label class="settings-label">主题</label>
          <div class="theme-options">
            <button class="theme-option ${currentTheme === '' ? 'active' : ''}" data-theme="">
              <span class="theme-swatch" style="background:#faf9f6;border:1px solid #dbd4c8"></span>
              <span>暖白</span>
            </button>
            <button class="theme-option ${currentTheme === 'dark' ? 'active' : ''}" data-theme="dark">
              <span class="theme-swatch" style="background:#141312;border:1px solid #2e2b28"></span>
              <span>深色</span>
            </button>
            <button class="theme-option ${currentTheme === 'theme-snow' ? 'active' : ''}" data-theme="theme-snow">
              <span class="theme-swatch" style="background:#f8fafc;border:1px solid #cbd5e1"></span>
              <span>雪白</span>
            </button>
            <button class="theme-option ${currentTheme === 'theme-glass' ? 'active' : ''}" data-theme="theme-glass">
              <span class="theme-swatch" style="background:#0a0a0a;border:1px solid rgba(255,255,255,0.2)"></span>
              <span>毛玻璃</span>
            </button>
          </div>
        </div>

        <!-- User Avatar -->
        <div class="settings-section">
          <label class="settings-label">我的头像</label>
          <div class="avatar-input-row">
            <div class="avatar avatar-preview" id="userAvatarPreview">
              ${userAvatar ? `<img src="${userAvatar}" alt="">` : '我'}
            </div>
            <div class="avatar-input-actions">
              <input type="file" id="userAvatarFile" accept="image/*" style="display:none">
              <button class="btn btn-sm btn-secondary" id="userAvatarBtn">选择图片</button>
              ${userAvatar && userAvatar.startsWith('data:') ? '<span class="text-sm text-dim">已上传本地图片</span>' : ''}
            </div>
          </div>
        </div>

        <!-- AI Avatar -->
        <div class="settings-section">
          <label class="settings-label">AI 头像</label>
          <div class="avatar-input-row">
            <div class="avatar avatar-preview avatar--primary" id="aiAvatarPreview">
              ${aiAvatar ? `<img src="${aiAvatar}" alt="">` : 'AI'}
            </div>
            <div class="avatar-input-actions">
              <input type="file" id="aiAvatarFile" accept="image/*" style="display:none">
              <button class="btn btn-sm btn-secondary" id="aiAvatarBtn">选择图片</button>
              ${aiAvatar && aiAvatar.startsWith('data:') ? '<span class="text-sm text-dim">已上传本地图片</span>' : ''}
            </div>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="settingsReset">恢复默认</button>
        <button class="btn btn-primary" id="settingsSave">保存</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close
  overlay.querySelector('#settingsClose')?.addEventListener('click', closeSettingsModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSettingsModal();
  });

  // Theme switch
  overlay.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyTheme(btn.dataset.theme);
    });
  });

  // File picker for avatars — read as base64 data URL
  const pendingAvatars = { user: '', ai: '' };

  overlay.querySelector('#userAvatarBtn')?.addEventListener('click', () => {
    overlay.querySelector('#userAvatarFile')?.click();
  });

  overlay.querySelector('#userAvatarFile')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      pendingAvatars.user = ev.target.result;
      overlay.querySelector('#userAvatarPreview').innerHTML = `<img src="${ev.target.result}" alt="">`;
    };
    reader.readAsDataURL(file);
  });

  overlay.querySelector('#aiAvatarBtn')?.addEventListener('click', () => {
    overlay.querySelector('#aiAvatarFile')?.click();
  });

  overlay.querySelector('#aiAvatarFile')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      pendingAvatars.ai = ev.target.result;
      overlay.querySelector('#aiAvatarPreview').innerHTML = `<img src="${ev.target.result}" alt="">`;
    };
    reader.readAsDataURL(file);
  });

  // Reset to defaults
  overlay.querySelector('#settingsReset')?.addEventListener('click', () => {
    localStorage.removeItem('user-avatar');
    localStorage.removeItem('ai-avatar');
    pendingAvatars.user = '';
    pendingAvatars.ai = '';
    overlay.querySelector('#userAvatarPreview').innerHTML = '我';
    overlay.querySelector('#aiAvatarPreview').innerHTML = 'AI';
  });

  // Save
  overlay.querySelector('#settingsSave')?.addEventListener('click', () => {
    const ua = pendingAvatars.user;
    const aa = pendingAvatars.ai;
    if (ua) localStorage.setItem('user-avatar', ua); else localStorage.removeItem('user-avatar');
    if (aa) localStorage.setItem('ai-avatar', aa); else localStorage.removeItem('ai-avatar');
    closeSettingsModal();
    // Re-render sidebar to update avatar preview
    render();
    // Re-render chat if active to show new avatars
    const hash = window.location.hash.slice(1);
    if (hash === '/chat' || hash.startsWith('/chat')) {
      import('../pages/chat.js').then(mod => {
        const target = document.getElementById('route-content') || document.getElementById('main-content');
        if (target && typeof mod.render === 'function') {
          target.innerHTML = mod.render();
          if (typeof mod.init === 'function') mod.init();
        }
      });
    }
  });

  // Escape key
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettingsModal();
  });
}

function closeSettingsModal() {
  settingsOpen = false;
  document.querySelector('#settingsModal')?.remove();
}

function escapeAttr(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
}
