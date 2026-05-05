// Course schedule page
import { toast } from '../ui.js';

const SCHEDULE_KEY = 'asr_schedule';
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function loadSchedule() {
  try {
    const raw = localStorage.getItem(SCHEDULE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSchedule(entries) {
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify(entries));
}

export function render() {
  const entries = loadSchedule();
  return `
    <div class="schedule-page">
      <div class="schedule-header">
        <h2>课程表</h2>
        <button class="btn btn-primary" id="addCourseBtn">+ 添加课程</button>
      </div>
      <div class="schedule-table-wrap">
        <table class="schedule-table" id="scheduleTable">
          <thead>
            <tr>
              <th>时间</th>
              ${DAYS.map(d => `<th>${d}</th>`).join('')}
            </tr>
          </thead>
          <tbody id="scheduleBody"></tbody>
        </table>
      </div>
    </div>
  `;
}

export function init() {
  document.getElementById('addCourseBtn')?.addEventListener('click', () => openCourseEditor());
  renderTable();

  // Edit/delete buttons via delegation
  document.getElementById('scheduleBody')?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.schedule-edit');
    const deleteBtn = e.target.closest('.schedule-delete');
    if (editBtn) openCourseEditor(editBtn.dataset.id);
    if (deleteBtn) deleteCourse(deleteBtn.dataset.id);
  });
}

function renderTable() {
  const tbody = document.getElementById('scheduleBody');
  if (!tbody) return;
  const entries = loadSchedule();

  // Build time slots from entries + defaults
  const timeSlots = new Set();
  const defaultSlots = ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
  for (const t of defaultSlots) timeSlots.add(t);
  for (const e of entries) timeSlots.add(e.start);

  const sortedSlots = [...timeSlots].sort();

  const today = new Date().getDay(); // 0=Sun, 1=Mon...
  const todayIdx = today === 0 ? 7 : today; // 1=Mon...7=Sun

  let html = '';
  for (const slot of sortedSlots) {
    html += '<tr>';
    html += `<td class="schedule-time">${slot}</td>`;
    for (let d = 1; d <= 7; d++) {
      const cell = entries.filter(e => e.day === d && e.start === slot);
      const isToday = d === todayIdx;
      html += `<td class="schedule-cell ${isToday ? 'schedule-today' : ''}">`;
      for (const c of cell) {
        html += `
          <div class="schedule-card" data-id="${c.id}">
            <div class="schedule-card-subject">${esc(c.subject)}</div>
            <div class="schedule-card-info">${esc(c.room || '')}${c.room && c.teacher ? ' · ' : ''}${esc(c.teacher || '')}</div>
            <div class="schedule-card-actions">
              <button class="schedule-edit" data-id="${c.id}" title="编辑">✏️</button>
              <button class="schedule-delete" data-id="${c.id}" title="删除">&times;</button>
            </div>
          </div>`;
      }
      html += '</td>';
    }
    html += '</tr>';
  }
  tbody.innerHTML = html || '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--muted-fg)">暂无课程，点击右上角添加</td></tr>';
}

function openCourseEditor(id) {
  const entries = loadSchedule();
  const existing = id ? entries.find(e => e.id === id) : null;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${existing ? '编辑课程' : '添加课程'}</h3>
      <form id="courseForm" style="display:flex;flex-direction:column;gap:12px;">
        <label>课程名称 <input required id="cfSubject" value="${existing ? esc(existing.subject) : ''}" placeholder="高等数学"></label>
        <label>星期
          <select id="cfDay">
            ${DAYS.map((d, i) => `<option value="${i + 1}" ${existing && existing.day === i + 1 ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
        </label>
        <label>开始时间 <input type="time" required id="cfStart" value="${existing ? existing.start : '08:00'}"></label>
        <label>结束时间 <input type="time" required id="cfEnd" value="${existing ? existing.end : '09:40'}"></label>
        <label>教室 <input id="cfRoom" value="${existing ? esc(existing.room || '') : ''}" placeholder="A101"></label>
        <label>教师 <input id="cfTeacher" value="${existing ? esc(existing.teacher || '') : ''}" placeholder="张教授"></label>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cfCancel">取消</button>
          <button type="submit" class="btn btn-primary">${existing ? '保存' : '添加'}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#cfCancel')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#courseForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const entry = {
      id: existing?.id || ('c_' + Date.now()),
      subject: document.getElementById('cfSubject').value.trim(),
      day: parseInt(document.getElementById('cfDay').value),
      start: document.getElementById('cfStart').value,
      end: document.getElementById('cfEnd').value,
      room: document.getElementById('cfRoom').value.trim(),
      teacher: document.getElementById('cfTeacher').value.trim(),
    };
    if (!entry.subject) { toast('请输入课程名称', 'error'); return; }

    if (existing) {
      const idx = entries.findIndex(e => e.id === id);
      if (idx >= 0) entries[idx] = entry;
    } else {
      entries.push(entry);
      // Auto-create tutor for new course
      createTutorForCourse(entry.subject);
    }
    saveSchedule(entries);
    overlay.remove();
    renderTable();
    toast(existing ? '已更新' : '已添加' + (!existing ? '（导师已自动创建）' : ''), 'success');
  });
}

function deleteCourse(id) {
  if (!confirm('确定删除此课程？')) return;
  const entries = loadSchedule();
  saveSchedule(entries.filter(e => e.id !== id));
  renderTable();
  toast('已删除', 'success');
}

function esc(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
}

async function createTutorForCourse(subject) {
  const { API } = await import('../api.js');
  if (!API?.nanobotCreateTutor) return;

  // Create with default soul immediately
  const defaultSoul = `你是一名${subject}课程导师，擅长用清晰易懂的方式讲解相关知识。回答时请结合实际例子，语言简洁专业。`;
  try {
    await API.nanobotCreateTutor(subject, defaultSoul);
  } catch {
    // Tutor may already exist — non-critical
  }

  // Async: generate better SOUL.md via LLM and update
  try {
    const config = loadLlmConfig();
    if (!config?.api_url || !config?.api_key) return;

    const prompt = `请为课程"${subject}"生成一段导师人设（150字以内），包含：学科定位、教学风格和回答规范。只输出人设正文，不要标题或格式。`;
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: '你是一名教育专家，擅长为各学科课程设计AI导师人设。' },
          { role: 'user', content: prompt },
        ],
        model: config.model_name,
        temperature: 0.7,
        api_url: config.api_url,
        api_key: config.api_key,
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const soul = data.choices?.[0]?.message?.content?.trim();
    if (soul) {
      await API.nanobotSetTutorSoul(subject, soul);
    }
  } catch {
    // Non-critical: default soul is already serviceable
  }
}

function loadLlmConfig() {
  try {
    const active = localStorage.getItem('asr_llm_config_active') || 'sensenova';
    const saved = JSON.parse(localStorage.getItem('asr_llm_config_' + active) || '{}');
    const presets = {
      sensenova:  { url: 'https://token.sensenova.cn/v1', model: 'deepseek-v4-flash' },
      deepseek:   { url: 'https://api.deepseek.com', model: 'deepseek-chat' },
      openai:     { url: 'https://api.openai.com/v1', model: 'gpt-4o' },
      modelscope: { url: 'https://api-inference.modelscope.cn/v1', model: 'ZhipuAI/GLM-5' },
      ollama:     { url: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
      nanobot:    { url: 'http://127.0.0.1:18900/v1', model: 'nanobot' },
    };
    const p = presets[active] || {};
    return {
      api_url: saved.api_url || p.url || '',
      api_key: saved.api_key || '',
      model_name: saved.model_name || p.model || '',
    };
  } catch { return {}; }
}
