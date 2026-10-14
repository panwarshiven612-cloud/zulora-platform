const RECORD_KEY = 'zulora.telegram.verify.record.v1';
const SESSION_KEY_KEY = 'zulora.telegram.verify.session-key.v1';
const memoryRecords = new Map();

const toBytes = value => new TextEncoder().encode(String(value));
const fromBytes = value => new TextDecoder().decode(value);

export async function storeTelegramVerificationCode({ uid, code, expiresAtMs }) {
  const record = { uid: String(uid), code: String(code), expiresAtMs: Number(expiresAtMs) };
  memoryRecords.set(record.uid, record);

  try {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.subtle || !cryptoApi?.getRandomValues) return false;

    let rawKey = null;
    try {
      const savedKey = JSON.parse(sessionStorage.getItem(SESSION_KEY_KEY) || 'null');
      if (Array.isArray(savedKey) && savedKey.length === 32) rawKey = new Uint8Array(savedKey);
    } catch { /* Create a new session-only encryption key below. */ }
    if (!rawKey) {
      rawKey = cryptoApi.getRandomValues(new Uint8Array(32));
      sessionStorage.setItem(SESSION_KEY_KEY, JSON.stringify(Array.from(rawKey)));
    }

    const key = await cryptoApi.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = cryptoApi.getRandomValues(new Uint8Array(12));
    const ciphertext = await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv }, key, toBytes(JSON.stringify(record)));
    localStorage.setItem(RECORD_KEY, JSON.stringify({
      version: 1,
      iv: Array.from(iv),
      ciphertext: Array.from(new Uint8Array(ciphertext))
    }));
    return true;
  } catch {
    // Keep the active code in module memory if browser storage or encryption is unavailable.
    return false;
  }
}

export async function readTelegramVerificationCode(uid) {
  const userId = String(uid || '');
  const memoryRecord = memoryRecords.get(userId);
  if (memoryRecord?.expiresAtMs > Date.now()) return memoryRecord;
  if (memoryRecord) memoryRecords.delete(userId);

  try {
    const encrypted = JSON.parse(localStorage.getItem(RECORD_KEY) || 'null');
    const rawKeyValue = JSON.parse(sessionStorage.getItem(SESSION_KEY_KEY) || 'null');
    if (encrypted?.version !== 1 || !Array.isArray(encrypted.iv) || !Array.isArray(encrypted.ciphertext) || !Array.isArray(rawKeyValue)) return null;
    const key = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(rawKeyValue), { name: 'AES-GCM' }, false, ['decrypt']);
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(encrypted.iv) },
      key,
      new Uint8Array(encrypted.ciphertext)
    );
    const record = JSON.parse(fromBytes(plaintext));
    if (record.uid !== userId || !/^(?:ZUL-)?\d{6}$/i.test(record.code) || Number(record.expiresAtMs) <= Date.now()) {
      clearTelegramVerificationCode();
      return null;
    }
    memoryRecords.set(userId, record);
    return record;
  } catch {
    return null;
  }
}

export function clearTelegramVerificationCode(uid = '') {
  if (uid) memoryRecords.delete(String(uid));
  else memoryRecords.clear();
  try { localStorage.removeItem(RECORD_KEY); } catch { /* Storage can be disabled by the browser. */ }
  try { sessionStorage.removeItem(SESSION_KEY_KEY); } catch { /* Storage can be disabled by the browser. */ }
}
