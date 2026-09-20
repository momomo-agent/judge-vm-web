// @judge-vm/runtime backends — mock + real backends for JLMP primitives.
//
// Each primitive gets its own backend interface, so we can plug in
// - mock (deterministic, free, for testing)
// - production (real APIs today: Jev / LLM / vector DB / VLM)
// - hardware (future: TSU / transformer ASIC / M-chip / NPU)

import { batch as jevBatchDefault } from './primitives.js';

// ============================================================================
// J — Judge backend (Jev via Vercel AI Gateway; already implemented in primitives)
// ============================================================================
export const jBackend = { batch: jevBatchDefault };

// ============================================================================
// L — Language backend
// ============================================================================
// A GEN "batch" of N instructions in the same basic block runs sequentially
// today (LLMs don't have a real batch API like Jev does); but we still expose
// the same shape so future L hardware can implement true batching.

export function mockLBackend(fixtures = {}) {
  return async function generateBatch(state, gens, opts) {
    const out = {};
    for (const [name, g] of Object.entries(gens)) {
      const fx = fixtures[name];
      if (fx === undefined) {
        // Deterministic mock: echo the prompt kind + first 40 chars
        const stub = `[MOCK GEN ${g.kind}] ${g.prompt.slice(0, 40)}…`;
        if (g.kind === 'text') out[name] = { text: stub, tokens: 12, finishReason: 'mock' };
        else if (g.kind === 'json') out[name] = { value: {}, text: '{}', tokens: 4 };
        else if (g.kind === 'code') out[name] = { code: `// mock ${g.opts?.lang ?? 'js'}`, lang: g.opts?.lang ?? 'js', tokens: 6 };
      } else if (typeof fx === 'string') {
        out[name] = { text: fx, tokens: fx.length / 4 | 0, finishReason: 'mock' };
      } else {
        out[name] = fx;
      }
    }
    out._meta = { latencyMs: 1, usage: { inputTokens: 0, outputTokens: 0 } };
    return out;
  };
}

// Real L backend using Vercel AI Gateway + generateText.
// Lazy imports so the runtime doesn't force `ai` on programs that don't need it.
export function makeRealLBackend({ apiKey, model = 'anthropic/claude-3.5-haiku' } = {}) {
  return async function generateBatch(state, gens, opts = {}) {
    const { generateText, generateObject } = await import('ai');
    const { createGateway } = await import('@ai-sdk/gateway');
    const gateway = createGateway({ apiKey: apiKey ?? process.env.AI_GATEWAY_API_KEY });
    const chosenModel = opts.model ?? model;

    const out = {};
    const t0 = Date.now();
    let usage = { inputTokens: 0, outputTokens: 0 };

    // No true multi-question batching for LLMs (yet); run sequentially.
    for (const [name, g] of Object.entries(gens)) {
      // Inject state into the prompt as {state} substitution.
      const stateRef = g.stateRef.replace('%', '');
      const stateVal = state[stateRef] ?? state; // for the batch case, `state` is the resolved value
      const stateStr = typeof stateVal === 'string' ? stateVal : JSON.stringify(stateVal);
      const filledPrompt = g.prompt.replace(/\{state\}/g, stateStr);

      if (g.kind === 'text') {
        const r = await generateText({ model: gateway(chosenModel), prompt: `State:\n${stateStr}\n\nTask: ${filledPrompt}` });
        out[name] = { text: r.text, tokens: r.usage?.totalTokens ?? 0, finishReason: r.finishReason ?? 'stop' };
        usage.inputTokens += r.usage?.inputTokens ?? 0;
        usage.outputTokens += r.usage?.outputTokens ?? 0;
      } else if (g.kind === 'code') {
        const r = await generateText({ model: gateway(chosenModel), prompt: `State:\n${stateStr}\n\nWrite ${g.opts?.lang ?? 'code'}: ${filledPrompt}\n\nReturn only the code, no prose.` });
        out[name] = { code: r.text, lang: g.opts?.lang ?? 'text', tokens: r.usage?.totalTokens ?? 0 };
        usage.inputTokens += r.usage?.inputTokens ?? 0;
        usage.outputTokens += r.usage?.outputTokens ?? 0;
      } else if (g.kind === 'json') {
        const r = await generateText({ model: gateway(chosenModel), prompt: `State:\n${stateStr}\n\nRespond as valid JSON only.\nTask: ${filledPrompt}` });
        let value;
        try { value = JSON.parse(r.text); } catch { value = { _raw: r.text, _parseError: true }; }
        out[name] = { value, text: r.text, tokens: r.usage?.totalTokens ?? 0 };
        usage.inputTokens += r.usage?.inputTokens ?? 0;
        usage.outputTokens += r.usage?.outputTokens ?? 0;
      }
    }

    out._meta = { latencyMs: Date.now() - t0, usage };
    return out;
  };
}

// ============================================================================
// M — Memory backend
// ============================================================================
// A `corpus` is an object with a query method:
//   corpus.recall(query, opts) -> { hits: [{id, score, content, meta}] }
// The M backend simply invokes that method.

export function mockMBackend(fixtures = {}) {
  return async function recallBatch(corpora, recalls, opts) {
    const out = {};
    for (const [name, r] of Object.entries(recalls)) {
      const fx = fixtures[name];
      if (fx !== undefined) {
        out[name] = Array.isArray(fx) ? { hits: fx, query: r.query } : fx;
      } else {
        // Deterministic mock: 3 fake hits
        out[name] = {
          query: r.query,
          hits: [
            { id: `mock:${name}:1`, score: 0.95, content: `Mock hit for "${r.query}"`, meta: {} },
            { id: `mock:${name}:2`, score: 0.80, content: `Another mock hit`, meta: {} },
            { id: `mock:${name}:3`, score: 0.65, content: `Third mock hit`, meta: {} },
          ].slice(0, r.opts?.top ?? 3),
        };
      }
    }
    out._meta = { latencyMs: 1, usage: { inputTokens: 0, outputTokens: 0 } };
    return out;
  };
}

// Real M backend using a plug-in corpus object (e.g. wrapping memgraph).
// The `corpora` param is an object mapping name -> { recall(query, opts) }
export function makeRealMBackend() {
  return async function recallBatch(corpora, recalls, opts) {
    const out = {};
    const t0 = Date.now();
    for (const [name, r] of Object.entries(recalls)) {
      const corpusName = r.corpusRef.replace('%', '');
      const corpus = corpora[corpusName];
      if (!corpus || typeof corpus.recall !== 'function') {
        throw new Error(`M backend: corpus '${corpusName}' does not implement .recall(query, opts)`);
      }
      const result = await corpus.recall(r.query, r.opts);
      out[name] = { query: r.query, hits: result.hits ?? result };
    }
    out._meta = { latencyMs: Date.now() - t0, usage: { inputTokens: 0, outputTokens: 0 } };
    return out;
  };
}

// ============================================================================
// P — Perceive backend
// ============================================================================
// Today: VLM APIs (Claude, GPT-4o, Gemini). Future: on-device NPU.

export function mockPBackend(fixtures = {}) {
  return async function senseBatch(refs, senses, opts) {
    const out = {};
    for (const [name, s] of Object.entries(senses)) {
      const fx = fixtures[name];
      if (fx !== undefined) {
        out[name] = fx;
      } else if (s.kind === 'image') {
        out[name] = { facts: { _mock: `saw image, query="${s.query}"` }, text: '[mock image content]' };
      } else if (s.kind === 'audio') {
        out[name] = { transcript: `[mock transcript for "${s.query}"]`, speaker: 'unknown' };
      } else if (s.kind === 'video') {
        out[name] = { scenes: [{ t: 0, description: `[mock scene, query="${s.query}"]` }], transcript: '[mock]' };
      }
    }
    out._meta = { latencyMs: 1, usage: { inputTokens: 0, outputTokens: 0 } };
    return out;
  };
}

// Real P backend using a VLM via Vercel AI Gateway.
export function makeRealPBackend({ apiKey, model = 'anthropic/claude-3.5-sonnet' } = {}) {
  return async function senseBatch(refs, senses, opts = {}) {
    const { generateText } = await import('ai');
    const { createGateway } = await import('@ai-sdk/gateway');
    const gateway = createGateway({ apiKey: apiKey ?? process.env.AI_GATEWAY_API_KEY });

    const out = {};
    const t0 = Date.now();
    let usage = { inputTokens: 0, outputTokens: 0 };

    for (const [name, s] of Object.entries(senses)) {
      const refKey = s.refName.replace('%', '');
      const refValue = refs[refKey]; // could be URL, base64, or data:...
      if (s.kind === 'image') {
        const parts = [
          { type: 'text', text: `Question: ${s.query}\n\nExtract facts as concise JSON-like text.` },
          { type: 'image', image: refValue },
        ];
        const r = await generateText({ model: gateway(opts.model ?? model), messages: [{ role: 'user', content: parts }] });
        out[name] = { facts: { extracted: r.text }, text: r.text };
        usage.inputTokens += r.usage?.inputTokens ?? 0;
        usage.outputTokens += r.usage?.outputTokens ?? 0;
      } else if (s.kind === 'audio' || s.kind === 'video') {
        // v0.2: fall back to text description if backend can't handle A/V
        out[name] = { _unsupported: `P backend does not yet support ${s.kind} (v0.2 hook only)` };
      }
    }

    out._meta = { latencyMs: Date.now() - t0, usage };
    return out;
  };
}
