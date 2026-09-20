import { parse } from '../lib/asm.js';
import {
  run,
  makeRealLBackend,
  mockLBackend,
  makeRealMBackend,
  mockMBackend,
  mockPBackend,
  makeRealPBackend,
} from '../lib/runtime.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  try {
    const body = req.body ?? {};
    const { program: src, states, corpora, refs, mock } = body;
    if (!src || !states) {
      res.status(400).json({ error: 'Missing program or states' });
      return;
    }

    const apiKey = process.env.AI_GATEWAY_API_KEY;

    // Backend selection:
    //   mock === "all"  → all four primitives are mocked (0 API cost)
    //   mock === "lmp"  → J is real (Jev free tier), L/M/P mocked
    //   default         → J is real, L is real, M/P mocked (no infra yet)
    const mockMode = mock ?? 'lmp';
    const runOpts = { apiKey, corpora: corpora ?? {}, refs: refs ?? {} };

    if (mockMode === 'all') {
      const { mockBackend } = await import('../lib/runtime.js');
      runOpts.backend = mockBackend({});
      runOpts.lBackend = mockLBackend();
      runOpts.mBackend = mockMBackend();
      runOpts.pBackend = mockPBackend();
    } else if (mockMode === 'lmp') {
      runOpts.lBackend = mockLBackend();
      runOpts.mBackend = mockMBackend();
      runOpts.pBackend = mockPBackend();
    } else {
      // 'real': J real, L real, M/P mock (no infra)
      runOpts.lBackend = makeRealLBackend({ apiKey, model: 'anthropic/claude-haiku-4-5' });
      runOpts.mBackend = mockMBackend();
      runOpts.pBackend = mockPBackend();
    }

    let program, result, error;
    try {
      program = parse(src);
      result = await run(program, states, runOpts);
    } catch (e) {
      error = e.message;
    }
    res.status(200).json({
      program: program ? {
        stateNames: program.stateNames,
        labels: program.labels,
        instructions: program.instructions,
      } : null,
      result,
      error,
      mockMode,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
}
