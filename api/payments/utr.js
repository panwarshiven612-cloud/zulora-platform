import { recordUtrAndActivate, verifyRequestUser } from '../ai.js';

const reply = (res, status, payload) => res.status(status).json(payload);

export default async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed.' });
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return reply(res, 400, { error: 'Invalid JSON request.' }); }
  }
  const utr = String(body?.utr || '').trim();
  if (!/^\d{12}$/.test(utr)) return reply(res, 400, { error: 'Enter a valid 12-digit UTR / transaction ID.' });

  try {
    const uid = await verifyRequestUser(req);
    if (!uid) return reply(res, 401, { error: 'Sign in before submitting a payment UTR.' });
    const result = await recordUtrAndActivate(uid, utr);
    return reply(res, 200, result);
  } catch (error) {
    const status = error?.status || 503;
    console.warn('UPI UTR activation failed:', error?.message || error);
    return reply(res, status, { error: error?.message || 'Could not activate the plan from this UTR.' });
  }
}
