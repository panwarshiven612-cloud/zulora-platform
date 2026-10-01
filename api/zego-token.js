import { createCipheriv, randomBytes, randomInt } from 'node:crypto';
import { verifyUser } from './ai.js';

const APP_ID = Number(process.env.ZEGO_APP_ID || '993897076');
const TOKEN_LIFETIME_SECONDS = 60 * 60;
const requestTimes = new Map();

function generateToken04(appId, userId, secret, effectiveTimeInSeconds, payload = '') {
  if (!Number.isInteger(appId) || appId <= 0) throw new Error('ZEGOCLOUD AppID is invalid.');
  if (!userId || typeof userId !== 'string') throw new Error('A user ID is required.');
  if (typeof secret !== 'string' || Buffer.byteLength(secret) !== 32) throw new Error('ZEGO_SERVER_SECRET must be configured as a 32-byte server environment secret.');

  const createdAt = Math.floor(Date.now() / 1000);
  const expiresAt = createdAt + effectiveTimeInSeconds;
  const info = {
    app_id: appId,
    user_id: userId,
    nonce: randomInt(-2147483648, 2147483647),
    ctime: createdAt,
    expire: expiresAt,
    payload
  };
  const iv = Buffer.from(Array.from(randomBytes(16), byte => '0123456789abcdefghijklmnopqrstuvwxyz'[byte % 36]).join(''));
  const cipher = createCipheriv('aes-256-cbc', Buffer.from(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(info), 'utf8'), cipher.final()]);
  const header = Buffer.alloc(8);
  header.writeBigInt64BE(BigInt(expiresAt));
  const ivLength = Buffer.alloc(2);
  ivLength.writeUInt16BE(iv.length);
  const payloadLength = Buffer.alloc(2);
  payloadLength.writeUInt16BE(ciphertext.length);
  return `04${Buffer.concat([header, ivLength, iv, payloadLength, ciphertext]).toString('base64')}`;
}

export default async function zegoTokenHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST to request a call token.' });

  const uid = await verifyUser(req).catch(() => null);
  if (!uid) return res.status(401).json({ error: 'Sign in to Zulora AI before starting a call.' });

  const now = Date.now();
  const recent = (requestTimes.get(uid) || []).filter(timestamp => now - timestamp < 60_000);
  if (recent.length >= 20) return res.status(429).json({ error: 'Call token request limit reached. Try again shortly.' });
  recent.push(now);
  requestTimes.set(uid, recent);

  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const roomId = String(body.roomId || '').trim();
  if (!/^[A-Za-z0-9_]{1,64}$/.test(roomId)) return res.status(400).json({ error: 'Room ID may contain letters, numbers, and underscores only.' });

  const serverSecret = process.env.ZEGO_SERVER_SECRET || '';
  if (!serverSecret) return res.status(503).json({ error: 'Secure ZEGOCLOUD calls are not configured on this server. Set ZEGO_SERVER_SECRET in the server environment.' });
  try {
    const userId = `u_${uid.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 55)}`;
    const roomPayload = JSON.stringify({ room_id: roomId, privilege: { '1': 1, '2': 1 }, stream_id_list: [] });
    const token = generateToken04(APP_ID, userId, serverSecret, TOKEN_LIFETIME_SECONDS, roomPayload);
    return res.status(200).json({ appId: APP_ID, token, userId, userName: String(body.userName || 'Zulora User').slice(0, 64), roomId, expiresAt: now + TOKEN_LIFETIME_SECONDS * 1000 });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Could not create a secure ZEGOCLOUD token.' });
  }
}
