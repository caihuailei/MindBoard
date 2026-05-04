// Chat page — DeepTutor style: Markdown, streaming, sessions, thinking cards
import { toast, copyToClipboard } from '../ui.js';
import { getActiveSession, addMessage, updateLastAssistant, getAllSessions } from '../store.js';
import { navigate } from '../router.js';

// Module-level state — reset on each init() call
let isStreaming = false;
let abortController = null;
let currentStreamingEl = null;
let currentSessionId = null;
let titleGenDone = false;  // track if AI title generation has run for this session

// Tutor presets
const TUTORS = {
  general:     { name: '通用助手', icon: '🤖', system: '你是一个全能的AI助手，擅长回答问题、分析文本和提供建议。请用简洁、专业的语言回答。' },
  math:        { name: '数学导师', icon: '📐', system: '你是一名数学导师，擅长用严谨的数学语言解释概念。回答时请使用准确的数学符号和公式（用 $...$ 或 $$...$$ 包裹 LaTeX 公式），并给出详细的推导步骤。' },
  language:    { name: '语文导师', icon: '📝', system: '你是一名语文导师，擅长文本分析、写作指导和文学鉴赏。请用优美的语言帮助学生理解文章的结构、修辞和思想内涵。' },
  english:     { name: '英语导师', icon: '🌍', system: 'You are an English tutor. Help with grammar, vocabulary, writing, and reading comprehension. Correct mistakes gently and explain the rules clearly.' },
  physics:     { name: '物理导师', icon: '⚡', system: '你是一名物理导师，擅长用物理直觉和数学工具解释现象。回答时请用清晰的逻辑，从基本原理出发推导结论，并使用 LaTeX 公式（$...$ 或 $$...$$）表达。' },
  programming: { name: '编程导师', icon: '💻', system: '你是一名编程导师，擅长代码审查、算法设计和调试。回答时请给出完整的代码示例，并解释关键思路。用 ```语言 包裹代码块。' },
  asr:         { name: 'ASR 润色', icon: '🎙️', system: '你是专业的ASR文本润色助手。擅长修正语音识别错误、优化文本流畅度和格式。请保持原文意思不变，仅改善表达方式。' },
};

// Context: load from transcribe_list API
let contextFiles = [];

export function render() {
  const session = getActiveSession();
  if (!session) return '<div class="card"><p>会话异常，请刷新页面</p></div>';

  const msgs = session.messages || [];
  const activeTutor = localStorage.getItem('asr_active_tutor') || 'general';
  const tutorOpts = Object.entries(TUTORS).map(([k, v]) =>
    `<option value="${k}" ${k === activeTutor ? 'selected' : ''}>${v.icon} ${v.name}</option>`
  ).join('');

  // Welcome screen
  const welcomeHTML = msgs.length === 0 ? `
    <div class="chat-welcome">
      <h2>有什么想聊的？</h2>
      <p>我可以帮你润色文本、分析内容、回答问题</p>
      <div class="chat-suggestions">
        <button class="suggestion-btn" data-text="帮我润色这段文本：">✨ 润色文本</button>
        <button class="suggestion-btn" data-text="帮我总结一下：">📋 内容摘要</button>
        <button class="suggestion-btn" data-text="这段代码有什么问题？">🔍 代码审查</button>
      </div>
    </div>
  ` : '';

  const msgsHTML = msgs.map((m, i) => messageBubble(m, i)).join('');

  return `
    <div class="chat-page">
      <div class="tutor-select" id="tutorSelectWrap">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <select id="tutorSelect">${tutorOpts}</select>
      </div>
      ${welcomeHTML}
      <div class="chat-messages" id="chatMessages">${msgsHTML}</div>

      <div class="chat-composer">
        <!-- File preview area -->
        <div id="chatFilePreview" class="chat-file-preview hidden"></div>
        <div class="chat-composer-row">
          <button class="chat-upload-btn" id="chatUploadBtn" title="上传文件">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          </button>
          <input type="file" id="chatFileInput" hidden>
          <button class="ctx-add-btn" id="ctxAddBtn" title="从历史记录添加上下文">＋</button>
          <textarea id="chatInput" rows="1" placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"></textarea>
          <button class="chat-send-btn" id="chatSendBtn" title="发送"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
        </div>
        <div class="chat-composer-hint">按 Enter 发送，Shift+Enter 换行</div>
      </div>

      <!-- Context picker dropdown -->
      <div class="ctx-picker hidden" id="ctxPicker">
        <div class="ctx-picker-header">选择文件作为上下文</div>
        <div id="ctxPickerList" class="ctx-picker-list">
          <div class="ctx-picker-loading">加载中...</div>
        </div>
      </div>
    </div>
  `;
}

export function init() {
  const session = getActiveSession();
  if (!session) return;

  // Track session to detect switching
  currentSessionId = session.id;
  titleGenDone = session.messages.length > 2;  // if already has exchange, skip title gen

  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSendBtn');
  const stopBtn = document.getElementById('chatStopBtn');
  const msgs = document.getElementById('chatMessages');

  // Tutor selector
  document.getElementById('tutorSelect')?.addEventListener('change', (e) => {
    localStorage.setItem('asr_active_tutor', e.target.value);
    toast(`已切换至: ${TUTORS[e.target.value].name}`, 'success');
  });

  // File upload
  document.getElementById('chatUploadBtn')?.addEventListener('click', () => {
    document.getElementById('chatFileInput')?.click();
  });
  document.getElementById('chatFileInput')?.addEventListener('change', handleFileUpload);

  // Auto-resize textarea
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  // Send on Enter
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  sendBtn?.addEventListener('click', send);
  stopBtn?.addEventListener('click', stopStreaming);

  // Suggestion buttons
  document.querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.text;
      input.focus();
    });
  });

  // Context button (+) — load transcribe list and show picker
  document.getElementById('ctxAddBtn')?.addEventListener('click', loadContextPicker);

  // Close pickers on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ctxAddBtn') && !e.target.closest('#ctxPicker')) closeCtxPicker();
  });

  // Copy buttons on assistant messages
  document.querySelectorAll('.chat-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const msg = session.messages[idx];
      if (msg) copyToClipboard(msg.content);
    });
  });

  // Follow-up question buttons (event delegation)
  document.getElementById('chatMessages')?.addEventListener('click', (e) => {
    const followupBtn = e.target.closest('.follow-up-btn');
    if (followupBtn) {
      const text = followupBtn.dataset.question;
      if (text && input) {
        input.value = text;
        input.focus();
        send();
      }
    }
  });

  smartScrollToBottom(msgs);
  input?.focus();
}

// Load transcribe list and show file picker
async function loadContextPicker() {
  const picker = document.getElementById('ctxPicker');
  const listEl = document.getElementById('ctxPickerList');
  if (!picker || !listEl) return;

  picker.classList.remove('hidden');
  listEl.innerHTML = '<div class="ctx-picker-loading">加载中...</div>';

  try {
    const { API } = await import('../api.js');
    const [transList, results] = await Promise.all([
      API.transcribeList().catch(() => []),
      API.listResults().catch(() => []),
    ]);

    contextFiles = [...transList.map(f => ({ id: f.file_id || f.id, name: f.filename || f.name, type: '转写' })),
                    ...results.map(f => ({ id: f.file_id || f.id, name: f.filename || f.name, type: '结果' }))];

    if (contextFiles.length === 0) {
      listEl.innerHTML = '<div class="ctx-picker-empty">暂无文件，请先转写或分析</div>';
      return;
    }

    listEl.innerHTML = contextFiles.map(f =>
      `<div class="ctx-picker-file" data-file-id="${f.id}"><span class="ctx-picker-file-type">${f.type}</span><span class="ctx-picker-file-name">${escCtx(f.name)}</span></div>`
    ).join('');

    listEl.querySelectorAll('.ctx-picker-file').forEach(item => {
      item.addEventListener('click', () => {
        const fileId = item.dataset.fileId;
        const file = contextFiles.find(f => f.id === fileId);
        if (file) {
          // Insert file reference into input
          const input = document.getElementById('chatInput');
          if (input) {
            input.value += `[参考文件: ${file.name}] `;
            input.focus();
          }
          toast(`已添加: ${file.name}`, 'success');
        }
        closeCtxPicker();
      });
    });
  } catch (e) {
    listEl.innerHTML = `<div class="ctx-picker-empty">加载失败: ${escCtx(e.message)}</div>`;
  }
}

function closeCtxPicker() {
  document.getElementById('ctxPicker')?.classList.add('hidden');
}

function escCtx(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
}

/* ═══════════════════════════════════════════
   Send message + streaming
   ═══════════════════════════════════════════ */

async function send() {
  const input = document.getElementById('chatInput');
  const text = input?.value?.trim();
  if (!text || isStreaming) return;

  const session = getActiveSession();
  if (!session) return;

  // Load LLM config from localStorage (per-preset)
  const config = loadLlmConfig();
  if (!config.api_url || !config.api_key || !config.model_name) {
    toast('请先在配置页面设置 LLM', 'error');
    navigate('/config');
    return;
  }

  // Get file context (if any uploaded)
  const fileContext = pendingFileContext;
  let userContent = text;
  if (fileContext) {
    userContent = `[文件: ${fileContext.name}]\n${fileContext.content}\n\n---\n\n${text}`;
    clearFilePreview();
  }

  addMessage('user', userContent);
  input.value = '';
  input.style.height = 'auto';

  // Add empty assistant message
  addMessage('assistant', '');

  isStreaming = true;
  abortController = new AbortController();

  // Re-render to show user message + thinking indicator
  reRender();

  const msgs = document.getElementById('chatMessages');
  const assistantEl = msgs?.querySelector('.chat-msg.assistant:last-child .md-renderer');
  currentStreamingEl = assistantEl;

  try {
    let fullText = '';
    let usage = null;

    // Capture first exchange for title generation
    const isFirstExchange = !titleGenDone && session.messages.length <= 2;
    let firstUserMsg = '', firstAiReply = '';
    if (isFirstExchange) {
      firstUserMsg = text;
    }

    // Build messages for API (with tutor system prompt)
    const apiMessages = buildApiMessages(session, userContent, config);

    // Send config to backend so it knows the API key (sync localStorage → server)
    await syncLlmConfigToBackend(config);

    await chatStream(apiMessages, config,
      (chunk) => {
        fullText += chunk;
        updateLastAssistant(fullText);
        if (currentStreamingEl) {
          currentStreamingEl.innerHTML = renderMarkdown(fullText, true);
          processThinkingCards(currentStreamingEl);
        }
        smartScrollToBottom(msgs);
      },
      (result) => {
        fullText = result.content || fullText;
        usage = result.usage;
      }
    );

    // Finalize
    updateLastAssistant(fullText);
    if (usage) {
      session.usage.prompt_tokens += usage.prompt_tokens || 0;
      session.usage.completion_tokens += usage.completion_tokens || 0;
    }

    reRender();
    const newMsgs = document.getElementById('chatMessages');
    smartScrollToBottom(newMsgs);

    // Title generation (first exchange only)
    if (isFirstExchange && !titleGenDone) {
      titleGenDone = true;
      generateTitle(session.id, firstUserMsg, fullText, config);
    }

    // Follow-up questions (async, non-blocking)
    generateFollowUps(session.messages, fullText, config);

    // Update sidebar session titles
    updateSidebarSessions();
  } catch (err) {
    toast('发送失败: ' + err.message, 'error');
    updateLastAssistant('错误: ' + err.message);
    reRender();
  } finally {
    isStreaming = false;
    abortController = null;
    currentStreamingEl = null;
  }
}

function stopStreaming() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  isStreaming = false;
  if (currentStreamingEl) {
    const cursor = currentStreamingEl.querySelector('.streaming-cursor');
    if (cursor) cursor.remove();
  }
  reRender();
}

async function chatStream(apiMessages, config, onChunk, onComplete) {
  const res = await fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: apiMessages,
      model: config.model_name,
      temperature: config.temperature || 0.3,
      api_url: config.api_url,
      api_key: config.api_key,
    }),
    signal: abortController?.signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  // Check if it's SSE or JSON
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    onChunk(content);
    onComplete({ content, usage: data.usage });
    return;
  }

  // SSE streaming
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let lastUsage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const chunk = parsed.choices?.[0]?.delta?.content;
        if (chunk) {
          fullText += chunk;
          onChunk(chunk);
        }
        if (parsed.choices?.[0]?.finish_reason) {
          lastUsage = parsed.usage || null;
        }
      } catch (e) {
        if (!e.message?.startsWith('Unexpected')) throw e;
      }
    }
  }

  onComplete({ content: fullText, usage: lastUsage });
}

function buildApiMessages(session, newText, config) {
  const contexts = buildContextText(session);

  // Tutor system prompt override
  const activeTutor = localStorage.getItem('asr_active_tutor') || 'general';
  const tutorSystem = TUTORS[activeTutor]?.system || TUTORS.general.system;
  const baseSystem = config.system_prompt || tutorSystem;

  const fullSystem = contexts ? `${baseSystem}\n\n## 参考上下文\n${contexts}` : baseSystem;

  return [
    { role: 'system', content: fullSystem },
    ...session.messages.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: newText },
  ];
}

function buildContextText(session) {
  if (!session.contexts || session.contexts.length === 0) return '';
  let text = '';
  for (const ctx of session.contexts) {
    if (ctx.text) {
      text += `### ${ctx.label || ctx.key}\n${ctx.text}\n\n`;
    }
  }
  return text.trim();
}

/* ═══════════════════════════════════════════
   Sync localStorage LLM config → backend
   ═══════════════════════════════════════════ */

async function syncLlmConfigToBackend(config) {
  try {
    await fetch('/llm_config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_url: config.api_url,
        api_key: config.api_key,
        model_name: config.model_name,
        system_prompt: config.system_prompt || '',
        temperature: config.temperature || 0.3,
      }),
    });
  } catch {
    // Non-critical: backend may not need persistent config
  }
}

/* ═══════════════════════════════════════════
   Context chips
   ═══════════════════════════════════════════ */

function toggleCtxPicker() {
  document.getElementById('ctxPicker')?.classList.toggle('hidden');
}

function addCtx(key) {
  const session = getActiveSession();
  if (!session) return;
  if (!session.contexts) session.contexts = [];
  if (session.contexts.find(c => c.key === key)) return;

  let ctxData = { key, label: '', text: '', id: '' };
  if (key === 'transcription') {
    const results = JSON.parse(localStorage.getItem('asr_results') || '[]');
    if (results.length > 0) {
      ctxData.text = results[0].text || '';
      ctxData.label = results[0].filename || '最新转写';
      ctxData.id = results[0].filename || '';
    }
  } else if (key === 'refined') {
    ctxData.text = sessionStorage.getItem('refine_result') || '';
    ctxData.label = '润色结果';
  } else if (key === 'analysis') {
    ctxData.text = sessionStorage.getItem('analyze_result') || '';
    ctxData.label = '分析结果';
  } else if (key === 'import') {
    importFromResults();
    return;
  }

  session.contexts.push(ctxData);
  reRender();
  toast(`已添加上下文: ${ctxData.label || key}`, 'success');
}

function removeCtx(key) {
  const session = getActiveSession();
  if (!session) return;
  session.contexts = (session.contexts || []).filter(c => c.key !== key);
  reRender();
}

function importFromResults() {
  const results = JSON.parse(localStorage.getItem('asr_results') || '[]');
  if (results.length === 0) { toast('没有转写结果可以导入', 'info'); return; }

  const list = results.map((r, i) =>
    `<div style="padding:8px;cursor:pointer;border-bottom:1px solid var(--border)" data-idx="${i}">
      <strong>${r.filename}</strong>
      <span class="text-dim text-sm"> · ${(r.text || '').length} 字</span>
    </div>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal"><h3>选择要导入的结果</h3>${list}</div>`;
  document.body.appendChild(overlay);

  overlay.querySelectorAll('[data-idx]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx);
      const session = getActiveSession();
      if (session) {
        if (!session.contexts) session.contexts = [];
        session.contexts.push({
          key: 'import', label: results[idx].filename,
          text: results[idx].text || '', id: results[idx].filename || '',
        });
        reRender();
        toast(`已导入: ${results[idx].filename}`, 'success');
      }
      overlay.remove();
    });
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

/* ═══════════════════════════════════════════
   Markdown rendering
   ═══════════════════════════════════════════ */

function renderMarkdown(text, streaming) {
  if (!text) return streaming ? '<span class="streaming-cursor"></span>' : '';

  // Try markdown-it + KaTeX first
  if (typeof md !== 'undefined' && md) {
    try {
      let html = md.render(text);
      html = processCodeBlocks(html);
      if (streaming) html += '<span class="streaming-cursor"></span>';
      return html;
    } catch {
      // Fallback to marked
    }
  }

  // Fallback: marked with basic math rendering
  if (typeof marked !== 'undefined') {
    let html = marked.parse(text, { async: false });
    // Render inline math $...$ and display math $$...$$
    html = renderMathInHtml(html);
    html = processCodeBlocks(html);
    if (streaming) html += '<span class="streaming-cursor"></span>';
    return html;
  }

  // Last resort: plain text with basic formatting
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\n/g, '<br>');
  if (streaming) html += '<span class="streaming-cursor"></span>';
  return html;
}

// Render KaTeX math in HTML (fallback when markdown-it isn't available)
function renderMathInHtml(html) {
  if (typeof katex === 'undefined') return html;
  // Display math $$...$$
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (match, tex) => {
    try { return '<div class="katex-display">' + katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false }) + '</div>'; }
    catch { return match; }
  });
  // Inline math $...$ (but not inside pre/code tags)
  html = html.replace(/(?<!<pre[^>]*>)(?<!<code[^>]*>)(?<!<[^>]*)\$([^$\n]+?)\$(?![^<]*<\/code>)(?![^<]*<\/pre>)/g, (match, tex) => {
    try { return katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false }); }
    catch { return match; }
  });
  return html;
}

function processCodeBlocks(html) { return html; }

// Post-render: apply syntax highlighting and add copy buttons
function postRender(el) {
  if (!el) return;

  el.querySelectorAll('pre code').forEach(block => {
    if (block.classList.contains('hljs')) return;

    if (typeof hljs !== 'undefined') {
      const langClass = [...block.classList].find(c => c.startsWith('language-'));
      const lang = langClass ? langClass.replace('language-', '') : null;

      if (lang && hljs.getLanguage(lang)) {
        hljs.highlightElement(block);
      } else {
        const text = block.textContent;
        if (text.length < 5000) {
          const result = hljs.highlightAuto(text);
          if (result.relevance > 5) {
            block.innerHTML = result.value;
            block.classList.add('hljs');
          }
        }
      }
    }

    const pre = block.closest('pre');
    if (pre && !pre.querySelector('.code-copy-btn')) {
      const lang = [...block.classList].find(c => c.startsWith('language-'))?.replace('language-', '') || 'text';
      const btn = document.createElement('button');
      btn.className = 'code-copy-btn';
      btn.textContent = '复制';
      btn.addEventListener('click', () => {
        copyToClipboard(block.textContent);
        btn.textContent = '已复制!';
        setTimeout(() => { btn.textContent = '复制'; }, 1500);
      });

      const label = document.createElement('span');
      label.className = 'code-lang-label';
      label.textContent = lang;

      const header = document.createElement('div');
      header.className = 'code-header';
      header.appendChild(label);
      header.appendChild(btn);

      pre.classList.add('code-block-wrapper');
      pre.insertBefore(header, pre.firstChild);
    }
  });

  processThinkingCards(el);
}

/* ═══════════════════════════════════════════
   Thinking cards (<think> tags)
   ═══════════════════════════════════════════ */

function processThinkingCards(el) {
  if (!el) return;
  const html = el.innerHTML;
  if (!html.includes('<think>')) return;

  const processed = html.replace(/<think>([\s\S]*?)(<\/?think>|$)/g, (match, content) => {
    const isComplete = match.includes('</think>');
    return `<details class="thinking-card" ${isComplete ? '' : 'open'}>
      <summary class="thinking-summary">
        <span class="thinking-icon">${isComplete ? '' : '<span class="spinner" style="width:14px;height:14px"></span>'}</span>
        <span>模型思考过程</span>
      </summary>
      <div class="thinking-content">${content.trim()}</div>
    </details>`;
  });

  if (processed !== html) el.innerHTML = processed;
}

/* ═══════════════════════════════════════════
   Message bubble rendering
   ═══════════════════════════════════════════ */

function messageBubble(m, idx) {
  const isUser = m.role === 'user';
  const isEmpty = !m.content && m.role === 'assistant';

  const userAvatar = localStorage.getItem('user-avatar') || '';
  const aiAvatar = localStorage.getItem('ai-avatar') || '';

  if (isUser) {
    const avatarHTML = userAvatar
      ? `<div class="avatar"><img src="${userAvatar}" alt=""></div>`
      : `<div class="avatar">你</div>`;
    return `
    <div class="chat-msg user">
      <div class="chat-msg-avatar">${avatarHTML}</div>
      <div class="chat-msg-bubble">${escapeHtml(m.content)}</div>
    </div>`;
  }

  const content = isEmpty ? '<span class="spinner" style="display:inline-block"></span> 正在思考...' : renderMarkdown(m.content);
  const avatarHTML = aiAvatar
    ? `<div class="avatar"><img src="${aiAvatar}" alt=""></div>`
    : `<div class="avatar avatar--primary">AI</div>`;

  return `
    <div class="chat-msg assistant">
      <div class="chat-msg-avatar">${avatarHTML}</div>
      <div class="md-renderer prose prose-enhanced">${content}</div>
      ${m.content && !isEmpty ? `
      <div class="chat-msg-actions">
        <button class="chat-copy-btn" data-idx="${idx}" title="复制">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          复制
        </button>
        <button class="chat-msg-action" onclick="window.downloadChatMsg(${idx})" title="下载">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          下载
        </button>
      </div>` : ''}
    </div>
  `;
}

/* ═══════════════════════════════════════════
   Scroll — smart: don't scroll if user is reading above
   ═══════════════════════════════════════════ */

function smartScrollToBottom(container) {
  if (!container) return;
  const threshold = 80;
  const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  if (atBottom) {
    requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    });
  }
}

/* ═══════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════ */

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
      temperature: saved.temperature || 0.3,
      system_prompt: saved.system_prompt || '',
    };
  } catch { return {}; }
}

function reRender() {
  const main = document.getElementById('route-content') || document.getElementById('main-content');
  if (!main) return;

  const msgs = document.getElementById('chatMessages');
  const scrollTop = msgs?.scrollTop || 0;

  main.innerHTML = render();
  init();

  main.querySelectorAll('.md-renderer.prose').forEach(el => postRender(el));

  if (msgs) msgs.scrollTop = scrollTop;
}

function updateSidebarSessions() {
  try {
    const sessions = getAllSessions().map(s => ({
      hash: `/chat/${s.id}`,
      title: s.title,
      updated: s.updated,
    }));
    import('../components/sidebar.js').then(Sidebar => {
      Sidebar.updateSessions(sessions);
    });
  } catch {}
}

/* ═══════════════════════════════════════════
   AI Title Generation (Phase 2)
   ═══════════════════════════════════════════ */

async function generateTitle(sessionId, firstUserMsg, firstAiReply, config) {
  try {
    const { setTitleGenPending, generateAiTitle } = await import('../store.js');
    setTitleGenPending(sessionId, firstUserMsg, firstAiReply);
    generateAiTitle(sessionId, firstUserMsg, firstAiReply, config).then(() => {
      // Update sidebar after title is generated
      updateSidebarSessions();
    });
  } catch {}
}

/* ═══════════════════════════════════════════
   Follow-up Questions (Phase 3)
   ═══════════════════════════════════════════ */

async function generateFollowUps(messages, aiReply, config) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const lastFew = messages.slice(-6);  // last 3 exchanges
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        messages: [
          { role: 'system', content: '根据上面的对话内容，生成 3 个简短的追问建议，每句不超过 25 字，用 JSON 数组格式返回，例如：["追问1", "追问2", "追问3"]。只返回 JSON，不要其他内容。' },
          ...lastFew.map(m => ({ role: m.role, content: m.content.slice(0, 500) })),
        ],
        model: config.model_name,
        temperature: 0.7,
        api_url: config.api_url,
        api_key: config.api_key,
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return;
    const data = await res.json();
    let content = data.choices?.[0]?.message?.content || '';
    // Parse JSON array from response
    content = content.trim();
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return;
    const questions = JSON.parse(match[0]);
    if (!Array.isArray(questions) || questions.length === 0) return;

    // Render follow-up buttons
    const msgsEl = document.getElementById('chatMessages');
    if (!msgsEl) return;
    const lastMsg = msgsEl.querySelector('.chat-msg.assistant:last-child');
    if (!lastMsg) return;
    const followUpDiv = document.createElement('div');
    followUpDiv.className = 'follow-up-questions';
    followUpDiv.innerHTML = questions.slice(0, 3).map(q =>
      `<button class="follow-up-btn" data-question="${escapeHtml(q)}">💡 ${escapeHtml(q)}</button>`
    ).join('');
    lastMsg.appendChild(followUpDiv);
  } catch {
    // Silently fail — non-critical feature
  }
}

/* ═══════════════════════════════════════════
   File Upload (Phase 5)
   ═══════════════════════════════════════════ */

let pendingFileContext = null;  // { name, content }

function handleFileUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  // Only support text files for now
  const allowedTypes = ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/html'];
  const allowedExt = ['.txt', '.md', '.csv', '.json', '.html', '.xml', '.log', '.srt'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();

  if (!allowedTypes.includes(file.type) && !allowedExt.includes(ext)) {
    toast('仅支持文本文件 (.txt, .md, .csv, .json, .html, .srt)', 'error');
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    toast('文件不能超过 5MB', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (ev) => {
    pendingFileContext = { name: file.name, content: ev.target.result };
    renderFilePreview(file.name, file.size);
  };
  reader.onerror = () => toast('文件读取失败', 'error');
  reader.readAsText(file);

  // Reset input so same file can be selected again
  e.target.value = '';
}

function renderFilePreview(name, size) {
  const preview = document.getElementById('chatFilePreview');
  if (!preview) return;
  preview.classList.remove('hidden');
  preview.innerHTML = `
    <div class="chat-file-chip">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span class="chat-file-name">${escapeHtml(name)}</span>
      <span class="chat-file-size">${formatFileSize(size)}</span>
      <button class="chat-file-remove" title="移除">&times;</button>
    </div>
  `;
  preview.querySelector('.chat-file-remove')?.addEventListener('click', clearFilePreview);
}

function clearFilePreview() {
  pendingFileContext = null;
  const preview = document.getElementById('chatFilePreview');
  if (preview) {
    preview.classList.add('hidden');
    preview.innerHTML = '';
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Global download handler
window.downloadChatMsg = function(idx) {
  const session = getActiveSession();
  if (session && session.messages[idx]) {
    const now = new Date();
    const ts = now.toISOString().slice(0, 10);
    const text = `# ASR Chat — ${session.title}\n\n${session.messages[idx].content}`;
    const blob = new Blob([text], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chat_${ts}_${idx}.md`;
    a.click();
  }
};
