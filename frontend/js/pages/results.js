// Results page — completed transcription history
import { toast, copyToClipboard, downloadText, formatDuration, formatDate } from '../ui.js';
import { navigate } from '../router.js';
import { API } from '../api.js';

export function render() {
  return `
    <div class="card">
      <h2>转写结果</h2>
      <div id="resultsList"></div>
      <div class="btn-group">
        <button class="btn btn-danger btn-sm" id="clearResultsBtn">清空全部</button>
      </div>
    </div>
  `;
}

export function init() {
  renderResults();

  // 从服务端拉取持久化结果，合并到本地
  mergeServerResults();

  document.getElementById('clearResultsBtn').addEventListener('click', () => {
    if (confirm('确定清空所有转写结果？')) {
      // Delete all server results too
      const local = JSON.parse(localStorage.getItem('asr_results') || '[]');
      // Track all as deleted
      const deletedIds = new Set(JSON.parse(localStorage.getItem('asr_deleted_ids') || '[]'));
      const deletes = local.map(r => r.id).filter(Boolean).map(id => {
        deletedIds.add(id);
        return API.deleteResult(id).catch(() => {});
      });
      localStorage.setItem('asr_deleted_ids', JSON.stringify([...deletedIds]));
      Promise.allSettled(deletes).then(() => {
        localStorage.setItem('asr_results', '[]');
        renderResults();
        toast('已清空', 'info');
      });
    }
  });
}

async function mergeServerResults() {
  try {
    const server = await API.listResults();
    const local = JSON.parse(localStorage.getItem('asr_results') || '[]');
    const localIds = new Set(local.map(r => r.id));
    // Track IDs the user explicitly deleted — don't re-fetch them
    const deletedIds = new Set(JSON.parse(localStorage.getItem('asr_deleted_ids') || '[]'));

    let added = 0;
    for (const item of server.results || []) {
      if (!localIds.has(item.id) && !deletedIds.has(item.id) && item.text_length > 0) {
        // Fetch full detail
        try {
          const detail = await API.getResult(item.id);
          local.push({
            id: detail.file_id || item.id,
            filename: detail.filename || item.id,
            date: new Date((detail.completed_at || 0) * 1000).toISOString(),
            duration_sec: detail.duration_sec || 0,
            language: detail.language || '',
            text: detail.full_text || '',
            segments: detail.segments || [],
            words: [],
          });
          added++;
        } catch {}
      }
    }
    if (added > 0) {
      // Sort by date descending
      local.sort((a, b) => new Date(b.date) - new Date(a.date));
      if (local.length > 20) local.length = 20;
      localStorage.setItem('asr_results', JSON.stringify(local));
      renderResults();
      toast(`已恢复 ${added} 条服务端结果`, 'success');
    }
  } catch {
    // Silent — server might not have results endpoint
  }
}

function renderResults() {
  const container = document.getElementById('resultsList');
  const results = JSON.parse(localStorage.getItem('asr_results') || '[]');

  if (results.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>暂无转写结果</p><p class="text-sm">在上传页面处理视频后，结果将在这里显示</p></div>';
    return;
  }

  container.innerHTML = '';
  results.forEach((r, idx) => {
    const card = document.createElement('div');
    card.className = 'card result-item';
    card.style.cursor = 'pointer';
    card.dataset.idx = idx;

    const preview = r.text ? r.text.slice(0, 100) + (r.text.length > 100 ? '...' : '') : '';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:8px">
        <div>
          <strong>${escapeHtml(r.filename || '未知')}</strong>
          <div class="text-sm text-dim">${formatDate(r.date)} · ${formatDuration(r.duration_sec)} · ${(r.text || '').length} 字</div>
        </div>
        <span class="badge badge-completed">已完成</span>
      </div>
      <div class="text-sm text-dim mt-8" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(preview)}</div>
      <div class="row-actions mt-8" id="actions_${idx}" hidden>
        <button class="btn btn-primary btn-sm" data-action="copy">复制全文</button>
        <button class="btn btn-secondary btn-sm" data-action="download">下载 .md</button>
        <button class="btn btn-secondary btn-sm" data-action="ass">下载 ASS</button>
        <button class="btn btn-secondary btn-sm" data-action="refine">LLM 润色</button>
        <button class="btn btn-secondary btn-sm" data-action="save">保存到目录</button>
        <button class="btn btn-danger btn-sm" data-action="delete">删除</button>
      </div>
      <div class="result-detail hidden" id="detail_${idx}">${escapeHtml(r.text || '')}</div>
    `;

    // Toggle expand
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      const detail = document.getElementById(`detail_${idx}`);
      const actions = document.getElementById(`actions_${idx}`);
      const wasHidden = detail.classList.contains('hidden');
      document.querySelectorAll('.result-detail').forEach(d => d.classList.add('hidden'));
      document.querySelectorAll('.row-actions').forEach(a => a.hidden = true);
      if (wasHidden) {
        detail.classList.remove('hidden');
        actions.hidden = false;
      }
    });

    // Action buttons
    card.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        switch (action) {
          case 'copy':
            copyToClipboard(r.text);
            break;
          case 'download':
            downloadText(r.text, (r.filename || 'transcript') + '.txt');
            break;
          case 'ass':
            downloadAss(r);
            break;
          case 'refine':
            sessionStorage.setItem('refine_input', r.text);
            navigate('/refine');
            break;
          case 'save':
            await saveToDir(r);
            break;
          case 'delete':
            if (confirm('删除这条结果？')) {
              // Also delete from server
              if (r.id) {
                API.deleteResult(r.id).catch(() => {});
                // Track as deleted so mergeServerResults won't re-fetch it
                const deletedIds = new Set(JSON.parse(localStorage.getItem('asr_deleted_ids') || '[]'));
                deletedIds.add(r.id);
                localStorage.setItem('asr_deleted_ids', JSON.stringify([...deletedIds]));
              }
              const list = JSON.parse(localStorage.getItem('asr_results') || '[]');
              list.splice(idx, 1);
              localStorage.setItem('asr_results', JSON.stringify(list));
              renderResults();
              toast('已删除', 'info');
            }
            break;
        }
      });
    });

    container.appendChild(card);
  });
}

async function downloadAss(result) {
  if (!result.segments || result.segments.length === 0) {
    toast('没有片段数据，无法生成 ASS', 'error');
    return;
  }
  const ass = generateAssContent(result.segments);
  downloadText(ass, (result.filename || 'subtitle') + '.ass');
  toast('ASS 已下载', 'success');
}

function generateAssContent(segments) {
  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: 原文,苹方 中等,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  for (const s of segments) {
    const start = fmtAssTime(s.start);
    const end = fmtAssTime(s.end);
    const text = (s.text || '').replace(/\n/g, '\\N');
    ass += `Dialogue: 0,${start},${end},原文,,0,0,0,,${text}\n`;
  }
  return ass;
}

function fmtAssTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2,'0')}:${s.toFixed(2).padStart(5,'0')}`;
}

async function saveToDir(result) {
  try {
    // Strip original extension, let server add .md
    const cleanName = (result.filename || 'transcription').replace(/[\\/:*?"<>|]/g, '_');
    const r = await API.saveResult(result.id, cleanName);
    toast('已保存到: ' + r.path, 'success');
  } catch (e) {
    toast('保存失败: ' + e.message, 'error');
  }
}

function escapeHtml(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
