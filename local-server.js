// Local server that mimics Vercel's api/ routing.
// Runs the same handler functions Vercel will invoke.

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const runHandler = (await import('./api/run.js')).default;
const exampleHandler = (await import('./api/example.js')).default;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.txt':  'text/plain',
};

// Vercel-like helpers
function decorate(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

async function parseBody(req) {
  if (req.method === 'GET') return null;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return null; }
}

const server = http.createServer(async (req, res) => {
  decorate(res);
  const url = new URL(req.url, 'http://x');

  try {
    if (url.pathname === '/api/run') {
      req.body = await parseBody(req);
      return runHandler(req, res);
    }
    if (url.pathname === '/api/example') {
      return exampleHandler(req, res);
    }

    // Static
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = join(__dirname, 'public', rel);
    if (!filePath.startsWith(join(__dirname, 'public'))) {
      res.status(400).end('bad path');
      return;
    }
    if (!existsSync(filePath)) {
      res.status(404).end('404');
      return;
    }
    res.setHeader('content-type', mime[extname(filePath)] ?? 'application/octet-stream');
    res.end(readFileSync(filePath));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

const port = process.env.PORT ?? 5175;
server.listen(port, () => {
  console.log(`judge-vm-web local dev → http://localhost:${port}/`);
  console.log(`  AI_GATEWAY_API_KEY: ${process.env.AI_GATEWAY_API_KEY ? 'set' : 'MISSING'}`);
});
