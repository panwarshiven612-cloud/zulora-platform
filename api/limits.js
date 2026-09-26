import { getTokenUsageStatus, verifyRequestUser } from './ai.js';

const reply = (res, status, payload) => res.status(status).json(payload);

export default async function handler(req, res) {
  if (req.method !== 'GET') return reply(res, 405, { error: 'Method not allowed.' });
  try {
    const uid = await verifyRequestUser(req);
    if (!uid) return reply(res, 401, { error: 'Sign in to view usage.' });
    const usage = await getTokenUsageStatus(uid);
    return reply(res, 200, { usage });
  } catch (error) {
    console.warn('Daily usage status is unavailable:', error?.message || error);
    return reply(res, 503, { usage: null, error: 'Daily usage is temporarily unavailable.' });
  }
}
