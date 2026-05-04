// Session store — localStorage persisted, LRU capped at 20
const STORAGE_KEY = 'asr_chat_sessions';
const MAX_SESSIONS = 20;

let state = {
  sessions: [],
  activeId: null,
};

export function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    state.sessions = data.sessions || [];
    state.activeId = data.activeId || null;

    // LRU eviction
    if (state.sessions.length > MAX_SESSIONS) {
      state.sessions = state.sessions.slice(0, MAX_SESSIONS);
    }
  } catch {
    state.sessions = [];
    state.activeId = null;
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sessions: state.sessions,
      activeId: state.activeId,
    }));
  } catch {}
}

export function createSession() {
  const id = 's_' + Date.now();
  const session = {
    id,
    title: 'New Chat',
    messages: [],
    created: Date.now(),
    updated: Date.now(),
    model: null,
    usage: { prompt_tokens: 0, completion_tokens: 0, total_cost: 0 },
  };
  state.sessions.unshift(session);
  state.activeId = id;
  persist();
  return id;
}

export function getActiveSession() {
  return state.sessions.find(s => s.id === state.activeId) || null;
}

export function getSession(id) {
  return state.sessions.find(s => s.id === id);
}

export function setActive(id) {
  if (state.sessions.find(s => s.id === id)) {
    state.activeId = id;
    persist();
  }
}

export function deleteSession(id) {
  state.sessions = state.sessions.filter(s => s.id !== id);
  if (state.activeId === id) {
    state.activeId = state.sessions[0]?.id || null;
  }
  persist();
}

export function renameSession(id, title) {
  const s = state.sessions.find(s => s.id === id);
  if (s) {
    s.title = title;
    persist();
  }
}

export function addMessage(role, content, usage) {
  const session = getActiveSession();
  if (!session) return;
  session.messages.push({ role, content, timestamp: Date.now() });
  if (usage) {
    session.usage.prompt_tokens += usage.prompt_tokens || 0;
    session.usage.completion_tokens += usage.completion_tokens || 0;
  }
  session.updated = Date.now();
  persist();
}

export function updateLastAssistant(content) {
  const session = getActiveSession();
  if (!session) return;
  const last = session.messages[session.messages.length - 1];
  if (last && last.role === 'assistant') {
    last.content = content;
    session.updated = Date.now();
    persist();
  }
}

export function getAllSessions() {
  return state.sessions;
}

// Auto-title: flag for triggering AI title generation
let _titleGenPending = null; // { sessionId, firstUserMsg, firstAiReply }

export function setTitleGenPending(sessionId, userMsg, aiReply) {
  _titleGenPending = { sessionId, firstUserMsg: userMsg, firstAiReply: aiReply };
}

export function getTitleGenPending() {
  const p = _titleGenPending;
  _titleGenPending = null;
  return p;
}

// Generate a short AI title for a session
export async function generateAiTitle(sessionId, firstUserMsg, firstAiReply, llmConfig) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        messages: [
          { role: 'system', content: '用 3-8 个字总结这段对话的主题，只返回标题，不要解释。' },
          { role: 'user', content: firstUserMsg + '\n\n' + firstAiReply.slice(0, 200) },
        ],
        model: llmConfig.model_name,
        temperature: 0.3,
        api_url: llmConfig.api_url,
        api_key: llmConfig.api_key,
      }),
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    let title = data.choices?.[0]?.message?.content?.trim() || '';
    // Strip markdown/quotes
    title = title.replace(/^["'"'']*|["'"'']*$/g, '').replace(/^#+\s*/, '');
    if (title.length >= 2 && title.length <= 20) {
      renameSession(sessionId, title);
    }
  } catch {
    // Fallback: truncate first user message
    const fallback = firstUserMsg.slice(0, 20) + (firstUserMsg.length > 20 ? '...' : '');
    renameSession(sessionId, fallback);
  }
}
