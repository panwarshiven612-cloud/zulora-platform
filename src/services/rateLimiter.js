const TWO_HOURS = 2 * 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;
const DATABASE_NAME = 'zulora-rate-limits';
const DATABASE_VERSION = 1;
const STORE_NAME = 'usage-windows';
const STORAGE_PREFIX = 'zulora_rate_limits_';

const windows = { chat: TWO_HOURS, image: ONE_DAY, video: ONE_DAY };
const defaults = { chat: 50, image: 30, video: 4 };
let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return databasePromise;
}

function readLocal(uid) {
  try { return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${uid}`) || '{}'); }
  catch { return {}; }
}

function writeLocal(uid, records) {
  try { localStorage.setItem(`${STORAGE_PREFIX}${uid}`, JSON.stringify(records)); }
  catch (error) { console.warn('Persistent quota local cache could not be saved:', error.message); }
}

function readIndexed(database, id) {
  if (!database) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

function normalizeEvents(records, now, windowMs) {
  const earliest = now - windowMs;
  return [...new Set((records || []).map(Number).filter(time => Number.isFinite(time) && time <= now && time > earliest))].sort((a, b) => a - b);
}

function normalizeTokenEvents(records, now, windowMs) {
  const earliest = now - windowMs;
  const unique = new Map();
  (records || []).forEach(item => {
    const timestamp = Number(item?.timestamp);
    const tokens = Math.max(0, Number(item?.tokens) || 0);
    if (Number.isFinite(timestamp) && timestamp <= now && timestamp > earliest) unique.set(`${timestamp}:${tokens}`, { timestamp, tokens });
  });
  return [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function stateFor(uid, type, events, limit, now = Date.now(), tokenEvents = []) {
  const windowMs = windows[type];
  const timestamps = normalizeEvents(events, now, windowMs);
  const currentTokenEvents = normalizeTokenEvents(tokenEvents, now, windowMs);
  const count = timestamps.length;
  return {
    uid,
    type,
    timestamps,
    tokenEvents: currentTokenEvents,
    tokenCount: currentTokenEvents.reduce((total, event) => total + event.tokens, 0),
    count,
    limit,
    windowMs,
    windowStart: timestamps[0] || now,
    resetAt: timestamps.length ? timestamps[0] + windowMs : now + windowMs,
    usedPercent: Math.min(100, Math.floor((count / limit) * 100)),
    allowed: count < limit,
  };
}

async function getEvents(uid, type, now) {
  const id = `${uid}:${type}`;
  const localRecord = readLocal(uid)[type] || {};
  const database = await openDatabase();
  const indexedRecord = await readIndexed(database, id);
  const timestamps = normalizeEvents([
    ...(Array.isArray(localRecord.timestamps) ? localRecord.timestamps : []),
    ...(Array.isArray(indexedRecord?.timestamps) ? indexedRecord.timestamps : [])
  ], now, windows[type]);
  const tokenEvents = normalizeTokenEvents([
    ...(Array.isArray(localRecord.tokenEvents) ? localRecord.tokenEvents : []),
    ...(Array.isArray(indexedRecord?.tokenEvents) ? indexedRecord.tokenEvents : [])
  ], now, windows[type]);
  return { id, database, timestamps, tokenEvents };
}

function writeIndexed(database, record) {
  if (!database) return Promise.resolve(record);
  return new Promise(resolve => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(record.id);
      let merged = record;
      request.onsuccess = () => {
        const current = request.result;
        merged = {
          ...record,
          timestamps: normalizeEvents([...(record.timestamps || []), ...(current?.timestamps || [])], Date.now(), record.windowMs),
          tokenEvents: normalizeTokenEvents([...(record.tokenEvents || []), ...(current?.tokenEvents || [])], Date.now(), record.windowMs)
        };
        store.put(merged);
      };
      transaction.oncomplete = () => resolve(merged);
      transaction.onerror = () => resolve(record);
      transaction.onabort = () => resolve(record);
    } catch { resolve(record); }
  });
}

export const rateLimiter = {
  async getStatus(uid, type, limit = defaults[type]) {
    if (!uid || !windows[type]) return stateFor(uid, type, [], limit);
    const now = Date.now();
    const { timestamps, tokenEvents } = await getEvents(uid, type, now);
    return stateFor(uid, type, timestamps, Math.max(1, Number(limit) || defaults[type]), now, tokenEvents);
  },

  async check(uid, type, limit = defaults[type]) {
    const status = await this.getStatus(uid, type, limit);
    return { ...status, blocked: !status.allowed };
  },

  async record(uid, type, limit = defaults[type], estimatedTokens = undefined) {
    if (!uid || !windows[type]) return null;
    const now = Date.now();
    const { id, database, timestamps, tokenEvents } = await getEvents(uid, type, now);
    const tokens = Math.max(1, Math.ceil(Number(estimatedTokens) || (type === 'image' ? 2_048 : type === 'video' ? 4_096 : 1_000)));
    const record = {
      id,
      uid,
      type,
      timestamps: normalizeEvents([...timestamps, now], now, windows[type]),
      tokenEvents: normalizeTokenEvents([...tokenEvents, { timestamp: now, tokens }], now, windows[type]),
      windowMs: windows[type],
      updatedAt: now
    };
    const stored = await writeIndexed(database, record);
    const allRecords = readLocal(uid);
    allRecords[type] = {
      ...record,
      timestamps: normalizeEvents(stored.timestamps, Date.now(), windows[type]),
      tokenEvents: normalizeTokenEvents(stored.tokenEvents, Date.now(), windows[type])
    };
    writeLocal(uid, allRecords);
    return stateFor(uid, type, allRecords[type].timestamps, Math.max(1, Number(limit) || defaults[type]), Date.now(), allRecords[type].tokenEvents);
  },
};

export default rateLimiter;
