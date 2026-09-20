import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const EXAMPLE = {
  program: readFileSync(join(__dirname, '../public/router.jasm.txt'), 'utf8'),
  states: {
    ticket: `I've been charged twice for order #A-104 and no one has replied to my emails for 3 days. This is ridiculous, I want a refund NOW.`,
  },
};

export default function handler(req, res) {
  res.setHeader('cache-control', 'public, max-age=60');
  res.status(200).json(EXAMPLE);
}
