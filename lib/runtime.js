// @judge-vm/runtime — Layer 3: JASM virtual machine
//
// Executes a parsed JASM program. Key features:
//   - Basic-block batching: consecutive JUDGEs → 1 API call
//   - Register file: %r0..%rN hold typed Judge results
//   - Probabilistic BRANCH: compares Noul.p / Score.value / Choice.pick
//   - Pluggable backend: default = Vercel AI Gateway via @judge-vm/primitives
//   - Full trace: every step recorded for observability
//
// Redstone analogy: this is the "MC game engine" — it ticks the wires.

import { batch as jevBatch } from './primitives.js';

/**
 * @typedef {Object} TraceEvent
 * @property {number} pc
 * @property {string} kind   - 'batch'|'branch'|'emit'|'jump'|'halt'
 * @property {any} detail
 * @property {number} [latencyMs]
 * @property {any} [usage]
 */

/**
 * @typedef {Object} RunResult
 * @property {Object[]} emits            - EMIT payloads (register refs resolved)
 * @property {Object} registers          - final register state
 * @property {TraceEvent[]} trace        - full execution trace
 * @property {Object} stats              - { totalMs, apiCalls, tokens: { in, out } }
 */

const MAX_STEPS = 10_000;  // guard against runaway loops

// ============================================================================
// Basic-block detection: find run of consecutive JUDGE ops starting at pc
// ============================================================================
function collectJudgeBlock(program, pc) {
  const judges = [];
  let cur = pc;
  while (cur < program.instructions.length && program.instructions[cur].op === 'JUDGE') {
    judges.push(program.instructions[cur]);
    cur++;
  }
  return { judges, nextPc: cur };
}

// ============================================================================
// Register / payload resolution
// ============================================================================
function resolvePayload(payload, registers) {
  // Replace "__REG__:name" markers with actual register values.
  // For registers holding compound results (Choice.pick / Score.value / Noul.p),
  // pick the primary field for readability.
  const resolve = (v) => {
    if (typeof v === 'string' && v.startsWith('__REG__:')) {
      const name = v.slice('__REG__:'.length);
      const reg = registers[`%${name}`];
      if (!reg) return `[undefined %${name}]`;
      if ('pick' in reg) return reg.pick;
      if ('value' in reg) return reg.value;
      if ('p' in reg) return reg.p;
      return reg;
    }
    if (Array.isArray(v)) return v.map(resolve);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, val] of Object.entries(v)) o[k] = resolve(val);
      return o;
    }
    return v;
  };
  return resolve(payload);
}

// ============================================================================
// BRANCH condition evaluation
// ============================================================================
function evalBranch(inst, registers) {
  const reg = registers[inst.left];
  if (!reg) throw new Error(`BRANCH: unknown register ${inst.left} at line ${inst.line}`);

  // Pick the primary numeric or string value from the register
  const lhs = 'pick' in reg ? reg.pick
            : 'value' in reg ? reg.value
            : 'p' in reg     ? reg.p
            : null;

  switch (inst.cmp) {
    case '>':  return lhs > inst.right;
    case '<':  return lhs < inst.right;
    case '>=': return lhs >= inst.right;
    case '<=': return lhs <= inst.right;
    case '==': return lhs === inst.right;
    case '!=': return lhs !== inst.right;
    case '~':  return Math.abs(lhs - inst.right) <= inst.delta;
    default: throw new Error(`Unknown cmp ${inst.cmp}`);
  }
}

// ============================================================================
// Main execution loop
// ============================================================================

/**
 * @param {import('@judge-vm/asm').JASMProgram} program
 * @param {Record<string, any>} states  - values for each .state name
 * @param {Object} opts
 * @param {(state, questions, opts) => Promise<any>} [opts.backend]  - default: jevBatch
 * @param {string} [opts.apiKey]
 * @param {string} [opts.model]
 * @param {(ev: TraceEvent) => void} [opts.onTrace]  - stream trace events
 * @returns {Promise<RunResult>}
 */
export async function run(program, states, opts = {}) {
  const backend = opts.backend ?? jevBatch;
  const registers = {};
  const emits = [];
  const trace = [];
  const stats = { totalMs: 0, apiCalls: 0, tokens: { in: 0, out: 0 } };
  const t0 = Date.now();
  let pc = 0;
  let steps = 0;

  // Verify all declared states are provided
  for (const name of program.stateNames) {
    if (!(name in states)) {
      throw new Error(`Missing state '${name}' — declared in .state but not provided`);
    }
  }

  const record = (ev) => {
    trace.push(ev);
    if (opts.onTrace) opts.onTrace(ev);
  };

  while (pc < program.instructions.length) {
    if (++steps > MAX_STEPS) throw new Error(`Runaway loop: exceeded ${MAX_STEPS} steps`);

    const inst = program.instructions[pc];

    // ---- BASIC BLOCK BATCHING: consecutive JUDGEs → 1 API call ----
    if (inst.op === 'JUDGE') {
      const { judges, nextPc } = collectJudgeBlock(program, pc);

      // Build batched question bundle
      // All judges in a block must share the same state ref (v0 restriction).
      const stateRef = judges[0].stateRef;
      for (const j of judges) {
        if (j.stateRef !== stateRef) {
          throw new Error(`Basic block mixes state refs (${stateRef} vs ${j.stateRef}). Split into separate blocks.`);
        }
      }
      const stateName = stateRef.startsWith('%') ? stateRef.slice(1) : stateRef;
      const stateValue = states[stateName];

      const questions = {};
      const destByName = {};
      for (const j of judges) {
        const name = j.dest.replace('%', '');
        destByName[name] = j.dest;
        if (j.kind === 'noul') {
          questions[name] = { type: 'boolean', instructions: j.instructions };
        } else if (j.kind === 'choice') {
          questions[name] = { type: 'choice', instructions: j.instructions, criteria: j.criteria };
        } else if (j.kind === 'score') {
          questions[name] = { type: 'score', instructions: j.instructions, criteria: j.criteria };
        }
      }

      const result = await backend(stateValue, questions, {
        apiKey: opts.apiKey,
        model: opts.model,
      });

      // Assign registers
      for (const name of Object.keys(destByName)) {
        registers[destByName[name]] = result[name];
      }

      stats.apiCalls++;
      stats.tokens.in += result._meta?.usage?.inputTokens ?? 0;
      stats.tokens.out += result._meta?.usage?.outputTokens ?? 0;

      record({
        pc,
        kind: 'batch',
        detail: {
          judges: judges.map(j => ({ dest: j.dest, kind: j.kind, instructions: j.instructions })),
          answers: Object.fromEntries(judges.map(j => [j.dest, registers[j.dest]])),
        },
        latencyMs: result._meta?.latencyMs,
        usage: result._meta?.usage,
      });

      pc = nextPc;
      continue;
    }

    // ---- BRANCH ----
    if (inst.op === 'BRANCH') {
      const taken = evalBranch(inst, registers);
      record({
        pc,
        kind: 'branch',
        detail: { cond: `${inst.left} ${inst.cmp} ${JSON.stringify(inst.right)}`, taken, target: inst.target },
      });
      if (taken) {
        if (!(inst.target in program.labels)) throw new Error(`Unknown label .${inst.target}`);
        pc = program.labels[inst.target];
      } else pc++;
      continue;
    }

    // ---- JUMP ----
    if (inst.op === 'JUMP') {
      record({ pc, kind: 'jump', detail: { target: inst.target } });
      if (!(inst.target in program.labels)) throw new Error(`Unknown label .${inst.target}`);
      pc = program.labels[inst.target];
      continue;
    }

    // ---- EMIT ----
    if (inst.op === 'EMIT') {
      const resolved = resolvePayload(inst.payload, registers);
      emits.push(resolved);
      record({ pc, kind: 'emit', detail: resolved });
      pc++;
      continue;
    }

    // ---- HALT ----
    if (inst.op === 'HALT') {
      record({ pc, kind: 'halt', detail: {} });
      break;
    }

    throw new Error(`Runtime: unknown op ${inst.op} at line ${inst.line}`);
  }

  stats.totalMs = Date.now() - t0;
  return { emits, registers, trace, stats };
}

// ============================================================================
// Mock backend for tests: deterministic answers
// ============================================================================
export function mockBackend(fixture) {
  return async (state, questions, opts) => {
    const out = {};
    for (const [name, q] of Object.entries(questions)) {
      const fx = fixture[name];
      if (!fx) throw new Error(`mockBackend: no fixture for '${name}'`);
      if (q.type === 'boolean') out[name] = { p: fx };
      else if (q.type === 'choice') out[name] = { pick: fx, probs: {}, confidence: 1 };
      else if (q.type === 'score') out[name] = { value: fx, probs: {}, confidence: 1 };
    }
    out._meta = { latencyMs: 1, usage: { inputTokens: 0, outputTokens: 0 } };
    return out;
  };
}
