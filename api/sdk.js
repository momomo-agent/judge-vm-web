// POST /api/sdk — compile SDK code to JASM
//
// Input:  { code: "jasm().state(...)...compile()" }
// Output: { jasm: "...", states: [...], error?: "..." }
//
// The user code runs in a minimal sandbox with only `jasm()` available.

import vm from 'node:vm';
import { Program, jasm } from '../lib/sdk.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const { code } = req.body ?? {};
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing `code` string' });
    return;
  }

  if (code.length > 10_000) {
    res.status(400).json({ error: 'Code too long (max 10KB)' });
    return;
  }

  try {
    // Build a sandbox context with only the SDK builder exposed.
    const context = vm.createContext({
      jasm,
      // Freeze console so user can't break things:
      console: Object.freeze({ log() {}, warn() {}, error() {} }),
    });

    // Wrap user code: must return the program builder.
    // We support two styles:
    //   1. `jasm().state(...).judge(...).emit(...)` — expression
    //   2. `const flow = jasm(); flow.state(...); flow` — block ending with expression
    const wrapped = `(function(){ ${code.includes(';') ? code : `return ${code}`} })()`;

    const result = vm.runInContext(wrapped, context, {
      timeout: 2000,
      filename: 'user-sdk.js',
    });

    if (!(result instanceof Program)) {
      res.status(400).json({
        error: 'Code must return a Program (the result of jasm()...chain). Got: ' + typeof result,
      });
      return;
    }

    const jasmSrc = result.compile();
    const desc = result.describe();

    res.status(200).json({
      jasm: jasmSrc,
      description: desc,
    });
  } catch (e) {
    const msg = e.message || String(e);
    // Distinguish compile/syntax errors from sandbox errors
    if (e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      res.status(400).json({ error: 'Code execution timed out (2s limit)' });
    } else {
      res.status(200).json({ error: msg });
    }
  }
}
