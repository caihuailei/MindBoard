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

    // Always delegate to router — router handles hashchange and re-render cleanly
    if (callbacks.onNav) callbacks.onNav('/chat');
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
  if (document.documentElement.classList.contains('warm-paper')) return 'warm-paper';
  if (document.documentElement.classList.contains('theme-glass')) return 'theme-glass';
  if (document.documentElement.classList.contains('theme-snow')) return 'theme-snow';
  if (document.documentElement.classList.contains('dark')) return 'dark';
  return '';
}

function applyTheme(key) {
  const html = document.documentElement;
  html.classList.remove('dark', 'theme-snow', 'theme-glass', 'warm-paper');
  if (key) html.classList.add(key);
  localStorage.setItem('asr-theme', key);
}

// ── Settings Modal ──
function openSettingsModal() {
  settingsOpen = true;
  const userAvatar = localStorage.getItem('user-avatar') || '';
  const aiAvatar = localStorage.getItem('ai-avatar') || '';
  const currentTheme = getCurrentTheme();
  const pendingAvatars = { user: '', ai: '' };
  let activeTab = 'appearance';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'settingsModal';
  overlay.innerHTML = `
    <div class="modal settings-modal">
      <div class="settings-modal-header">
        <h3 style="margin:0">用户设置</h3>
        <button class="settings-close-btn" id="settingsClose">&times;</button>
      </div>
      <div class="settings-body">
        <!-- Left Nav -->
        <nav class="settings-nav" id="settingsNav">
          <button class="settings-nav-item active" data-tab="appearance">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
            外观
          </button>
          <button class="settings-nav-item" data-tab="avatars">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            头像
          </button>
          <button class="settings-nav-item" data-tab="hooks">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            钩子
          </button>
          <button class="settings-nav-item" data-tab="skills">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            技能
          </button>
          <button class="settings-nav-item" data-tab="about">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            关于
          </button>
        </nav>

        <!-- Right Content -->
        <div class="settings-content">
          <!-- Appearance Panel -->
          <div class="settings-panel active" id="panel-appearance">
            <div class="settings-section">
              <div class="settings-section-title">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
                主题
              </div>
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
                <button class="theme-option ${currentTheme === 'warm-paper' ? 'active' : ''}" data-theme="warm-paper">
                  <span class="theme-swatch" style="background:#F5EFE4;border:1px solid #D8CFBE"></span>
                  <span>暖纸</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Avatars Panel -->
          <div class="settings-panel" id="panel-avatars">
            <div class="settings-section">
              <div class="settings-section-title">我的头像</div>
              <div class="avatar-input-row">
                <div class="avatar-upload-wrap" id="userAvatarUpload">
                  <div class="avatar avatar-preview" id="userAvatarPreview">
                    ${userAvatar ? `<img src="${userAvatar}" alt="">` : '我'}
                  </div>
                  <div class="avatar-upload-overlay">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  </div>
                </div>
                <div class="avatar-input-actions" style="flex:1">
                  <input type="file" id="userAvatarFile" accept="image/*" style="display:none">
                  <div style="flex:1">
                    <div class="settings-hint">${userAvatar && userAvatar.startsWith('data:') ? '已上传本地图片' : '点击左侧头像更换'}</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-section-title">AI 头像</div>
              <div class="avatar-input-row">
                <div class="avatar-upload-wrap" id="aiAvatarUpload">
                  <div class="avatar avatar-preview avatar--primary" id="aiAvatarPreview">
                    ${aiAvatar ? `<img src="${aiAvatar}" alt="">` : 'AI'}
                  </div>
                  <div class="avatar-upload-overlay">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  </div>
                </div>
                <div class="avatar-input-actions" style="flex:1">
                  <input type="file" id="aiAvatarFile" accept="image/*" style="display:none">
                  <div style="flex:1">
                    <div class="settings-hint">${aiAvatar && aiAvatar.startsWith('data:') ? '已上传本地图片' : '点击左侧头像更换'}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Hooks Panel -->
          <div class="settings-panel" id="panel-hooks">
            <div class="settings-section">
              <div class="settings-section-title">已注册的钩子</div>
              <div id="hooksList">
                <div class="hook-card">
                  <div>
                    <div class="hook-name">消息后处理</div>
                    <div class="hook-desc">在收到 AI 回复后自动提取关键信息</div>
                  </div>
                  <button class="hana-toggle on" data-hook="postMessage"></button>
                </div>
                <div class="hook-card">
                  <div>
                    <div class="hook-name">输入预处理</div>
                    <div class="hook-desc">发送前自动格式化用户输入</div>
                  </div>
                  <button class="hana-toggle" data-hook="preInput"></button>
                </div>
              </div>
              <div class="settings-hint" style="margin-top:12px">钩子功能需要后端 API 支持，当前为 UI 占位。</div>
            </div>
          </div>

          <!-- Skills Panel -->
          <div class="settings-panel" id="panel-skills">
            <div class="settings-section">
              <div class="settings-section-title">可用技能</div>
              <div id="skillsList">
                <div class="skill-card">
                  <div>
                    <div class="skill-name">文本润色</div>
                    <div class="skill-desc">优化文字表达，提升可读性</div>
                  </div>
                  <button class="hana-toggle on" data-skill="refine"></button>
                </div>
                <div class="skill-card">
                  <div>
                    <div class="skill-name">内容摘要</div>
                    <div class="skill-desc">提取核心要点，生成简洁摘要</div>
                  </div>
                  <button class="hana-toggle on" data-skill="summarize"></button>
                </div>
                <div class="skill-card">
                  <div>
                    <div class="skill-name">翻译</div>
                    <div class="skill-desc">多语言互译，保持语义准确</div>
                  </div>
                  <button class="hana-toggle on" data-skill="translate"></button>
                </div>
                <div class="skill-card">
                  <div>
                    <div class="skill-name">代码分析</div>
                    <div class="skill-desc">审查代码逻辑，发现潜在问题</div>
                  </div>
                  <button class="hana-toggle" data-skill="codeReview"></button>
                </div>
              </div>
              <div class="settings-hint" style="margin-top:12px">技能可通过后端 API 动态安装，当前为预设列表。</div>
            </div>
          </div>

          <!-- About Panel -->
          <div class="settings-panel" id="panel-about">
            <div class="settings-section">
              <div class="about-version">ASR Studio v0.125</div>
              <div class="settings-hint">基于 ASR 语音识别的多模态工作台</div>
            </div>
            <div class="settings-section">
              <div class="settings-section-title">快捷键</div>
              <div class="about-shortcut"><span>发送消息</span><kbd>Enter</kbd></div>
              <div class="about-shortcut"><span>换行</span><kbd>Shift + Enter</kbd></div>
              <div class="about-shortcut"><span>停止生成</span><kbd>Escape</kbd></div>
              <div class="about-shortcut"><span>关闭弹窗</span><kbd>Escape</kbd></div>
              <div class="about-shortcut"><span>新对话</span><kbd>Ctrl + N</kbd></div>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-modal-footer">
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

  // Tab navigation
  overlay.querySelectorAll('.settings-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      overlay.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      overlay.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
      overlay.querySelector(`#panel-${activeTab}`)?.classList.add('active');
    });
  });

  // Theme switch
  overlay.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyTheme(btn.dataset.theme);
    });
  });

  // Avatar file pickers with camera hover
  overlay.querySelector('#userAvatarUpload')?.addEventListener('click', () => {
    overlay.querySelector('#userAvatarFile')?.click();
  });

  overlay.querySelector('#userAvatarFile')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      pendingAvatars.user = ev.target.result;
      overlay.querySelector('#userAvatarPreview').innerHTML = `<img src="${ev.target.result}" alt="">`;
      const hintEl = overlay.querySelector('#userAvatarUpload').closest('.settings-section').querySelector('.settings-hint');
      if (hintEl) hintEl.textContent = '已上传本地图片';
    };
    reader.readAsDataURL(file);
  });

  overlay.querySelector('#aiAvatarUpload')?.addEventListener('click', () => {
    overlay.querySelector('#aiAvatarFile')?.click();
  });

  overlay.querySelector('#aiAvatarFile')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      pendingAvatars.ai = ev.target.result;
      overlay.querySelector('#aiAvatarPreview').innerHTML = `<img src="${ev.target.result}" alt="">`;
      const hintEl = overlay.querySelector('#aiAvatarUpload').closest('.settings-section').querySelector('.settings-hint');
      if (hintEl) hintEl.textContent = '已上传本地图片';
    };
    reader.readAsDataURL(file);
  });

  // Toggle switches
  overlay.querySelectorAll('.hana-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('on');
    });
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
    render();
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
