import { TEMPLATES, TEMPLATE_INDEX, getTemplate } from '../lib/templates.js';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  res.setHeader('cache-control', 'public, max-age=60');

  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');

  if (id) {
    const tpl = getTemplate(id);
    if (!tpl) {
      res.status(404).json({ error: 'unknown template id: ' + id });
      return;
    }
    res.status(200).json(tpl);
    return;
  }

  // No id → return index only
  res.status(200).json({ templates: TEMPLATE_INDEX });
}
