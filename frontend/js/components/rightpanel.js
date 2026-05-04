// Right panel — real-time job status via WebSocket + hardware monitor
let el = null;
const jobs = new Map();   // job_id -> { type, filename, progress, status }
const completed = [];     // recent completed (max 10)
const errors = [];        // recent errors (max 5)
let visible = true;
let hwExpanded = false;
let hwMetrics = null;
let hwPollTimer = null;

export function mount(container) {
  el = container;
  console.log('[RP] Mounted, element:', container.id, 'visible:', visible);
  render();
  startHwPolling();
}

export function toggle() {
  visible = !visible;
  if (el) {
    el.classList.toggle('collapsed', !visible);
  }
}

export function isVisible() { return visible; }

// Called by WebSocket event handler
export function handleEvent(event) {
  const { type, data } = event;
  switch (type) {
    case 'job:started':
      jobs.set(data.job_id, { ...data, progress: 0, status: 'running' });
      break;
    case 'job:progress': {
      const job = jobs.get(data.job_id);
      if (job) {
        job.progress = data.progress ?? job.progress;
        if (data.step) job.step = data.step;
      }
      break;
    }
    case 'job:completed':
      jobs.delete(data.job_id);
      completed.unshift({ ...data, status: 'completed', ts: Date.now() });
      if (completed.length > 10) completed.pop();
      break;
    case 'job:failed':
      jobs.delete(data.job_id);
      errors.unshift({ ...data, status: 'failed', ts: Date.now() });
      if (errors.length > 5) errors.pop();
      break;
  }
  render();
}

export function requestSnapshot() {
  if (typeof API?.listResults === 'function') {
    API.listResults().then(results => {
      for (const r of (results || [])) {
        if (!jobs.has(r.file_id)) {
          jobs.set(r.file_id, { type: r.type || 'transcribe', filename: r.filename || r.file_id, progress: 100, status: 'completed' });
        }
      }
      render();
    }).catch(() => {});
  }
}

function startHwPolling() {
  stopHwPolling();
  fetchHwMetrics();
  hwPollTimer = setInterval(fetchHwMetrics, 3000);
}

function stopHwPolling() {
  if (hwPollTimer) { clearInterval(hwPollTimer); hwPollTimer = null; }
}

async function fetchHwMetrics() {
  try {
    if (typeof API === 'undefined' || !API.getSystemMetrics) {
      console.warn('[RP] API.getSystemMetrics not available');
      return;
    }
    const m = await API.getSystemMetrics();
    hwMetrics = m;
    render();
  } catch (e) {
    console.error('[RP] fetchHwMetrics failed:', e.message);
  }
}

function render() {
  if (!el) return;
  if (!visible) { el.innerHTML = ''; return; }

  const runningJobs = [...jobs.values()];
  const runningHTML = runningJobs.length === 0
    ? '<div class="rp-empty"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;margin-bottom:8px"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg><div>没有运行中的任务</div></div>'
    : runningJobs.map(j => {
        const statusBadge = j.progress >= 100
          ? '<span class="badge-pill badge-pill--success">完成</span>'
          : j.progress > 0
            ? '<span class="badge-pill badge-pill--info">进行中</span>'
            : '<span class="badge-pill badge-pill--warning">排队中</span>';
        return `
        <div class="rp-job animate-smooth-fade-in">
          <div class="rp-job-name">${j.filename || j.job_id}</div>
          <div class="rp-job-meta">
            ${j.type} ${statusBadge}
            ${j.step ? ' · ' + j.step : ''}
          </div>
          <div class="rp-job-bar"><div class="rp-job-bar-fill" style="width:${j.progress ?? 0}%"></div></div>
          ${j.progress >= 100 ? '<div class="rp-job-meta" style="color:var(--success)">处理完成</div>' : ''}
        </div>
      `;
      }).join('');

  const completedHTML = completed.length === 0
    ? ''
    : `<div class="rp-section"><div class="rp-section-title">最近完成</div>`
      + completed.slice(0, 5).map(j => `
        <div class="rp-job">
          <div class="rp-job-name">${j.filename || j.job_id}</div>
          <div class="rp-job-meta">
            <span class="badge-pill badge-pill--success">完成</span>
            ${j.type} · ${timeAgo(j.ts)}
          </div>
        </div>
      `).join('') + '</div>';

  const errorsHTML = errors.length === 0
    ? ''
    : `<div class="rp-section"><div class="rp-section-title">错误</div>`
      + errors.map(j => `
        <div class="rp-job" style="border-color:var(--error)">
          <div class="rp-job-name">${j.filename || j.job_id}</div>
          <div class="rp-job-meta">
            <span class="badge-pill badge-pill--error">失败</span>
            ${j.error || '未知错误'} · ${timeAgo(j.ts)}
          </div>
        </div>
      `).join('') + '</div>';

  // Hardware monitor dropdown
  const hwHTML = renderHardwareMonitor();

  // Course schedule
  const scheduleHTML = renderSchedule();

  el.innerHTML = `
    <div class="rp-header">
      <span class="rp-title">工作流</span>
      <button class="rp-close" id="rpClose" title="关闭面板">✕</button>
    </div>
    ${hwHTML}
    ${scheduleHTML}
    <div class="rp-section">
      <div class="rp-section-title">运行中 (${runningJobs.length})</div>
      ${runningHTML}
    </div>
    ${completedHTML}
    ${errorsHTML}
  `;

  el.querySelector('#rpClose')?.addEventListener('click', () => toggle());
  el.querySelector('#rpHwToggle')?.addEventListener('click', () => {
    hwExpanded = !hwExpanded;
    render();
  });
}

function renderHardwareMonitor() {
  const m = hwMetrics;
  if (!m) {
    return `
    <div class="rp-section rp-hw-section">
      <div class="rp-hw-toggle" id="rpHwToggle">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        硬件监控
        <span class="rp-hw-chevron">加载中...</span>
      </div>
    </div>`;
  }

  const chevron = hwExpanded ? '▼' : '▶';

  // CPU gauge
  const cpuPct = m.cpu?.percent ?? 0;
  const cpuColor = gaugeColor(cpuPct);
  const cpuGauge = gaugeSVG(cpuPct, cpuColor, 52);

  // Memory gauge
  const memPct = m.memory?.percent ?? 0;
  const memColor = gaugeColor(memPct);
  const memGauge = gaugeSVG(memPct, memColor, 52);
  const memUsed = m.memory?.used_gb ?? 0;
  const memTotal = m.memory?.total_gb ?? 0;

  // Process memory
  const procMem = m.process?.memory_mb ?? 0;

  // GPU gauge
  const gpu = m.gpu;
  let gpuHTML = '';
  if (gpu) {
    const gpuUtil = gpu.utilization ?? 0;
    const gpuColor = gaugeColor(gpuUtil);
    const gpuGauge = gaugeSVG(gpuUtil, gpuColor, 52);
    const gpuMemUsed = gpu.memory_used_mb ?? 0;
    const gpuMemTotal = gpu.memory_total_mb ?? 0;
    const gpuMemPct = gpuMemTotal > 0 ? Math.round(gpuMemUsed / gpuMemTotal * 100) : 0;
    const gpuTemp = gpu.temperature != null ? `${gpu.temperature}°C` : '--';

    gpuHTML = `
    <div class="rp-hw-item">
      <div class="rp-hw-gauge">${gpuGauge}</div>
      <div class="rp-hw-info">
        <div class="rp-hw-name">${truncate(gpu.name, 20)}</div>
        <div class="rp-hw-row">
          <span>占用</span><span class="rp-hw-val" style="color:${gpuColor}">${gpuUtil}%</span>
        </div>
        <div class="rp-hw-row">
          <span>显存</span><span class="rp-hw-val">${gpuMemUsed}/${gpuMemTotal}MB</span>
        </div>
        <div class="rp-hw-row">
          <span>温度</span><span class="rp-hw-val">${gpuTemp}</span>
        </div>
      </div>
    </div>`;
  }

  const expandedHTML = hwExpanded ? `
    <div class="rp-hw-expanded">
      <div class="rp-hw-item">
        <div class="rp-hw-gauge">${cpuGauge}</div>
        <div class="rp-hw-info">
          <div class="rp-hw-name">CPU</div>
          <div class="rp-hw-row">
            <span>占用</span><span class="rp-hw-val" style="color:${cpuColor}">${cpuPct}%</span>
          </div>
          <div class="rp-hw-row">
            <span>核心</span><span class="rp-hw-val">${m.cpu?.logical_cores ?? 0}</span>
          </div>
        </div>
      </div>
      <div class="rp-hw-item">
        <div class="rp-hw-gauge">${memGauge}</div>
        <div class="rp-hw-info">
          <div class="rp-hw-name">内存</div>
          <div class="rp-hw-row">
            <span>占用</span><span class="rp-hw-val" style="color:${memColor}">${memPct}%</span>
          </div>
          <div class="rp-hw-row">
            <span>用量</span><span class="rp-hw-val">${memUsed}/${memTotal} GB</span>
          </div>
          <div class="rp-hw-row">
            <span>进程</span><span class="rp-hw-val">${procMem} MB</span>
          </div>
        </div>
      </div>
      ${gpuHTML}
    </div>
  ` : '';

  return `
  <div class="rp-section rp-hw-section">
    <div class="rp-hw-toggle" id="rpHwToggle">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      硬件监控 <span class="rp-hw-chevron">${chevron}</span>
    </div>
    ${expandedHTML}
  </div>`;
}

function gaugeSVG(pct, color, size) {
  const r = (size - 6) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="4" opacity="0.3"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="4"
      stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
      stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})" style="transition:stroke-dashoffset 0.5s ease"/>
    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
      style="font-size:11px;font-weight:600;fill:var(--foreground)">${pct}%</text>
  </svg>`;
}

function gaugeColor(pct) {
  if (pct >= 85) return 'var(--error)';
  if (pct >= 60) return 'var(--warning, #f59e0b)';
  return 'var(--success)';
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '...' : s;
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  return Math.floor(diff / 3600) + ' 小时前';
}

// ── Course schedule in right panel ──

function renderSchedule() {
  let entries = [];
  try {
    entries = JSON.parse(localStorage.getItem('asr_schedule') || '[]');
  } catch { return ''; }

  if (!entries.length) return '';

  const today = new Date().getDay();
  const todayIdx = today === 0 ? 7 : today;
  const dayNames = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };

  const todayEntries = entries.filter(e => e.day === todayIdx).sort((a, b) => a.start.localeCompare(b.start));
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const upcoming = todayEntries.filter(e => {
    const [h, m] = e.start.split(':').map(Number);
    return h * 60 + m > nowMin;
  });

  let html = `<div class="rp-section rp-schedule"><div class="rp-section-title">📅 今天 (${dayNames[todayIdx] || '今天'})</div>`;

  if (todayEntries.length === 0) {
    html += '<div class="rp-schedule-empty">今天没有课程</div>';
  } else {
    for (const c of todayEntries) {
      const isCurrent = todayEntries.indexOf(c) >= 0 && c.start.replace(':', '') <= String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') && c.end.replace(':', '') >= String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
      html += `<div class="rp-schedule-item ${isCurrent ? 'active' : ''}">
        <span class="rp-schedule-time">${c.start}-${c.end}</span>
        <span class="rp-schedule-subject">${esc(c.subject)}</span>
        ${c.room ? `<span class="rp-schedule-room">${esc(c.room)}</span>` : ''}
      </div>`;
    }
  }

  // Next class
  if (upcoming.length > 0) {
    const next = upcoming[0];
    html += `<div class="rp-schedule-next">下一节: ${esc(next.subject)} ${next.start} 开始</div>`;
  }

  html += '</div>';
  return html;
}

function esc(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
}
