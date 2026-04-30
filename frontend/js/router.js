// Hash-based SPA router

const routes = {
  '/upload':  { file: 'upload.js',  label: '上传' },
  '/results': { file: 'results.js', label: '结果' },
  '/ass':     { file: 'ass.js',     label: 'ASS' },
  '/refine':  { file: 'refine.js',  label: '润色' },
  '/config':  { file: 'config.js',  label: '配置' },
  '/health':  { file: 'health.js',  label: '状态' },
  '/guide':   { file: 'guide.js',   label: '指南' },
};

let currentCleanup = null;

export function getCurrentRoute() {
  const hash = window.location.hash.slice(1) || '/upload';
  return routes[hash] ? hash : '/upload';
}

export async function navigate(path) {
  window.location.hash = path;
}

export async function resolveRoute() {
  const hash = getCurrentRoute();
  const route = routes[hash];

  // Run cleanup from previous page
  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch (e) { console.warn('cleanup error', e); }
    currentCleanup = null;
  }

  // Update nav highlight
  document.querySelectorAll('.nav-item').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === '#/upload' && hash === '/upload');
  });
  document.querySelectorAll('.nav-item').forEach(a => {
    if (hash !== '/upload') {
      a.classList.toggle('active', a.getAttribute('href') === '#' + hash);
    }
  });
  // Special case for /upload default
  if (hash === '/upload') {
    const el = document.querySelector('.nav-item[href="#/upload"]');
    if (el) el.classList.add('active');
  }

  const app = document.getElementById('app');
  try {
    const mod = await import(`./pages/${route.file}`);
    app.innerHTML = mod.render ? mod.render() : '<p>页面加载中...</p>';
    if (typeof mod.init === 'function') {
      const cleanup = mod.init();
      if (typeof cleanup === 'function') currentCleanup = cleanup;
    }
  } catch (err) {
    console.error('Route error:', err);
    app.innerHTML = `<div class="card"><div class="empty-state"><h3>页面加载失败</h3><p>${err.message}</p></div></div>`;
  }
}

export function initRouter() {
  window.addEventListener('hashchange', resolveRoute);
  resolveRoute();
}
