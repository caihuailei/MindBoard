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

  // Upload — async (non-blocking) version
  async transcribeAsync(file, opts = {}) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('language', opts.language || 'Chinese');
    fd.append('context', opts.context || '');
    fd.append('max_chars', String(opts.maxChars ?? 50));
    fd.append('pause_threshold', String(opts.pauseThreshold ?? 0.3));
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
};
