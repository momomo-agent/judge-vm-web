# Judge VM Playground — Vercel deployment

Interactive playground for [Judge VM](https://github.com/momomo-agent/judge-vm) —
a probabilistic computing runtime backed by TypeSafe AI's Jev.

## Structure

```
judge-vm-web/
├── api/
│   ├── run.js         # POST — parse JASM + execute
│   └── example.js     # GET  — return default JASM + state
├── public/
│   ├── index.html
│   ├── client.js
│   └── style.css
├── lib/               # Judge VM source packages inlined for Vercel
│   ├── primitives.js
│   ├── asm.js
│   └── runtime.js
├── package.json
└── vercel.json
```

## Local dev

```bash
export AI_GATEWAY_API_KEY=vck_...
vercel dev            # or: node local-server.js
```

## Deploy

```bash
vercel --prod
# Set AI_GATEWAY_API_KEY in Vercel project env
```
