// @judge-vm/asm — Layer 2: JASM parser
//
// Parses JASM source text into a program AST that Runtime executes.
// Focus: clarity over performance. Robustness over cleverness.

/**
 * @typedef {Object} JudgeInstr
 * @property {'JUDGE'} op
 * @property {string} dest       - register name like "%r0"
 * @property {'noul'|'choice'|'score'} kind
 * @property {string} instructions
 * @property {string[]|Object} criteria  - array for score, object for choice, null for noul
 * @property {string} stateRef
 * @property {number} line
 */

/**
 * @typedef {Object} BranchInstr
 * @property {'BRANCH'} op
 * @property {string} left        - register name
 * @property {'>'|'<'|'>='|'<='|'=='|'~'} cmp
 * @property {number|string} right
 * @property {number} [delta]     - for ~ cmp
 * @property {string} target      - label
 * @property {number} line
 */

/**
 * @typedef {Object} JumpInstr
 * @property {'JUMP'} op
 * @property {string} target
 * @property {number} line
 */

/**
 * @typedef {Object} EmitInstr
 * @property {'EMIT'} op
 * @property {Object} payload
 * @property {number} line
 */

/**
 * @typedef {Object} HaltInstr
 * @property {'HALT'} op
 * @property {number} line
 */

/**
 * @typedef {Object} JASMProgram
 * @property {string[]} stateNames
 * @property {Array<JudgeInstr|BranchInstr|JumpInstr|EmitInstr|HaltInstr>} instructions
 * @property {Record<string, number>} labels     - label name → instruction index
 * @property {string} source                     - original text for error messages
 */

// ============================================================================
// Tokenizer helpers
// ============================================================================

function stripComment(line) {
  // Remove `;` comments unless inside quotes
  let out = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i - 1] !== '\\') inQ = !inQ;
    if (c === ';' && !inQ) break;
    out += c;
  }
  return out;
}

function tokenize(text) {
  // Preserves whole quoted strings and bracket groups as single tokens.
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === ',') { i++; continue; }
    if (c === '"') {
      let end = i + 1;
      while (end < text.length && !(text[end] === '"' && text[end - 1] !== '\\')) end++;
      tokens.push(text.slice(i, end + 1));
      i = end + 1;
    } else if (c === '[') {
      let depth = 1, end = i + 1;
      while (end < text.length && depth > 0) {
        if (text[end] === '[') depth++;
        else if (text[end] === ']') depth--;
        end++;
      }
      tokens.push(text.slice(i, end));
      i = end;
    } else if (c === '{') {
      let depth = 1, end = i + 1;
      while (end < text.length && depth > 0) {
        if (text[end] === '{') depth++;
        else if (text[end] === '}') depth--;
        end++;
      }
      tokens.push(text.slice(i, end));
      i = end;
    } else {
      let end = i;
      while (end < text.length && !' \t,'.includes(text[end])) end++;
      tokens.push(text.slice(i, end));
      i = end;
    }
  }
  return tokens;
}

function parseString(tok) {
  if (!(tok.startsWith('"') && tok.endsWith('"'))) {
    throw new Error(`Expected quoted string, got: ${tok}`);
  }
  return tok.slice(1, -1).replace(/\\"/g, '"');
}

function parseList(tok) {
  // "[a, b, c]" or `["with space", "..."]` — quoted or bare identifiers
  if (!(tok.startsWith('[') && tok.endsWith(']'))) {
    throw new Error(`Expected list, got: ${tok}`);
  }
  const inner = tok.slice(1, -1).trim();
  if (!inner) return [];
  // Simple splitter that respects quotes
  const items = [];
  let cur = '';
  let inQ = false;
  for (const c of inner) {
    if (c === '"') { inQ = !inQ; cur += c; }
    else if (c === ',' && !inQ) {
      if (cur.trim()) items.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) items.push(cur.trim());
  return items.map(s => {
    if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
    return s;
  });
}

function parseObjectLiteral(tok) {
  // Loose JSON5-like: keys can be bare, values can reference %registers.
  // We convert %reg refs to a marker string that Runtime resolves.
  if (!(tok.startsWith('{') && tok.endsWith('}'))) {
    throw new Error(`Expected object literal, got: ${tok}`);
  }
  // Convert bare keys to quoted, and %reg to "__REG__:name"
  const inner = tok.slice(1, -1);
  const rewritten = inner
    .replace(/(\w+)\s*:/g, '"$1":')
    .replace(/%(\w+)/g, '"__REG__:$1"');
  try {
    return JSON.parse('{' + rewritten + '}');
  } catch (e) {
    throw new Error(`Cannot parse object literal ${tok}: ${e.message}`);
  }
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse JASM source into a program.
 * @param {string} source
 * @returns {JASMProgram}
 */
export function parse(source) {
  const rawLines = source.split(/\r?\n/);
  const instructions = [];
  const labels = {};
  const stateNames = [];

  // Multi-line JUDGE support: physical lines that end without a state ref get merged.
  const logicalLines = [];
  let buf = '';
  let bufLine = 0;
  for (let li = 0; li < rawLines.length; li++) {
    const cleaned = stripComment(rawLines[li]).trim();
    if (!cleaned) {
      if (buf) { logicalLines.push({ text: buf, line: bufLine }); buf = ''; }
      continue;
    }
    if (!buf) { buf = cleaned; bufLine = li + 1; }
    else buf += ' ' + cleaned;
    // A logical line ends when we see a state ref (%foo at end) or terminator
    // Heuristic: labels/directives are single-line; JUDGE ends at %stateRef;
    // BRANCH/JUMP/EMIT/HALT end at line end without continuation marker.
    // Simple rule: a line ending in `[` or `,` keeps going.
    if (!/[,\[]\s*$/.test(cleaned)) {
      logicalLines.push({ text: buf, line: bufLine });
      buf = '';
    }
  }
  if (buf) logicalLines.push({ text: buf, line: bufLine });

  for (const { text, line } of logicalLines) {
    // Label: `name:` (with or without leading dot)
    if (text.endsWith(':') && !text.includes(' ')) {
      let name = text.slice(0, -1);
      if (name.startsWith('.')) name = name.slice(1);
      labels[name] = instructions.length;
      continue;
    }

    const tokens = tokenize(text);
    if (tokens.length === 0) continue;
    const op = tokens[0].toUpperCase();

    if (op === '.STATE') {
      stateNames.push(tokens[1]);
      continue;
    }

    if (op === 'JUDGE') {
      // JUDGE %reg, kind "instr" [criteria]? %state
      const dest = tokens[1];
      const kind = tokens[2].toLowerCase();
      const instructions_ = parseString(tokens[3]);
      let criteria = null;
      let stateRef;
      if (kind === 'noul') {
        stateRef = tokens[4];
      } else {
        // choice or score: list before state
        criteria = parseList(tokens[4]);
        if (kind === 'choice') {
          // Choice criteria can be either [key1, key2, …] with no descriptions,
          // OR passed as bare identifiers where each is its own key+desc=key.
          // For v0, treat bare list as { key: key } and warn.
          const obj = {};
          for (const k of criteria) obj[k] = k;
          criteria = obj;
        }
        stateRef = tokens[5];
      }
      instructions.push({
        op: 'JUDGE', dest, kind,
        instructions: instructions_, criteria, stateRef, line,
      });
      continue;
    }

    // GEN — L primitive: text / json / code generation
    // GEN %reg, kind "prompt" %state
    if (op === 'GEN') {
      const dest = tokens[1];
      const kind = tokens[2].toLowerCase();
      if (!['text', 'json', 'code'].includes(kind)) {
        throw new Error(`GEN kind must be text|json|code, got '${kind}' on line ${line}`);
      }
      const prompt = parseString(tokens[3]);
      let opts = null;
      let stateRef;
      // Optional: json {schema} | code lang="..."
      if (kind === 'json' && tokens[4]?.startsWith('{')) {
        opts = { schema: parseObjectLiteral(tokens[4]) };
        stateRef = tokens[5];
      } else if (kind === 'code' && tokens[4]?.startsWith('lang=')) {
        opts = { lang: tokens[4].slice(5).replace(/^"|"$/g, '') };
        stateRef = tokens[5];
      } else {
        stateRef = tokens[4];
      }
      instructions.push({
        op: 'GEN', dest, kind, prompt, opts, stateRef, line,
      });
      continue;
    }

    // RECALL — M primitive: memory / knowledge lookup
    // RECALL %reg, top=N "query" %corpus
    if (op === 'RECALL') {
      const dest = tokens[1];
      const opts = { top: 5, filter: null, expand: 0 };
      let idx = 2;
      while (tokens[idx] && tokens[idx].includes('=')) {
        const [k, v] = tokens[idx].split('=');
        if (k === 'top') opts.top = Number(v);
        else if (k === 'filter') opts.filter = v;
        else if (k === 'expand') opts.expand = Number(v);
        idx++;
      }
      const query = parseString(tokens[idx++]);
      const corpusRef = tokens[idx];
      if (!corpusRef || !corpusRef.startsWith('%')) {
        throw new Error(`RECALL needs %corpus on line ${line}`);
      }
      instructions.push({
        op: 'RECALL', dest, query, corpusRef, opts, line,
      });
      continue;
    }

    // SENSE — P primitive: perceive image/audio/video
    // SENSE %reg, kind "what to extract" %ref
    if (op === 'SENSE') {
      const dest = tokens[1];
      const kind = tokens[2].toLowerCase();
      if (!['image', 'audio', 'video'].includes(kind)) {
        throw new Error(`SENSE kind must be image|audio|video, got '${kind}' on line ${line}`);
      }
      const query = parseString(tokens[3]);
      const refName = tokens[4];
      if (!refName || !refName.startsWith('%')) {
        throw new Error(`SENSE needs %reference on line ${line}`);
      }
      instructions.push({
        op: 'SENSE', dest, kind, query, refName, line,
      });
      continue;
    }

    if (op === 'BRANCH') {
      // BRANCH %reg CMP value, .label
      const left = tokens[1];
      const cmp = tokens[2];
      let right = tokens[3];
      let delta = null;
      // handle ~ N ± D
      if (cmp === '~') {
        // tokens: BRANCH %r ~ N ± D .label
        right = Number(tokens[3]);
        if (tokens[4] === '±' || tokens[4] === '+-') {
          delta = Number(tokens[5]);
          var target = tokens[6];
        } else {
          throw new Error(`BRANCH ~ needs ± delta on line ${line}`);
        }
      } else {
        // parse right side
        if (right.startsWith('"') && right.endsWith('"')) right = parseString(right);
        else if (!isNaN(Number(right))) right = Number(right);
        var target = tokens[4];
      }
      if (!target || !target.startsWith('.')) {
        throw new Error(`BRANCH needs .label target on line ${line}`);
      }
      instructions.push({
        op: 'BRANCH', left, cmp, right, delta, target: target.slice(1), line,
      });
      continue;
    }

    if (op === 'JUMP') {
      const target = tokens[1];
      if (!target.startsWith('.')) throw new Error(`JUMP needs .label on line ${line}`);
      instructions.push({ op: 'JUMP', target: target.slice(1), line });
      continue;
    }

    if (op === 'EMIT') {
      // EMIT { ... }
      const payload = parseObjectLiteral(tokens.slice(1).join(' '));
      instructions.push({ op: 'EMIT', payload, line });
      continue;
    }

    if (op === 'HALT') {
      instructions.push({ op: 'HALT', line });
      continue;
    }

    throw new Error(`Unknown op '${op}' on line ${line}`);
  }

  return { stateNames, instructions, labels, source };
}

/**
 * Serialize a program back to JASM text (round-trip).
 */
export function serialize(program) {
  const lines = [];
  for (const s of program.stateNames) lines.push(`.state ${s}`);
  lines.push('');

  // reverse-map labels: instruction index → label name
  const labelAt = {};
  for (const [name, idx] of Object.entries(program.labels)) labelAt[idx] = name;

  for (let i = 0; i < program.instructions.length; i++) {
    if (labelAt[i]) lines.push(`${labelAt[i]}:`);
    const inst = program.instructions[i];
    if (inst.op === 'JUDGE') {
      const criteria = inst.kind === 'noul' ? '' :
        inst.kind === 'choice'
          ? ' [' + Object.keys(inst.criteria).join(', ') + ']'
          : ' [' + inst.criteria.map(x => `"${x}"`).join(', ') + ']';
      lines.push(`  JUDGE ${inst.dest}, ${inst.kind} "${inst.instructions}"${criteria} ${inst.stateRef}`);
    } else if (inst.op === 'BRANCH') {
      const rhs = typeof inst.right === 'string' ? `"${inst.right}"` : inst.right;
      const suffix = inst.cmp === '~' ? `${inst.left} ~ ${rhs} ± ${inst.delta}` : `${inst.left} ${inst.cmp} ${rhs}`;
      lines.push(`  BRANCH ${suffix}, .${inst.target}`);
    } else if (inst.op === 'JUMP') {
      lines.push(`  JUMP .${inst.target}`);
    } else if (inst.op === 'EMIT') {
      lines.push(`  EMIT ${JSON.stringify(inst.payload).replace(/"__REG__:(\w+)"/g, '%$1')}`);
    } else if (inst.op === 'HALT') {
      lines.push('  HALT');
    }
  }
  return lines.join('\n');
}
