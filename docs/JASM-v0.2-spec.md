# JASM v0.2 — Assembly Language for JLMP

**JASM** (Judge Assembly) is the unified instruction set for the **JLMP** heterogeneous compute fabric.

> **JLMP = J + L + M + P**
> Four native operators of the next computing paradigm.

## The JLMP Hardware Fabric

| Op | Full Name | Function | Hardware roadmap | Timescale |
|-----|-----------|----------|-------------------|-----------|
| **J** | Judge | discrete decisions + probabilities over a known space | Extropic TSU, p-bit ASICs, Bayesian silicon | ~ms |
| **L** | Language | free-form token generation over an open space | Groq / Cerebras / Etched transformer ASIC | 100ms – 10s |
| **M** | Memory | recall relevant context from history / knowledge | Vector-search ASIC, CXL memory pool with inline embedding | μs – ms |
| **P** | Perceive | turn raw physical signal into semantic representation | Apple ANE, Qualcomm Hexagon, always-on NPUs | ms |

**CPU/GPU are still there — they run the arithmetic, IO, string handling, and control-flow glue.** JLMP is not a replacement; it's four new native operators added to the compute mix.

## Design principles

1. **Four primitives are peers, not a hierarchy.** `JUDGE / GEN / RECALL / SENSE` share the same instruction shape.
2. **Every JLMP op is a side-effect boundary.** Between them, everything is local (registers, control flow, EMIT). Between them, we can batch, cache, and reorder.
3. **Basic-block batching applies to every primitive.** N consecutive `JUDGE` → 1 J call. N consecutive `RECALL` → 1 M query. Ordering-independent ops in the same block get fused when the backend supports it.
4. **Register file is unified.** A `%r` slot might hold a Noul, a Choice, a Score, a generated string, a set of recalled ids, or an embedding+facts pair — the instruction reading it knows what type to expect.
5. **Portable across backends.** A JASM program written against v0.2 runs on today's software backends (Jev API, LLM API, vector DB, VLM API) and on tomorrow's JLMP hardware (TSU / transformer ASIC / M-chip / NPU).

## Instruction set

### JUDGE — the J primitive (unchanged from v0.1)

```asm
JUDGE %reg, noul   "question"                             %state
JUDGE %reg, choice "question" [opt1, opt2, ...]           %state
JUDGE %reg, score  "question" [level0, ..., levelN]       %state
```

Returns:
- `noul`   → `{ p: number in [0,1] }`
- `choice` → `{ pick, probs, confidence }`
- `score`  → `{ value, probs, confidence }`

### GEN — the L primitive (new in v0.2)

```asm
GEN %reg, text  "prompt template"                         %state [, opts]
GEN %reg, json  "prompt template" { schema-hint }         %state [, opts]
GEN %reg, code  "prompt template" lang="python|swift..."  %state [, opts]
```

Returns:
- `text` → `{ text: string, tokens: n, finishReason: string }`
- `json` → `{ value: object, text: string, tokens: n }`
- `code` → `{ code: string, lang: string, tokens: n }`

Rationale: `text` is default, `json` structures output, `code` is a common enough case to be first-class (so backends can route to code-tuned models when available).

### RECALL — the M primitive (new in v0.2)

```asm
RECALL %reg, top=N "query"                     %corpus
RECALL %reg, filter=key:val top=N "query"      %corpus
RECALL %reg, expand=1..3 "query"               %corpus     ; graph traversal
```

Returns:
- `{ hits: [{ id, score, content, meta }], query: string }`

`%corpus` is the memory space identifier (e.g. `%graph`, `%docs`, `%chat_history`). Different corpora can be routed to different M backends.

### SENSE — the P primitive (new in v0.2)

```asm
SENSE %reg, image  "what to extract"    %img_ref
SENSE %reg, audio  "what to extract"    %audio_ref
SENSE %reg, video  "what to extract"    %video_ref
```

Returns:
- `image` → `{ facts: object, embedding?: vec, bbox?: [...], text?: string }`
- `audio` → `{ transcript: string, speaker?: string, emotion?: string, embedding?: vec }`
- `video` → `{ scenes: [...], transcript: string, keyframes: [...] }`

The `"what to extract"` string constrains the perceiver — e.g. `"read the price tag"` vs `"identify emotion"` — so a P chip can shortcut to specialized paths.

### Control flow (shared, unchanged)

```asm
BRANCH %r cmp value, .label      ; cmp: > < >= <= == != ~
JUMP   .label
EMIT   { key: %r, ... }
HALT
```

BRANCH conditions on JLMP register types:

| Register type | What `%r cmp value` compares |
|---|---|
| Noul  | `.p` (probability) |
| Choice | `.pick` (chosen option) |
| Score | `.value` (score) |
| Gen.text | `.text` (string; supports `==`, `!=`, and `~ "substring"`) |
| Gen.json | `.value.field` — dot path (v0.2 restricted to shallow) |
| Recall | `.hits.length` (count) |
| Sense | domain-specific: `.facts.field` |

## Basic-block batching semantics

Consecutive same-op instructions with the same backend hint fuse into one call. Different-op instructions do **not** fuse (yet — cross-op fusion is a v1 topic).

```asm
; Fuses into 1 J call
JUDGE %r0, noul   "is urgent"      %ticket
JUDGE %r1, choice "which team?" [a, b, c] %ticket
JUDGE %r2, score  "how bad?" ["ok","bad","terrible"] %ticket

; New basic block: 1 M call
RECALL %r3, top=5 "similar past tickets" %history

; New basic block: 1 L call
GEN    %r4, text "Draft a reply given the ticket and past cases" %prompt_ctx

; Any BRANCH / EMIT / HALT ends the current block for that op.
```

## Register width

v0.2: `%r0..%r63` (64 general slots).
v1 will add `%rNa`..`%rNz` for wide/vector results (embeddings, keyframe arrays, etc.).

## A canonical JLMP program — one op of each primitive

```asm
; Support ticket router that uses all four JLMP primitives.
.state ticket
.state history_corpus
.state screenshot

; P — extract facts from an attached screenshot
SENSE  %r0, image "what does this screenshot show?" %screenshot

; M — find similar past tickets
RECALL %r1, top=3 "similar issues to this one" %history_corpus

; J — classify + score
JUDGE  %r2, choice "which team?" [billing, technical, sales] %ticket
JUDGE  %r3, score  "how urgent?" ["low","med","high","critical"] %ticket

; L — draft the reply using everything above
GEN    %r4, text
       "Draft a reply. Ticket: {ticket}. Screenshot: {r0.facts}. Past cases: {r1.hits}. Assigning to {r2.pick}."
       %ticket

BRANCH %r3 >= 3, .critical

.normal:
  EMIT { team: %r2, urgency: %r3, draft: %r4, refs: %r1 }
  HALT

.critical:
  EMIT { team: %r2, urgency: "CRITICAL", draft: %r4, refs: %r1, page_on_call: true }
  HALT
```

**5 lines of JASM = 4 JLMP ops running on 4 different hardware backends, one program.** No glue code. Batching, retries, and backend routing are the runtime's job, not the programmer's.

## What v0.2 does NOT do (deliberately)

- **No inter-op fusion.** Only same-op batches fuse. Cross-op fusion needs a real compiler pass.
- **No unbounded memory.** No `LOAD/STORE mem[i]`. This keeps JASM sub-Turing on purpose — host language does arithmetic, JASM does judgement/generation/recall/perception.
- **No async/parallel keyword.** All batching is implicit. Explicit `PARALLEL { … }` blocks land in v1.
- **No user-defined ops.** You can't invent a new primitive. Extending the ISA needs a spec bump.

## Versioning

| Version | Status | Adds |
|---|---|---|
| v0.1 | shipped 2026-09-20 | JUDGE, BRANCH, JUMP, EMIT, HALT |
| **v0.2** | **this doc, 2026-09-20** | **GEN, RECALL, SENSE**; expanded BRANCH types |
| v0.3 (planned) | | Backend hints (`@backend`), retry semantics, timeouts |
| v1.0 (planned) | | `PARALLEL`, `LOOP UNTIL`, `CALL @label`, cross-op fusion |

## Bootstrap date

**2026-09-20** — the day JLMP got its name (kenefe) and JASM got the ISA that would run on top of it.
