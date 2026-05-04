// API client — wraps all backend endpoints

async function req(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      msg = err.detail || msg;
    } catch (_) {}
    throw new Error(msg);
  }
  return res;
}

export const API = {
  // Health
  async health() {
    const r = await req('/health');
    return r.json();
  },

  async transcribeList() {
    const r = await req('/transcribe_list');
    return r.json();
  },

  async transcribeStatus(fileId) {
    const r = await req(`/transcribe_status/${fileId}`);
    return r.json();
  },

  // Transcribe — EventSource SSE (auto-reconnect, simpler than fetch+ReadableStream)
  createTranscribeEventSource(fileId, onData, onDone) {
    const es = new EventSource(`/transcribe_stream/${fileId}`);
    let closed = false;
    es.onmessage = (event) => {
      if (event.data === '[DONE]') {
        closed = true;
        if (onDone) onDone();
        es.close();
        return;
      }
      try {
        const parsed = JSON.parse(event.data);
        if (onData) onData(parsed);
      } catch (e) {
        if (e.message && e.message.startsWith('Unexpected')) return;
        throw e;
      }
    };
    es.onerror = () => {
      if (closed) return;
      // Server closed connection — stop reconnecting
      closed = true;
      es.close();
      if (onDone) onDone();
    };
    return es;
  },

  // Upload — async (non-blocking) version
  async transcribeAsync(file, opts = {}) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('language', opts.language || 'Chinese');
    fd.append('context', opts.context || '');
    fd.append('max_chars', String(opts.maxChars ?? 50));
    fd.append('pause_threshold', String(opts.pauseThreshold ?? 0.3));
    fd.append('source', opts.source || 'upload');
    const r = await req('/transcribe_async', { method: 'POST', body: fd });
    return r.json();
  },

  // ASS
  async transcribeAss(file, opts = {}) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('language', opts.language || 'Chinese');
    fd.append('context', opts.context || '');
    const r = await req('/transcribe_ass', { method: 'POST', body: fd });
    return r.text();
  },

  // ASS translation (AI bilingual)
  async assTranslate(file, opts = {}) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('api_key', opts.api_key || '');
    fd.append('api_url', opts.api_url || 'https://api.deepseek.com');
    fd.append('model_name', opts.model_name || 'deepseek-chat');
    fd.append('system_prompt', opts.system_prompt || '');
    fd.append('temperature', String(opts.temperature ?? 0.3));
    fd.append('batch_size', String(opts.batch_size ?? 200));
    fd.append('target_language', opts.target_language || 'Chinese');
    const r = await req('/ass_translate', { method: 'POST', body: fd });
    return r.text();
  },

  // LLM test
  async llmTest(config) {
    const params = new URLSearchParams({
      api_url: config.api_url,
      api_key: config.api_key,
      model_name: config.model_name,
    });
    const r = await req('/llm_test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    return r.json();
  },

  // Refine
  async refineText(text, config) {
    const fd = new FormData();
    fd.append('text', text);
    fd.append('api_key', config.api_key || '');
    fd.append('api_url', config.api_url || '');
    fd.append('model_name', config.model_name || '');
    fd.append('system_prompt', config.system_prompt || '');
    fd.append('temperature', String(config.temperature ?? 0.3));
    const r = await req('/refine', { method: 'POST', body: fd });
    return r.json();
  },

  // Refine — streaming SSE
  async refineTextStream(text, config, onChunk, onDone) {
    const fd = new FormData();
    fd.append('text', text);
    fd.append('api_key', config.api_key || '');
    fd.append('api_url', config.api_url || '');
    fd.append('model_name', config.model_name || '');
    fd.append('system_prompt', config.system_prompt || '');
    fd.append('temperature', String(config.temperature ?? 0.3));

    const res = await fetch('/refine_stream', { method: 'POST', body: fd });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const err = await res.json(); msg = err.detail || msg; } catch {}
      throw new Error(msg);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            if (onDone) onDone(fullText);
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.text != null) {
              fullText += parsed.text;
              if (onChunk) onChunk(parsed.text, fullText);
            }
            if (parsed.error) throw new Error(parsed.error);
          } catch (e) {
            if (e.message && e.message.startsWith('Unexpected')) continue;
            throw e;
          }
        }
      }
    }
    return fullText;
  },

  // AI analysis
  async aiAnalyze(text, mode, customPrompt, config) {
    const fd = new FormData();
    fd.append('text', text);
    fd.append('mode', mode || 'summarize');
    fd.append('system_prompt', customPrompt || '');
    fd.append('api_key', config.api_key || '');
    fd.append('api_url', config.api_url || '');
    fd.append('model_name', config.model_name || '');
    fd.append('temperature', String(config.temperature ?? 0.3));
    const r = await req('/ai_analyze', { method: 'POST', body: fd });
    return r.json();
  },

  // LLM config (for AI Agent)
  async getLlmConfig() {
    const r = await req('/llm_config');
    return r.json();
  },

  async setLlmConfig(config) {
    const r = await req('/llm_config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return r.json();
  },

  // Output dir
  async getOutputDir() {
    const r = await req('/output_dir');
    return r.json();
  },

  async setOutputDir(path) {
    const params = new URLSearchParams({ path });
    const r = await req('/output_dir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    return r.json();
  },

  async saveResult(fileId, filename) {
    const params = new URLSearchParams({ file_id: fileId, filename });
    const r = await req('/save_result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    return r.json();
  },

  // Save arbitrary text (ASS subtitles, etc.) to output dir
  async saveText(filename, content) {
    const fd = new FormData();
    fd.append('filename', filename);
    fd.append('content', content);
    const r = await req('/save_text', { method: 'POST', body: fd });
    return r.json();
  },

  // Persisted results
  async listResults() {
    const r = await req('/results');
    return r.json();
  },

  async getResult(fileId) {
    const r = await req(`/results/${fileId}`);
    return r.json();
  },

  async deleteResult(fileId) {
    const r = await req(`/results/${fileId}`, { method: 'DELETE' });
    return r.json();
  },

  // System metrics
  async getSystemMetrics() {
    const r = await req('/system_metrics');
    return r.json();
  },

  // File downloads (LAN access)
  async listFiles() {
    const r = await req('/files');
    return r.json();
  },

  // Download URL helper — returns the direct download URL
  downloadUrl(filename) {
    return `/download/${filename}`;
  },

  // nanobot management
  async nanobotStatus() {
    const r = await req('/nanobot/status');
    return r.json();
  },

  async nanobotStart() {
    const r = await req('/nanobot/start', { method: 'POST' });
    return r.json();
  },

  async nanobotStop() {
    const r = await req('/nanobot/stop', { method: 'POST' });
    return r.json();
  },

  async getNanobotConfig() {
    const r = await req('/nanobot/config');
    return r.json();
  },

  async setNanobotConfig(config) {
    const r = await req('/nanobot/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return r.json();
  },

  async getNanobotMemory(filename) {
    const r = await req(`/nanobot/memory/${filename}`);
    return r.json();
  },

  async resetNanobotMemory(filename) {
    const r = await req(`/nanobot/memory/${filename}/reset`, { method: 'POST' });
    return r.json();
  },

  async getNanobotProvider() {
    const r = await req('/nanobot/provider');
    return r.json();
  },

  async setNanobotProvider(config) {
    const r = await req('/nanobot/provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return r.json();
  },

  // Nanobot workspace file read/write
  async saveNanobotWorkspace(filename, content) {
    const fd = new FormData();
    fd.append('content', content);
    const r = await req(`/nanobot/workspace/${encodeURIComponent(filename)}`, {
      method: 'POST',
      body: fd,
    });
    return r.json();
  },

  async getNanobotFile(filename) {
    const r = await req(`/nanobot/memory/${encodeURIComponent(filename)}`);
    return r.json();
  },
};

// ── WebSocket Client ──
class WSClient {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.reconnectAttempts = 0;
    this.maxReconnects = 5;
    this.heartbeatInterval = null;
    this.lastPong = Date.now();
    this.connected = false;
  }

  connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws`;
    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      console.warn('WebSocket not available:', e.message);
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.lastPong = Date.now();
      this.startHeartbeat();
      this.emit('connected');
      console.log('[WS] Connected to', this.ws.url);
    };

    this.ws.onmessage = (event) => {
      const data = event.data;
      if (data === 'pong') {
        this.lastPong = Date.now();
        return;
      }
      try {
        const msg = JSON.parse(data);
        if (msg.type?.startsWith('job:')) {
          console.log('[WS] job event:', msg.type, msg);
        }
        this.emit('message', msg);
        // Route to specific event type
        if (msg.type) {
          this.emit(msg.type, msg);
          // job:* events → 'job' handler
          if (msg.type.startsWith('job:')) {
            this.emit('job', { type: msg.type, data: msg });
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.stopHeartbeat();
      this.emit('disconnected');
      // Don't auto-reconnect if maxReconnects <= 0
      if (this.reconnectAttempts < this.maxReconnects) {
        this.tryReconnect();
      }
    };

    this.ws.onerror = () => {
      // Errors are handled via onclose
    };
  }

  send(type, data = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  on(event, handler) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }

  off(event, handler) {
    if (this.handlers[event]) {
      this.handlers[event] = this.handlers[event].filter(h => h !== handler);
    }
  }

  emit(event, data) {
    const handlers = this.handlers[event] || [];
    handlers.forEach(h => { try { h(data); } catch (e) { console.error('WS handler error:', e); } });
  }

  disconnect() {
    this.maxReconnects = 0; // Prevent auto-reconnect
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.stopHeartbeat();
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (Date.now() - this.lastPong > 45000) {
        // Dead connection
        console.warn('WebSocket dead, reconnecting...');
        if (this.ws) this.ws.close();
        return;
      }
      this.send('ping');
    }, 30000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  tryReconnect() {
    if (this.reconnectAttempts >= this.maxReconnects) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    setTimeout(() => this.connect(), delay);
  }
}

API.ws = new WSClient();
