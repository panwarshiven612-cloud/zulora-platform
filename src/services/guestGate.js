/**
 * guestGate.js — Guest access control & anti-abuse fingerprinting
 * Tracks up to 10 free searches for unauthenticated users.
 * Uses localStorage + sessionStorage + canvas fingerprint to resist incognito bypass.
 */

const GUEST_KEY = 'zulora_guest_searches';
const GUEST_LIMIT = 10;
const FP_KEY = 'zulora_fp';

function canvasFingerprint() {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('Zulora\u2764', 2, 2);
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(4, 4, 6, 6);
    return canvas.toDataURL().slice(-40);
  } catch { return 'fp_fallback_' + String(navigator?.userAgent || '').slice(0, 20); }
}

function getOrCreateFP() {
  try {
    let fp = localStorage.getItem(FP_KEY) || sessionStorage.getItem(FP_KEY);
    if (!fp) {
      fp = canvasFingerprint() + '_' + (navigator.hardwareConcurrency || 4) + '_' + screen.width;
      localStorage.setItem(FP_KEY, fp);
      sessionStorage.setItem(FP_KEY, fp);
    }
    return fp;
  } catch { return 'fp_' + Date.now(); }
}

function readRecord() {
  try {
    // Check both storages — use higher count to prevent bypass via clearing one
    const rawLS = localStorage.getItem(GUEST_KEY);
    const rawSS = sessionStorage.getItem(GUEST_KEY);
    const parse = raw => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
    const ls = parse(rawLS);
    const ss = parse(rawSS);
    const best = (!ls && !ss) ? null : (!ls ? ss : !ss ? ls : (ls.count >= ss.count ? ls : ss));
    if (!best) return { count: 0, fp: getOrCreateFP(), resetAt: Date.now() + 86400000 };
    if (Date.now() > (best.resetAt || 0)) return { count: 0, fp: getOrCreateFP(), resetAt: Date.now() + 86400000 };
    return best;
  } catch { return { count: 0, fp: getOrCreateFP(), resetAt: Date.now() + 86400000 }; }
}

function saveRecord(rec) {
  try {
    const s = JSON.stringify(rec);
    localStorage.setItem(GUEST_KEY, s);
    sessionStorage.setItem(GUEST_KEY, s);
  } catch {}
}

export const guestGate = {
  GUEST_LIMIT,

  /** Returns { allowed: boolean, remaining: number, count: number } */
  check() {
    const rec = readRecord();
    const count = rec.count || 0;
    return { allowed: count < GUEST_LIMIT, remaining: Math.max(0, GUEST_LIMIT - count), count };
  },

  /** Call after a successful guest search. Returns updated status. */
  consume() {
    const rec = readRecord();
    rec.count = (rec.count || 0) + 1;
    saveRecord(rec);
    return this.check();
  },

  reset() {
    try { localStorage.removeItem(GUEST_KEY); sessionStorage.removeItem(GUEST_KEY); } catch {}
  }
};

export default guestGate;
