// Health / Status page
import { API } from '../api.js';
import { formatDuration, formatDate } from '../ui.js';
import { navigate } from '../router.js';

let healthInterval = null;

export function render() {
  return `
    <div class="card">
      <h2>服务器状态</h2>
      <div id="healthContent">
        <div class="text-center" style="text-align:center;padding:20px"><div class="spinner" style="margin:0 auto"></div></div>
      </div>
      <div class="btn-group mt-8">
        <button class="btn btn-secondary btn-sm" id="refreshHealthBtn">刷新</button>
        <span id="healthLastUpdate" class="text-sm text-dim"></span>
      </div>
    </div>

    <div class="card">
      <h2>活跃任务</h2>
      <div id="activeTasks"><div class="text-sm text-dim">暂无活跃任务</div></div>
    </div>
  `;
}

export function init() {
  loadHealth();
  loadActiveTasks();
  healthInterval = setInterval(() => {
    loadHealth();
    loadActiveTasks();
  }, 30000);

  document.getElementById('refreshHealthBtn').addEventListener('click', () => {
    loadHealth();
    loadActiveTasks();
  });

  return () => {
    if (healthInterval) clearInterval(healthInterval);
  };
}

async function loadHealth() {
  const container = document.getElementById('healthContent');
  try {
    const h = await API.health();
    container.innerHTML = `
      <div class="health-grid">
        <div class="health-item">
          <div class="label">服务器状态</div>
          <div class="value" style="color:var(--success)">正常</div>
        </div>
        <div class="health-item">
          <div class="label">设备</div>
          <div class="value">${h.device || '-'}</div>
        </div>
        <div class="health-item">
          <div class="label">GPU</div>
          <div class="value">${h.gpu || '-'}</div>
        </div>
        <div class="health-item">
          <div class="label">模型已加载</div>
          <div class="value">${h.model_loaded ? '是' : '否'}</div>
        </div>
      </div>`;
    document.getElementById('healthLastUpdate').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN');
  } catch (e) {
    container.innerHTML = `
      <div class="health-grid">
        <div class="health-item">
          <div class="label">服务器状态</div>
          <div class="value" style="color:var(--error)">无法连接</div>
        </div>
      </div>
      <div class="text-sm mt-8" style="color:var(--error)">${e.message}</div>`;
  }
}

async function loadActiveTasks() {
  const container = document.getElementById('activeTasks');
  try {
    const list = await API.transcribeList();
    const active = list.active || {};

    if (Object.keys(active).length === 0) {
      container.innerHTML = '<div class="text-sm text-dim">暂无活跃任务</div>';
      return;
    }

    container.innerHTML = Object.entries(active).map(([fid, info]) =>
      `<div class="queue-item" style="padding:8px 12px">
        <div class="info">
          <div class="name text-mono">${fid}</div>
          <div class="meta">状态: ${info.status} · 块: ${info.chunks_done || 0} · 时长: ${formatDuration(info.total_duration || 0)}</div>
        </div>
        <span class="badge badge-${info.status === 'completed' ? 'completed' : 'transcribing'}">${info.status}</span>
      </div>`
    ).join('');
  } catch {
    // Silent
  }
}
