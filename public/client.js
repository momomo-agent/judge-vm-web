// Judge VM Playground — client
const $ = (sel) => document.querySelector(sel);

const srcEl = $('#src');
const sdkSrcEl = $('#sdk-src');
const jasmPreview = $('#jasm-preview');
const jasmPreviewCode = $('#jasm-preview-code');
const statesEl = $('#states');
const runBtn = $('#btn-run');
const tplSelect = $('#tpl-select');
const tplTagline = $('#tpl-tagline');
const statusEl = $('#run-status');
const traceEl = $('#trace');
const outputEl = $('#output');

// ======== Mode switching ========
let currentMode = 'jasm'; // 'jasm' | 'sdk'

document.querySelectorAll('.mode-tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const mode = tab.dataset.mode;
    if (mode === currentMode) return;
    currentMode = mode;
    document.querySelectorAll('.mode-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));

    if (mode === 'jasm') {
      srcEl.classList.remove('hidden');
      sdkSrcEl.classList.add('hidden');
      jasmPreview.classList.add('hidden');
    } else {
      srcEl.classList.add('hidden');
      sdkSrcEl.classList.remove('hidden');
      // Show preview only if we have compiled JASM
      if (jasmPreviewCode.textContent) jasmPreview.classList.remove('hidden');
    }
  });
});

// ======== Templates ========
let templateIndex = [];
let currentTemplate = null;

async function loadTemplateIndex() {
  const res = await fetch('/api/templates');
  if (!res.ok) throw new Error('Failed to load template index: ' + res.status);
  const data = await res.json();
  templateIndex = data.templates;

  // Populate the select
  tplSelect.innerHTML = '';
  for (const t of templateIndex) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    tplSelect.appendChild(opt);
  }
}

async function loadTemplate(id) {
  const res = await fetch(`/api/templates?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('Failed to load template ' + id + ': ' + res.status);
  const tpl = await res.json();
  currentTemplate = tpl;
  tplTagline.textContent = tpl.tagline || '';

  // Populate both editors so switching mode works instantly
  srcEl.value = tpl.jasm;
  sdkSrcEl.value = tpl.sdk;
  statesEl.value = JSON.stringify(tpl.states, null, 2);

  // Clear any prior compiled JASM preview
  jasmPreview.classList.add('hidden');
  jasmPreviewCode.textContent = '';
}

// ======== Rendering ========
function fmtVal(v) {
  if (typeof v !== 'object' || v === null) return String(v);
  if ('pick' in v) return `${v.pick} · confidence ${(v.confidence ?? 1).toFixed(2)}`;
  if ('value' in v && typeof v.value === 'number') return `${v.value.toFixed(2)} · confidence ${(v.confidence ?? 1).toFixed(2)}`;
  if ('p' in v) return `p = ${v.p.toFixed(3)}`;
  if ('text' in v && typeof v.text === 'string') {
    const preview = v.text.length > 120 ? v.text.slice(0, 120) + '…' : v.text;
    return `"${preview}"`;
  }
  if ('code' in v) return `<code>${(v.code.length > 100 ? v.code.slice(0, 100) + '…' : v.code).replace(/</g, '&lt;')}</code>`;
  if ('hits' in v) {
    const n = Array.isArray(v.hits) ? v.hits.length : v.hits;
    return `${n} hit${n === 1 ? '' : 's'}`;
  }
  if ('facts' in v) {
    const facts = typeof v.facts === 'object' ? JSON.stringify(v.facts) : v.facts;
    return facts.length > 100 ? facts.slice(0, 100) + '…' : facts;
  }
  if ('transcript' in v) return `‹audio› "${(v.transcript || '').slice(0, 100)}"`;
  return JSON.stringify(v).slice(0, 100);
}

function renderTrace(trace) {
  traceEl.innerHTML = '';
  for (const t of trace) {
    const line = document.createElement('div');
    const styleKind = t.kind === 'batch' && t.primitive ? `batch-${t.primitive.toLowerCase()}` : t.kind;
    line.className = `trace-line ${styleKind}`;

    const badge = t.kind === 'batch' && t.primitive ? t.primitive : t.kind.toUpperCase();
    let inner = `<span class="pc">pc=${t.pc}</span><span class="kind ${styleKind}">${badge}</span>`;

    if (t.kind === 'batch') {
      const items = t.detail.judges || t.detail.gens || t.detail.recalls || t.detail.senses || [];
      const label = t.primitive === 'J' ? 'judges' : t.primitive === 'L' ? 'gens' : t.primitive === 'M' ? 'recalls' : t.primitive === 'P' ? 'senses' : 'ops';
      inner += `<span>× ${items.length} ${label}</span>`;
      inner += `<div class="meta">${t.latencyMs}ms${t.usage?.totalTokens ? ` · ${t.usage.totalTokens} tokens` : ''}</div>`;
      for (const item of items) {
        const ans = t.detail.answers?.[item.dest];
        const kindTag = item.kind ? `<span class="kind-tag">${item.kind}</span>` : '';
        const query = item.instructions || item.prompt || item.query || '';
        inner += `<div class="judge-row"><span class="reg">${item.dest}</span> ${kindTag} "${query}" → <span class="result">${fmtVal(ans)}</span></div>`;
      }
    } else if (t.kind === 'branch') {
      const tk = t.detail.taken ? `<span style="color: var(--success)">TAKE .${t.detail.target}</span>` : `<span style="color: var(--text-faint)">fall through</span>`;
      inner += `<span>if ${t.detail.cond}</span> → ${tk}`;
    } else if (t.kind === 'jump') {
      inner += `<span>→ .${t.detail.target}</span>`;
    } else if (t.kind === 'emit') {
      inner += `<span>${JSON.stringify(t.detail)}</span>`;
    } else if (t.kind === 'halt') {
      inner += `<span>program end</span>`;
    }

    line.innerHTML = inner;
    traceEl.appendChild(line);
  }
}

function renderOutput(result) {
  const parts = [];
  if (result.emits.length) {
    parts.push('<h3>Emits</h3>');
    for (const e of result.emits) {
      parts.push(`<div class="emit-item">${JSON.stringify(e)}</div>`);
    }
  }
  parts.push('<h3>Registers</h3>');
  for (const [name, val] of Object.entries(result.registers)) {
    parts.push(`<div class="reg-row"><span class="name">${name}</span><span class="val">${fmtVal(val)}</span></div>`);
  }
  parts.push('<h3>Stats</h3>');
  parts.push(`<div class="stats"><span>${result.stats.totalMs}ms total</span><span>${result.stats.apiCalls} API calls</span><span>${result.stats.tokens.in + result.stats.tokens.out} tokens</span></div>`);
  outputEl.innerHTML = parts.join('');
}

// ======== Run ========
async function doRun() {
  runBtn.disabled = true;
  statusEl.textContent = 'running…';
  statusEl.className = 'status';
  traceEl.innerHTML = '';
  outputEl.innerHTML = '';
  const t0 = performance.now();

  try {
    let states;
    try { states = JSON.parse(statesEl.value); }
    catch (e) { throw new Error('Invalid state JSON: ' + e.message); }

    let programSrc;

    if (currentMode === 'sdk') {
      // Step 1: compile SDK code → JASM on the server
      statusEl.textContent = 'compiling SDK → JASM…';
      const compileRes = await fetch('/api/sdk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: sdkSrcEl.value }),
      });
      const compileData = await compileRes.json();
      if (compileData.error) throw new Error('SDK compile error: ' + compileData.error);
      programSrc = compileData.jasm;

      // Show compiled JASM in the preview pane
      jasmPreviewCode.textContent = programSrc;
      jasmPreview.classList.remove('hidden');

      statusEl.textContent = 'running…';
    } else {
      programSrc = srcEl.value;
    }

    // Step 2: run the JASM
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ program: programSrc, states }),
    });
    const data = await res.json();
    if (data.error) {
      outputEl.innerHTML = `<div class="error">${data.error}</div>`;
      statusEl.textContent = `error after ${Math.round(performance.now() - t0)}ms`;
      statusEl.className = 'status err';
    } else {
      renderTrace(data.result.trace);
      renderOutput(data.result);
      const s = data.result.stats;
      const prefix = currentMode === 'sdk' ? 'sdk → ' : '';
      statusEl.textContent = `${prefix}ok · ${s.totalMs}ms exec · ${s.apiCalls} API calls · ${s.tokens.in + s.tokens.out} tokens`;
      statusEl.className = 'status ok';
    }
  } catch (e) {
    outputEl.innerHTML = `<div class="error">${e.message}</div>`;
    statusEl.textContent = `error`;
    statusEl.className = 'status err';
  } finally {
    runBtn.disabled = false;
  }
}

runBtn.addEventListener('click', doRun);
tplSelect.addEventListener('change', () => loadTemplate(tplSelect.value));

(async () => {
  await loadTemplateIndex();
  await loadTemplate(templateIndex[0].id);
})();
