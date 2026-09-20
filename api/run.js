import { parse } from '../lib/asm.js';
import { run } from '../lib/runtime.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  try {
    const body = req.body ?? {};
    const { program: src, states } = body;
    if (!src || !states) {
      res.status(400).json({ error: 'Missing program or states' });
      return;
    }
    let program, result, error;
    try {
      program = parse(src);
      result = await run(program, states, {
        apiKey: process.env.AI_GATEWAY_API_KEY,
      });
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
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
}
