# Judge VM Playground

**Interactive playground for [JASM v0.2](docs/JASM-v0.2-spec.md)** — the assembly language of **JLMP**, four native operators for the next computing paradigm.

```
JLMP = J + L + M + P
       │   │   │   └── Perceive  (VLM / NPU)
       │   │   └────── Memory    (vector DB / M-chip)
       │   └────────── Language  (LLM / transformer ASIC)
       └────────────── Judge     (Jev / TSU / p-bit)
```

## Structure (Vercel)

```
judge-vm-web/
├── api/
│   ├── run.js         # POST — parse JASM + execute (mock modes: all | lmp | real)
│   └── example.js     # GET  — default JLMP program + states
├── public/
│   ├── index.html
│   ├── client.js
│   ├── style.css
│   ├── router.jasm.txt        # v0.1 — J-only example
│   └── jlmp-router.jasm.txt   # v0.2 — all four primitives
├── lib/
│   ├── primitives.js  # J backend via Vercel AI Gateway
│   ├── asm.js         # JASM parser (recognizes J/L/M/P)
│   ├── runtime.js     # VM with per-primitive backend dispatch
│   └── backends.js    # mock + real backends for L / M / P
├── docs/
│   └── JASM-v0.2-spec.md
├── package.json
└── vercel.json
```

## Local dev

```bash
export AI_GATEWAY_API_KEY=***
node --env-file=.env local-server.js
# → http://localhost:5175/
```

## Deploy

```bash
vercel --prod
# Set AI_GATEWAY_API_KEY in project env
```

## Origin

Named by kenefe 2026-09-20 17:58: **"JLMP — the substrate of the future computer, JASM is its runtime."**
