// Hash-based SPA router — 3-column layout version
import * as Sidebar from './components/sidebar.js';

const routes = {
  '/chat':      { file: 'chat.js',     label: '对话' },
  '/upload':    { file: 'upload.js',   label: '转写' },
  '/results':   { file: 'results.js',  label: '结果' },
  '/ass':       { file: 'ass.js',      label: 'ASS' },
  '/refine':    { file: 'refine.js',   label: '润色' },
  '/analyze':   { file: 'analyze.js',  label: '分析' },
  '/config':    { file: 'config.js',   label: '配置' },
  '/health':    { file: 'health.js',   label: '状态' },
  '/guide':     { file: 'guide.js',    label: '指南' },
  '/schedule':  { file: 'schedule.js', label: '课程表' },
};

let currentCleanup = null;
let mainContent = null;
let currentPath = '';

export function getCurrentRoute() {
  const hash = window.location.hash.slice(1) || '/chat';
  if (hash.startsWith('/chat/')) return '/chat';
  return routes[hash] ? hash : '/chat';
}

export async function navigate(path) {
  window.location.hash = path;
}

export async function resolveRoute() {
  const hash = getCurrentRoute();
  const route = routes[hash];
  if (!route) return;

  // Update sidebar highlight
  Sidebar.setActive(hash);

  // Chat page: always re-render (session may have changed)
  if (hash === '/chat') {
    const mod = await import(`./pages/${route.file}`);
    const target = mainContent || document.getElementById('route-content') || document.getElementById('main-content');
    if (!target) return;
    target.innerHTML = mod.render ? mod.render() : '<p>页面加载中...</p>';
    if (typeof mod.init === 'function') {
      const cleanup = mod.init();
      if (typeof cleanup === 'function') currentCleanup = cleanup;
    }
    currentPath = hash;
    return;
  }

  // Skip if same route (avoid flicker)
  if (hash === currentPath) return;
  currentPath = hash;

  // Run cleanup from previous page
  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch (e) { console.warn('cleanup error', e); }
    currentCleanup = null;
  }

  // Update sidebar highlight
  Sidebar.setActive(hash);

  const target = mainContent || document.getElementById('route-content') || document.getElementById('main-content');
  if (!target) return;

  try {
    const mod = await import(`./pages/${route.file}`);
    target.innerHTML = mod.render ? mod.render() : '<p>页面加载中...</p>';
    if (typeof mod.init === 'function') {
      const cleanup = mod.init();
      if (typeof cleanup === 'function') currentCleanup = cleanup;
    }
  } catch (err) {
    console.error('Route error:', err);
    target.innerHTML = `<div class="card"><div class="empty-state"><h3>页面加载失败</h3><p>${err.message}</p></div></div>`;
  }
}

export function initRouter() {
  mainContent = document.getElementById('route-content') || document.getElementById('main-content');
  window.addEventListener('hashchange', resolveRoute);
  resolveRoute();
}

// Export for post-render injection
let postRenderOnPage = null;
window.__postRender = (fn) => { postRenderOnPage = fn; };
