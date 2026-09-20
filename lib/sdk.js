// @judge-vm/sdk — fluent builder for JASM programs.
// Standalone: compile() produces a JASM string, no runtime dependency.

export class Program {
  constructor() {
    this._states = [];
    this._lines = [];
    this._regCounter = 0;
    this._labels = new Set();
    this._namedRefs = {};
  }

  state(...names) {
    for (const n of names) if (!this._states.includes(n)) this._states.push(n);
    return this;
  }

  _reg(kind) {
    const name = `%r${this._regCounter++}`;
    if (!this._namedRefs[kind]) this._namedRefs[kind] = [];
    this._namedRefs[kind].push(name);
    return name;
  }

  _resolveRef(ref) {
    if (typeof ref !== 'string') return ref;
    if (ref.startsWith('%r')) return ref;
    if (ref.startsWith('$')) {
      const m = ref.match(/^\$([a-z]+)(\d+)$/);
      if (!m) throw new Error(`Bad symbolic ref: ${ref}`);
      const [_, kind, idx] = m;
      const bucket = this._namedRefs[kind];
      if (!bucket || !bucket[+idx]) throw new Error(`No ${kind}[${idx}]; only ${bucket?.length ?? 0} exist`);
      return bucket[+idx];
    }
    throw new Error(`Bad ref '${ref}'.`);
  }

  sense(refName, kind, query) {
    const dest = this._reg('sense');
    this._lines.push(`SENSE ${dest}, ${kind} ${JSON.stringify(query)} %${refName}`);
    return this;
  }

  recall(corpusName, query, opts = {}) {
    const dest = this._reg('recall');
    const optStr = [
      opts.top != null ? `top=${opts.top}` : null,
      opts.filter != null ? `filter=${opts.filter}` : null,
      opts.expand != null ? `expand=${opts.expand}` : null,
    ].filter(Boolean).join(' ');
    this._lines.push(`RECALL ${dest}${optStr ? ', ' + optStr : ''} ${JSON.stringify(query)} %${corpusName}`);
    return this;
  }

  judge(stateName, kind, question, criteria) {
    const dest = this._reg('judge');
    let line = `JUDGE ${dest}, ${kind} ${JSON.stringify(question)}`;
    if (kind === 'choice' || kind === 'score') {
      if (!criteria) throw new Error(`judge(${kind}) requires criteria list`);
      const arr = kind === 'score'
        ? '[' + criteria.map(c => JSON.stringify(c)).join(', ') + ']'
        : '[' + criteria.join(', ') + ']';
      line += ` ${arr}`;
    }
    line += ` %${stateName}`;
    this._lines.push(line);
    return this;
  }

  gen(stateName, kind, prompt, opts = {}) {
    const dest = this._reg('gen');
    let line = `GEN ${dest}, ${kind} ${JSON.stringify(prompt)}`;
    if (kind === 'code' && opts.lang) line += ` lang=${JSON.stringify(opts.lang)}`;
    line += ` %${stateName}`;
    this._lines.push(line);
    return this;
  }

  label(name) {
    if (this._labels.has(name)) throw new Error(`Duplicate label: ${name}`);
    this._labels.add(name);
    this._lines.push(`.${name}:`);
    return this;
  }

  branch(refOrReg, cmp, value, target) {
    const reg = this._resolveRef(refOrReg);
    const rhs = typeof value === 'string' ? JSON.stringify(value) : value;
    this._lines.push(`BRANCH ${reg} ${cmp} ${rhs}, .${target}`);
    return this;
  }

  jump(target) {
    this._lines.push(`JUMP .${target}`);
    return this;
  }

  emit(payload) {
    const parts = [];
    for (const [k, v] of Object.entries(payload)) {
      if (typeof v === 'string' && (v.startsWith('$') || v.startsWith('%'))) {
        parts.push(`${k}: ${this._resolveRef(v)}`);
      } else {
        parts.push(`${k}: ${JSON.stringify(v)}`);
      }
    }
    this._lines.push(`EMIT { ${parts.join(', ')} }`);
    return this;
  }

  halt() {
    this._lines.push('HALT');
    return this;
  }

  compile() {
    const decls = this._states.map(s => `.state ${s}`);
    return [...decls, ...this._lines].join('\n');
  }

  describe() {
    return {
      states: [...this._states],
      instructionCount: this._lines.length,
      registers: { ...this._namedRefs },
      totalRegisters: this._regCounter,
    };
  }
}

export function jasm() {
  return new Program();
}
