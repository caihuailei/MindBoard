// Shared UI utilities

export function toast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

export function formatDuration(sec) {
  if (!sec || sec <= 0) return '00:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

export function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function formatFileSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/(1024*1024)).toFixed(1) + ' MB';
}

export function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('已复制', 'success'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制', 'success');
  }
}

export function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function statusBadge(status) {
  const map = {
    queued: 'badge-queued',
    uploading: 'badge-queued',
    downloaded: 'badge-queued',
    transcribing: 'badge-transcribing',
    merging: 'badge-transcribing',
    completed: 'badge-completed',
    error: 'badge-error',
  };
  const labels = {
    queued: '排队中',
    uploading: '上传中',
    downloaded: '已下载',
    transcribing: '转写中',
    merging: '合并中',
    completed: '已完成',
    error: '出错',
  };
  return `<span class="badge ${map[status] || 'badge-queued'}">${labels[status] || status}</span>`;
}

export function showModal(title, bodyHtml, actions) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${title}</h3>
      <div>${bodyHtml}</div>
      <div class="modal-actions">${(actions || []).map(a =>
        `<button class="btn btn-${a.type || 'secondary'} btn-sm" data-action="${a.key}">${a.label}</button>`
      ).join('')}</div>
    </div>`;
  document.body.appendChild(overlay);

  return new Promise((resolve) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(null); }
    });
    if (actions) {
      overlay.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          overlay.remove();
          resolve(btn.dataset.action);
        });
      });
    }
  });
}

// Format ASS timestamp
export function fmtAssTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2,'0')}:${s.toFixed(2).padStart(5,'0')}`;
}
