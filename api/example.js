import { TEMPLATES } from '../lib/templates.js';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  res.setHeader('cache-control', 'public, max-age=60');
  const flagship = TEMPLATES[0];
  res.status(200).json({
    program: flagship.jasm,
    sdk: flagship.sdk,
    states: flagship.states,
  });
}
