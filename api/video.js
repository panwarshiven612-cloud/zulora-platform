import aiHandler from './ai.js';

export const maxDuration = 60;
export const config = { maxDuration };

export default async function videoHandler(req, res) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return res.status(400).json({ error: 'Invalid JSON request.' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid request.' });
  req.body = { ...body, action: 'video' };
  return aiHandler(req, res);
}
