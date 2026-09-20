// @judge-vm/primitives — Layer 1: semantic transistors
//
// Typed wrappers for Jev's three primitives + composition combinators.
// This layer is pure: given state, it returns typed results.
//
// Redstone analogy:
//   noul   = redstone torch (NOT gate, but probabilistic)
//   choice = splitter (route to 1-of-N)
//   score  = comparator (position on ordered levels)

import { experimental_evaluate as evaluate } from 'ai';

const MODEL = 'typesafe-ai/jev';

// ============================================================================
// Backend: one call = one HTTP request to Jev
// ============================================================================

/**
 * Low-level: call Jev with a bundle of typed questions on shared state.
 * All 3 primitives ultimately go through this.
 *
 * @param {any} state - unstructured program state
 * @param {Record<string, Question>} questions - typed questions
 * @param {{ model?: string, apiKey?: string, signal?: AbortSignal }} opts
 * @returns {Promise<EvalResult>}
 */
export async function judgeCall(state, questions, opts = {}) {
  const t0 = Date.now();
  const result = await evaluate({
    model: opts.model ?? MODEL,
    state,
    questions,
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    ...(opts.signal ? { abortSignal: opts.signal } : {}),
  });
  return {
    answers: result.answers,
    usage: result.usage,
    latencyMs: Date.now() - t0,
    providerMetadata: result.providerMetadata,
  };
}

// ============================================================================
// Layer 1: three primitives — typed convenience wrappers
// ============================================================================

/**
 * Noul: yes/no with probability.
 * Returns a number in [0, 1] — the probability the statement is true.
 *
 * @example
 *   const p = await noul("The message is urgent", ticketText)
 *   if (p > 0.7) escalate()
 */
export async function noul(instructions, state, opts = {}) {
  const r = await judgeCall(state, {
    q: { type: 'boolean', instructions },
  }, opts);
  return {
    p: r.answers.q.probability,
    _meta: { latencyMs: r.latencyMs, usage: r.usage },
  };
}

/**
 * Choice: pick 1-of-N from a labelled set.
 * @example
 *   const c = await choice("Which team?", { billing: "...", tech: "..." }, ticket)
 *   route(c.pick)
 */
export async function choice(instructions, criteria, state, opts = {}) {
  const r = await judgeCall(state, {
    q: { type: 'choice', instructions, criteria },
  }, opts);
  const a = r.answers.q;
  return {
    pick: a.choice,
    probs: a.probabilities,
    confidence: r.providerMetadata?.typesafe?.confidence?.q ?? null,
    _meta: { latencyMs: r.latencyMs, usage: r.usage },
  };
}

/**
 * Score: position on an ordered rubric.
 * Returns a continuous value that can land BETWEEN levels (e.g. 2.97).
 * @example
 *   const s = await score("How urgent?", ["low", "med", "high"], text)
 *   priority = s.value  // 1.85 means mostly "high" with some "med" mass
 */
export async function score(instructions, levels, state, opts = {}) {
  const r = await judgeCall(state, {
    q: { type: 'score', instructions, criteria: levels },
  }, opts);
  const a = r.answers.q;
  return {
    value: a.score,
    probs: a.probabilities,
    confidence: r.providerMetadata?.typesafe?.confidence?.q ?? null,
    _meta: { latencyMs: r.latencyMs, usage: r.usage },
  };
}

// ============================================================================
// Layer 1.5: combinators — compose primitives locally without extra API calls
// ============================================================================

/** Not: reverse a Noul probability. Pure local, no API call. */
export const not = (n) => ({ p: 1 - n.p });

/** And: probability of all Nouls being true (assumes independence). */
export const and = (...nouls) => ({
  p: nouls.reduce((acc, n) => acc * n.p, 1),
});

/** Or: probability that at least one Noul is true (assumes independence). */
export const or = (...nouls) => ({
  p: 1 - nouls.reduce((acc, n) => acc * (1 - n.p), 1),
});

/** Threshold: collapse a Score to a Noul by comparing to cutoff. */
export const threshold = (s, cutoff) => ({
  p: s.value > cutoff ? 1 : 0,  // hard threshold; use `above` for soft
});

/** Above: probability mass of a Score above a level index (soft threshold). */
export const above = (s, levelIdx) => {
  let mass = 0;
  for (const [k, v] of Object.entries(s.probs)) {
    if (Number(k) > levelIdx) mass += v;
  }
  return { p: mass };
};

/** Argmax: collapse a Score to the index of its most likely level. */
export const argmax = (s) => {
  let best = -1, bestP = -1;
  for (const [k, v] of Object.entries(s.probs)) {
    if (v > bestP) { bestP = v; best = Number(k); }
  }
  return best;
};

/**
 * Batch: ask MANY questions in ONE API call — the killer feature.
 * @param state - shared state
 * @param questionMap - { name: { type, instructions, criteria? } }
 * @returns { name: { …parsed result… }, _meta }
 */
export async function batch(state, questionMap, opts = {}) {
  const r = await judgeCall(state, questionMap, opts);
  const out = {};
  for (const [name, q] of Object.entries(questionMap)) {
    const a = r.answers[name];
    if (q.type === 'boolean') {
      out[name] = { p: a.probability };
    } else if (q.type === 'choice') {
      out[name] = {
        pick: a.choice,
        probs: a.probabilities,
        confidence: r.providerMetadata?.typesafe?.confidence?.[name] ?? null,
      };
    } else if (q.type === 'score') {
      out[name] = {
        value: a.score,
        probs: a.probabilities,
        confidence: r.providerMetadata?.typesafe?.confidence?.[name] ?? null,
      };
    }
  }
  out._meta = { latencyMs: r.latencyMs, usage: r.usage };
  return out;
}

// ============================================================================
// Question builders — for constructing batch() input more ergonomically
// ============================================================================

export const Q = {
  noul: (instructions) => ({ type: 'boolean', instructions }),
  choice: (instructions, criteria) => ({ type: 'choice', instructions, criteria }),
  score: (instructions, levels) => ({ type: 'score', instructions, criteria: levels }),
};
