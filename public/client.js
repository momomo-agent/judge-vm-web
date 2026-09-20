// Judge VM Playground — client
const $ = (sel) => document.querySelector(sel);

const srcEl = $('#src');
const statesEl = $('#states');
const runBtn = $('#btn-run');
const exBtn = $('#btn-example');
const statusEl = $('#run-status');
const traceEl = $('#trace');
const outputEl = $('#output');

async function loadExample() {
  const res = await fetch('/api/example');
  if (!res.ok) throw new Error('Failed to load example: ' + res.status);
  const ex = await res.json();
  srcEl.value = ex.program;
  statesEl.value = JSON.stringify(ex.states, null, 2);
}

function fmtVal(v) {
  if (typeof v !== 'object' || v === null) return String(v);
  if ('pick' in v) return `${v.pick} · confidence ${(v.confidence ?? 1).toFixed(2)}`;                        // J.choice
  if ('value' in v && typeof v.value === 'number') return `${v.value.toFixed(2)} · confidence ${(v.confidence ?? 1).toFixed(2)}`;  // J.score
  if ('p' in v) return `p = ${v.p.toFixed(3)}`;                                                                // J.noul
  if ('text' in v && typeof v.text === 'string') {                                                             // L.text
    const preview = v.text.length > 120 ? v.text.slice(0, 120) + '…' : v.text;
    return `“${preview}”`;
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
  if ('transcript' in v) return `‹audio› “${(v.transcript || '').slice(0, 100)}”`;
  return JSON.stringify(v).slice(0, 100);
}

function renderTrace(trace) {
  traceEl.innerHTML = '';
  for (const t of trace) {
    const line = document.createElement('div');
    // Style trace lines by JLMP primitive when it's a batch, otherwise by kind.
    const styleKind = t.kind === 'batch' && t.primitive ? `batch-${t.primitive.toLowerCase()}` : t.kind;
    line.className = `trace-line ${styleKind}`;

    const badge = t.kind === 'batch' && t.primitive ? t.primitive : t.kind.toUpperCase();
    let inner = `<span class="pc">pc=${t.pc}</span><span class="kind ${styleKind}">${badge}</span>`;

    if (t.kind === 'batch') {
      // JLMP primitive dispatch
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

async function run() {
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

    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ program: srcEl.value, states }),
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
      statusEl.textContent = `ok · ${s.totalMs}ms exec · ${s.apiCalls} API call · ${s.tokens.in + s.tokens.out} tokens`;
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

runBtn.addEventListener('click', run);
exBtn.addEventListener('click', loadExample);
loadExample();
