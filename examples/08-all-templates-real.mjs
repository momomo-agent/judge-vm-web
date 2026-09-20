// Run all 6 Playground templates against the real backends (Jev + Claude).
// Emits a summary of what each program actually produced.

import { parse } from '../packages/asm/index.js';
import { run } from '../packages/runtime/index.js';
import { jevBackend, llmBackend, mockMBackend, mockPBackend } from '../packages/runtime/index.js';
import { TEMPLATES } from '../../judge-vm-web/lib/templates.js';

const results = [];

for (const t of TEMPLATES) {
  const t0 = Date.now();
  console.log(`\n=== [${t.id}] ${t.name} ===`);
  console.log(`  ${t.tagline}`);
  try {
    const program = parse(t.jasm);
    const result = await run(program, t.states, {
      backend: jevBackend(),             // J → real Jev
      lBackend: llmBackend(),            // L → real Claude
      mBackend: mockMBackend(),          // M → mock (no real corpus wired)
      pBackend: mockPBackend(),          // P → mock (no vision wired)
    });

    const elapsed = Date.now() - t0;
    const trace = result.trace;
    const batches = trace.filter(x => x.kind === 'batch');
    const primitives = batches.map(x => x.primitive).join('→');

    console.log(`  ok · ${elapsed}ms · primitives: ${primitives}`);
    console.log(`  api calls: ${result.stats.apiCalls}, tokens: ${JSON.stringify(result.stats.tokens)}`);
    console.log(`  emits: ${JSON.stringify(result.emits, null, 2).slice(0, 800)}`);

    results.push({
      id: t.id,
      name: t.name,
      inputStates: t.states,
      primitives,
      elapsedMs: elapsed,
      apiCalls: result.stats.apiCalls,
      tokens: result.stats.tokens,
      registers: result.registers,
      emits: result.emits,
      trace: batches.map(b => ({
        primitive: b.primitive,
        latencyMs: b.latencyMs,
        items: (b.detail.judges || b.detail.gens || b.detail.recalls || b.detail.senses || []).map(item => ({
          dest: item.dest,
          kind: item.kind,
          query: item.instructions || item.prompt || item.query,
          answer: b.detail.answers?.[item.dest],
        })),
      })),
    });
  } catch (e) {
    console.log(`  FAIL: ${e.message}`);
    results.push({ id: t.id, error: e.message });
  }
}

console.log('\n\n=== SUMMARY JSON ===');
console.log(JSON.stringify(results, null, 2));
