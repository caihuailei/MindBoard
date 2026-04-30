// LLM Refine page — streaming + state persistence
import { toast, copyToClipboard, downloadText } from '../ui.js';
import { API } from '../api.js';
import { navigate } from '../router.js';

function getActiveConfig() {
  const activePreset = localStorage.getItem('asr_llm_config_active') || 'deepseek';
  return JSON.parse(localStorage.getItem(`asr_llm_config_${activePreset}`) || '{}');
}

function hasConfig() {
  const c = getActiveConfig();
  return !!(c.api_url && c.api_key && c.model_name);
}

export function render() {
  const saved = getActiveConfig();
  const configured = hasConfig();

  return `
    <div class="card">
      <h2>LLM 文本润色</h2>
      ${!configured ? '<div class="text-sm" style="padding:8px 12px;background:var(--warning-bg);border-radius:var(--radius-sm);margin-bottom:12px;color:var(--warning)">请先在 <a href="#/config" style="color:var(--accent)">配置页面</a> 设置 LLM 参数</div>' : ''}

      <div class="form-group">
        <label>输入文本</label>
        <textarea class="form-input" id="refineInput" rows="8" placeholder="粘贴需要润色的文本，或从结果页面导入..."></textarea>
      </div>

      <div class="btn-group">
        <button class="btn btn-primary" id="refineBtn" ${!configured ? 'disabled' : ''}>润色文本</button>
        <button class="btn btn-secondary" id="importResultBtn">从结果导入</button>
      </div>

      <div id="refineConfigSummary" class="config-summary text-sm mt-8">
        ${configured ? `模型: <code>${saved.model_name}</code> · ${saved.api_url}` : '<span class="text-dim">未配置 LLM</span>'}
      </div>
    </div>

    <div id="refineResult" class="hidden">
      <div class="card">
        <h2>润色结果</h2>
        <div id="refineOutput" class="transcript-body"></div>
        <div class="btn-group">
          <button class="btn btn-primary btn-sm" id="copyRefineBtn">复制结果</button>
          <button class="btn btn-secondary btn-sm" id="downloadRefineBtn">下载 .md</button>
        </div>
      </div>
    </div>

    <div id="refineLoading" class="hidden card text-center" style="text-align:center">
      <div class="spinner" style="margin:0 auto"></div>
      <p class="mt-8 text-dim">正在润色 <span id="refineProgress" class="text-dim"></span></p>
    </div>
  `;
}

export function init() {
  document.getElementById('refineBtn').addEventListener('click', doRefine);
  document.getElementById('importResultBtn').addEventListener('click', importResult);
  document.getElementById('copyRefineBtn')?.addEventListener('click', () => {
    const text = document.getElementById('refineOutput')?.textContent || '';
    if (text) copyToClipboard(text);
  });
  document.getElementById('downloadRefineBtn')?.addEventListener('click', () => {
    const text = document.getElementById('refineOutput')?.textContent || '';
    if (text) {
      const now = new Date();
      const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const created = now.toISOString().replace('Z', '+08:00');
      const frontmatter = `---
title: 润色结果 ${ts}
source: LLM 文本润色
author: ASR 系统
published: ${created}
created: ${created}
description: ASR 转写文本润色结果
tags: [ASR, 润色, LLM]
---

`;
      downloadText(frontmatter + text, `refined_${ts}.md`);
    }
  });

  // Restore refine input from sessionStorage
  const savedInput = sessionStorage.getItem('refine_input');
  if (savedInput) {
    document.getElementById('refineInput').value = savedInput;
    sessionStorage.removeItem('refine_input');
  }

  // Restore refine result from sessionStorage (page-switch persistence)
  const savedResult = sessionStorage.getItem('refine_result');
  if (savedResult) {
    document.getElementById('refineOutput').textContent = savedResult;
    document.getElementById('refineResult').classList.remove('hidden');
  }
}

async function doRefine() {
  const config = getActiveConfig();
  if (!config.api_url || !config.api_key || !config.model_name) {
    toast('请先在配置页面设置 LLM', 'error');
    return;
  }

  const text = document.getElementById('refineInput').value.trim();
  if (!text) { toast('请输入需要润色的文本', 'error'); return; }

  document.getElementById('refineBtn').disabled = true;
  document.getElementById('refineLoading').classList.remove('hidden');
  document.getElementById('refineResult').classList.add('hidden');
  document.getElementById('refineProgress').textContent = '';

  const output = document.getElementById('refineOutput');

  try {
    // Use streaming
    let streamedText = '';
    const startTime = Date.now();
    await API.refineTextStream(text, config,
      (chunk, fullText) => {
        streamedText = fullText;
        output.textContent = streamedText;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        document.getElementById('refineProgress').textContent = `(${elapsed}s · ${streamedText.length} 字)`;
      },
      (finalText) => {
        // Save to sessionStorage for page-switch persistence
        sessionStorage.setItem('refine_result', finalText);
      }
    );

    document.getElementById('refineResult').classList.remove('hidden');
    sessionStorage.setItem('refine_result', streamedText);
    toast('润色完成', 'success');
  } catch (e) {
    toast('润色失败: ' + e.message, 'error');
    document.getElementById('refineResult').classList.remove('hidden');
    if (!output.textContent) output.textContent = '错误: ' + e.message;
  } finally {
    document.getElementById('refineBtn').disabled = false;
    document.getElementById('refineLoading').classList.add('hidden');
  }
}

function importResult() {
  const results = JSON.parse(localStorage.getItem('asr_results') || '[]');
  if (results.length === 0) {
    toast('没有转写结果可以导入', 'info');
    return;
  }
  const list = results.map((r, i) =>
    `<div style="padding:8px;cursor:pointer;border-bottom:1px solid var(--border)" data-idx="${i}">
      <strong>${r.filename}</strong>
      <span class="text-dim text-sm"> · ${(r.text || '').length} 字 · ${new Date(r.date).toLocaleString('zh-CN')}</span>
    </div>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal"><h3>选择要导入的结果</h3>${list || '<p>没有结果</p>'}</div>`;
  document.body.appendChild(overlay);

  overlay.querySelectorAll('[data-idx]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx);
      document.getElementById('refineInput').value = results[idx].text || '';
      overlay.remove();
    });
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}
