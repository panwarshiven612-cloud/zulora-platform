import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  deleteDoc,
  serverTimestamp,
  runTransaction
} from 'firebase/firestore';
import { db, storage } from './firebase';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { emailService } from './emailService';
import { rateLimiter } from './rateLimiter';

export const TIERS = {
  FREE: 'free',
  PRO: 'pro',
  ULTRA: 'ultra'
};

export const BASE_LIMITS = {
  chat: 50,    // per 2 hours
  image: 30,   // per 24 hours
  video: 4     // per 24 hours
};

export const TIER_MULTIPLIERS = {
  [TIERS.FREE]: 1,
  [TIERS.PRO]: 2,
  [TIERS.ULTRA]: 5
};

const TIER_LIMITS = {
  [TIERS.FREE]: { chat: 50, image: 30, video: 4 },
  [TIERS.PRO]: { chat: 100, image: 60, video: 8 },
  [TIERS.ULTRA]: { chat: 250, image: 150, video: 20 }
};

export const TIER_PRICING = {
  [TIERS.FREE]: { price: 0, label: 'Free Tier', multiplier: 1 },
  [TIERS.PRO]: { price: 299, label: 'Pro Tier', multiplier: 2, period: 'month' },
  [TIERS.ULTRA]: { price: 599, label: 'Ultra Pro Max', multiplier: 5, period: 'month' }
};

const CHAT_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const DAY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const TOKEN_WINDOW_MS = DAY_WINDOW_MS;
const TOKEN_LIMITS = { free: 10_000, pro: 50_000, ultra: 100_000 };

// LocalStorage fallback prefix
const STORAGE_PREFIX = 'zulora_store_';
const AI_BRAIN_STORAGE_KEY = 'zulora_user_memory';
const VAULT_STORAGE_PREFIX = 'zulora_user_vault_';
const USER_HISTORY_STORAGE_KEY = 'zulora_user_history';
const normalizeAiBrain = brain => ({
  talkStyle: String(brain?.talkStyle || ''),
  customInstructions: String(brain?.customInstructions || ''),
  domainContext: String(brain?.domainContext || ''),
  updatedAt: Number(brain?.updatedAt) || 0
});
const normalizeVault = vault => ({
  preferences: String(vault?.preferences || ''),
  customInstructions: String(vault?.customInstructions || ''),
  keyFacts: String(vault?.keyFacts || ''),
  updatedAt: Number(vault?.updatedAt) || 0
});

function readCachedVault(uid) {
  try {
    const cached = JSON.parse(localStorage.getItem(`${VAULT_STORAGE_PREFIX}${uid}`) || 'null');
    return cached ? normalizeVault(cached) : null;
  } catch { return null; }
}

function readUserHistory(uid) {
  try {
    const parsed = JSON.parse(localStorage.getItem(USER_HISTORY_STORAGE_KEY) || '{}');
    const entries = Array.isArray(parsed) ? parsed.filter(item => item.uid === uid) : parsed?.[uid];
    return Array.isArray(entries) ? entries : [];
  } catch { return []; }
}

function writeUserHistory(uid, entries) {
  const parsed = (() => {
    try {
      const value = JSON.parse(localStorage.getItem(USER_HISTORY_STORAGE_KEY) || '{}');
      return !Array.isArray(value) && value && typeof value === 'object' ? value : {};
    } catch { return {}; }
  })();
  parsed[uid] = entries.slice(0, 40);
  localStorage.setItem(USER_HISTORY_STORAGE_KEY, JSON.stringify(parsed));
}

function readCachedAiBrain(uid) {
  try {
    const cached = JSON.parse(localStorage.getItem(AI_BRAIN_STORAGE_KEY) || 'null');
    if (!cached || cached.uid !== uid) return null;
    return normalizeAiBrain(cached);
  } catch { return null; }
}

const getTier = profile => {
  const tiers = [profile?.planTier, profile?.tier].map(value => String(value || '').toLowerCase().replace(/[ _-]/g, ''));
  if (tiers.some(tier => tier.includes('ultra'))) return TIERS.ULTRA;
  if (tiers.some(tier => tier.includes('pro'))) return TIERS.PRO;
  return TIERS.FREE;
};

export const getTokenUsagePercent = (usage = {}, tier = TIERS.FREE) => {
  const normalizedTier = getTier({ planTier: tier });
  const limit = TOKEN_LIMITS[normalizedTier];
  const start = Number(usage.tokenWindowStart) || Date.now();
  const expired = Date.now() - start >= TOKEN_WINDOW_MS || start > Date.now();
  const used = expired ? 0 : Math.max(0, Number(usage.tokenUsed) || 0);
  return Math.max(0, Math.min(100, Math.floor((used / limit) * 100)));
};

const readLocalList = key => {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
};

export const deriveChatTitle = prompt => {
  const stopWords = new Set(['a', 'an', 'the', 'for', 'to', 'of', 'in', 'on', 'with', 'and', 'or', 'is', 'are', 'what', 'how', 'why', 'when', 'where', 'can', 'could', 'please', 'help', 'me', 'my', 'write', 'create', 'design', 'build', 'make', 'explain', 'show', 'give', 'generate', 'scalable', 'production', 'secure', 'complete', 'efficient']);
  const words = String(prompt || '').replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, ' ')
    .match(/[\p{L}\p{N}+#.\-]+/gu) || [];
  const usefulWords = words.filter(word => !stopWords.has(word.toLowerCase()));
  const schemaIndex = usefulWords.findIndex(word => /^(schema|database)$/i.test(word));
  const titleWords = schemaIndex >= 0
    ? usefulWords.slice(Math.max(0, schemaIndex - 1), schemaIndex + 1)
    : usefulWords.slice(0, 3);
  if (!titleWords.length) return 'New Chat';
  return titleWords.map(word => /^[A-Z0-9+#.\-]{2,}$/.test(word)
    ? word
    : word.charAt(0).toLocaleUpperCase() + word.slice(1)).join(' ');
};

const normalizeChatSession = session => {
  if (session?.title && session.title !== 'Untitled Chat') return session;
  const firstPrompt = session?.messages?.find(message => message.role === 'user')?.displayContent || session?.messages?.find(message => message.role === 'user')?.content;
  return { ...session, title: deriveChatTitle(firstPrompt) };
};

export const firestoreService = {
  async getStudioProjects(uid) {
    if (!uid) return [];
    const key = `zulora_studio_projects_${uid}`;
    const local = readLocalList(key);
    try {
      const [snapshot, legacySnapshot] = await Promise.all([
        getDocs(query(collection(db, 'users', uid, 'studio_projects'), orderBy('updatedAt', 'desc'), limit(40))),
        getDocs(query(collection(db, 'users', uid, 'projects'), orderBy('updatedAt', 'desc'), limit(40)))
      ]);
      const remote = [...snapshot.docs, ...legacySnapshot.docs].map(item => ({ id: item.id, ...item.data() }));
      const merged = new Map();
      [...remote, ...local].forEach(project => {
        const previous = merged.get(project.id);
        if (!previous || Number(project.updatedAt || project.timestamp || 0) >= Number(previous.updatedAt || previous.timestamp || 0)) {
          merged.set(project.id, project);
        }
      });
      const projects = [...merged.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)).slice(0, 40);
      localStorage.setItem(key, JSON.stringify(projects));
      return projects;
    } catch (error) {
      console.warn('Firestore studio project list fallback to LocalStorage:', error.message);
      return local.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    }
  },

  async saveStudioProject(uid, project) {
    if (!uid || !project?.id) throw new Error('A signed-in user and project ID are required.');
    const timestamp = Date.now();
    const key = `zulora_studio_projects_${uid}`;
    const existing = readLocalList(key).find(item => item.id === project.id);
    const value = {
      ...project,
      title: String(project.title || 'Untitled project').slice(0, 120),
      code: String(project.code || project.html || ''),
      createdAt: Number(project.createdAt) || Number(existing?.createdAt) || timestamp,
      updatedAt: timestamp,
      timestamp
    };
    const projects = [value, ...readLocalList(key).filter(item => item.id !== value.id)].slice(0, 40);
    localStorage.setItem(key, JSON.stringify(projects));
    try {
      await setDoc(doc(db, 'users', uid, 'studio_projects', value.id), value, { merge: true });
      return { project: value, synced: true };
    } catch (error) {
      console.warn('Firestore studio project save fallback to LocalStorage:', error.message);
      return { project: value, synced: false };
    }
  },

  setActiveCodeProject(uid, project) {
    if (!uid || !project) return;
    try { localStorage.setItem('zulora_active_code', JSON.stringify({ uid, project })); }
    catch (error) { console.warn('Active code cache save failed:', error.message); }
  },

  getActiveCodeProject(uid) {
    try {
      const saved = JSON.parse(localStorage.getItem('zulora_active_code') || 'null');
      if (!saved) return null;
      if (saved.project) return !saved.uid || saved.uid === uid ? saved.project : null;
      if (saved.uid && saved.uid !== uid) return null;
      return saved.html || saved.code ? saved : null;
    } catch { return null; }
  },

  async saveGeneratedCodeProject(uid, { prompt, code, model, projectId } = {}) {
    if (!uid || !code) return null;
    const source = String(code);
    const files = { html: '', css: '', js: '', svg: '' };
    for (const [, language = '', content = ''] of source.matchAll(/```([^\r\n]*)\r?\n([\s\S]*?)```/g)) {
      const languageKey = language.trim().toLowerCase();
      const key = ({ htm: 'html', javascript: 'js', mjs: 'js', xml: 'svg' })[languageKey] || languageKey;
      if (key in files && !files[key]) files[key] = content.trim();
    }
    if (!files.html && !files.svg) {
      files.html = source.match(/<!doctype html[\s\S]*|<html[\s\S]*/i)?.[0]?.replace(/```\s*$/, '').trim() || '';
    }
    if (files.svg && !files.html) files.html = files.svg;
    if (files.html && !files.css) files.css = [...files.html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1].trim()).join('\n\n');
    if (files.html && !files.js) files.js = [...files.html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1].trim()).filter(Boolean).join('\n\n');
    if (!files.html) {
      const escaped = source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      files.html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Generated code</title></head><body><pre style="white-space:pre-wrap;overflow-wrap:anywhere;padding:24px">${escaped}</pre></body></html>`;
    }
    const id = projectId || `chat-code-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const project = { id, title: deriveChatTitle(prompt), prompt: String(prompt || ''), code: source, ...files, model: String(model || ''), updatedAt: Date.now() };
    this.setActiveCodeProject(uid, project);
    await this.saveCodeProject(uid, project);
    return project;
  },

  async getCodeProjects(uid) {
    if (!uid) return [];
    const key = `zulora_code_projects_${uid}`;
    const local = readLocalList(key);
    try {
      const [codeSnapshot, studioSnapshot, legacySnapshot] = await Promise.all([
        getDocs(query(collection(db, 'users', uid, 'code_projects'), orderBy('updatedAt', 'desc'), limit(80))),
        getDocs(query(collection(db, 'users', uid, 'studio_projects'), orderBy('updatedAt', 'desc'), limit(40))),
        getDocs(query(collection(db, 'users', uid, 'projects'), orderBy('updatedAt', 'desc'), limit(40)))
      ]);
      const remote = [...codeSnapshot.docs, ...studioSnapshot.docs, ...legacySnapshot.docs]
        .map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
      const merged = new Map();
      [...remote, ...local].forEach(project => {
        const previous = merged.get(project.id);
        if (!previous || Number(project.updatedAt || project.timestamp || 0) >= Number(previous.updatedAt || previous.timestamp || 0)) {
          merged.set(project.id, project);
        }
      });
      const projects = [...merged.values()].sort((a, b) => Number(b.updatedAt || b.timestamp || 0) - Number(a.updatedAt || a.timestamp || 0)).slice(0, 80);
      try { localStorage.setItem(key, JSON.stringify(projects)); }
      catch (error) { console.warn('Local code project cache could not be refreshed:', error.message); }
      return projects;
    } catch (error) {
      console.warn('Firestore code project list fallback to LocalStorage:', error.message);
      return local.sort((a, b) => Number(b.updatedAt || b.timestamp || 0) - Number(a.updatedAt || a.timestamp || 0));
    }
  },

  async saveCodeProject(uid, project) {
    if (!uid || !project?.id) throw new Error('A signed-in user and code project ID are required.');
    const key = `zulora_code_projects_${uid}`;
    const existing = readLocalList(key).find(item => item.id === project.id);
    const now = Date.now();
    const value = {
      ...project,
      kind: project.kind || 'project',
      title: String(project.title || 'Untitled project').slice(0, 120),
      code: String(project.code || project.html || ''),
      createdAt: Number(project.createdAt) || Number(existing?.createdAt) || now,
      updatedAt: now,
      timestamp: now
    };
    try {
      localStorage.setItem(key, JSON.stringify([value, ...readLocalList(key).filter(item => item.id !== value.id)].slice(0, 80)));
    } catch (error) {
      console.warn('Local code project cache could not be saved; syncing to Firestore:', error.message);
    }
    try {
      await setDoc(doc(db, 'users', uid, 'code_projects', value.id), value, { merge: true });
      return { project: value, synced: true };
    } catch (error) {
      console.warn('Firestore code project save fallback to LocalStorage:', error.message);
      return { project: value, synced: false };
    }
  },

  async recordCodeSearch(uid, queryText, model = 'auto') {
    const text = String(queryText || '').trim().slice(0, 4000);
    if (!uid || !text) return null;
    const now = Date.now();
    const id = `search-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const record = { id, kind: 'search', title: text.slice(0, 100), query: text, prompt: text, model, createdAt: now, updatedAt: now, timestamp: now };
    await this.saveCodeProject(uid, record);
    return record;
  },

  async deleteCodeProject(uid, projectId) {
    if (!uid || !projectId) return;
    const key = `zulora_code_projects_${uid}`;
    try { localStorage.setItem(key, JSON.stringify(readLocalList(key).filter(item => item.id !== projectId))); }
    catch (error) { console.warn('Local code project cache could not be updated:', error.message); }
    try {
      await Promise.all([
        deleteDoc(doc(db, 'users', uid, 'code_projects', projectId)),
        deleteDoc(doc(db, 'users', uid, 'studio_projects', projectId)),
        deleteDoc(doc(db, 'users', uid, 'projects', projectId))
      ]);
    } catch (error) { console.warn('Firestore code project deletion fallback to LocalStorage:', error.message); }
  },

  async deleteStudioProject(uid, projectId) {
    if (!uid || !projectId) return;
    const key = `zulora_studio_projects_${uid}`;
    localStorage.setItem(key, JSON.stringify(readLocalList(key).filter(item => item.id !== projectId)));
    try {
      await Promise.all([
        deleteDoc(doc(db, 'users', uid, 'studio_projects', projectId)),
        deleteDoc(doc(db, 'users', uid, 'projects', projectId))
      ]);
    }
    catch (error) { console.warn('Firestore studio project deletion fallback to LocalStorage:', error.message); }
  },

  async getVault(uid) {
    if (!uid) return normalizeVault({});
    const cached = readCachedVault(uid);
    try {
      const snapshot = await getDoc(doc(db, 'users', uid, 'vault', 'personal'));
      if (snapshot.exists()) {
        const remote = normalizeVault(snapshot.data());
        const latest = cached?.updatedAt > remote.updatedAt ? cached : remote;
        localStorage.setItem(`${VAULT_STORAGE_PREFIX}${uid}`, JSON.stringify(latest));
        return latest;
      }
    } catch (error) {
      console.warn('Firestore getVault fallback to LocalStorage:', error.message);
    }
    return cached || normalizeVault({});
  },

  async saveVault(uid, value) {
    if (!uid) throw new Error('Sign in to save your Zulora AI Vault.');
    const vault = normalizeVault({ ...value, updatedAt: Date.now() });
    localStorage.setItem(`${VAULT_STORAGE_PREFIX}${uid}`, JSON.stringify(vault));
    this.recordUserHistory(uid, {
      type: 'preference',
      preference: JSON.stringify({ preferences: vault.preferences, customInstructions: vault.customInstructions, keyFacts: vault.keyFacts }),
      prompt: 'Updated Zulora AI Vault preferences'
    });
    try {
      await setDoc(doc(db, 'users', uid, 'vault', 'personal'), vault, { merge: true });
      return { vault, synced: true };
    } catch (error) {
      console.warn('Firestore saveVault fallback to LocalStorage:', error.message);
      return { vault, synced: false };
    }
  },

  recordUserHistory(uid, value = {}) {
    if (!uid) return null;
    const clientId = `activity_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      clientId,
      uid,
      type: String(value.type || 'prompt').slice(0, 40),
      prompt: String(value.prompt || '').trim().slice(0, 2000),
      code: String(value.code || '').slice(0, 50000),
      preference: String(value.preference || '').slice(0, 8000),
      model: String(value.model || '').slice(0, 120),
      createdAt: Number(value.createdAt) || Date.now()
    };
    try {
      const updated = [record, ...readUserHistory(uid)].slice(0, 40);
      writeUserHistory(uid, updated);
    } catch (error) {
      console.warn('Could not save user activity to LocalStorage:', error.message);
    }
    addDoc(collection(db, 'users', uid, 'search_vault'), record)
      .catch(error => console.warn('Firestore search vault fallback to LocalStorage:', error.message));
    return record;
  },

  async getUserHistory(uid, maxItems = 40) {
    if (!uid) return [];
    const local = readUserHistory(uid);
    try {
      const activityRef = collection(db, 'users', uid, 'search_vault');
      const snapshot = await getDocs(query(activityRef, orderBy('createdAt', 'desc'), limit(maxItems)));
      const remote = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      const merged = new Map();
      [...remote, ...local].forEach(item => merged.set(item.clientId || item.id, item));
      const history = [...merged.values()].sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)).slice(0, maxItems);
      try { writeUserHistory(uid, history); } catch { /* keep Firestore results available for this view */ }
      return history;
    } catch (error) {
      console.warn('Firestore history fallback to LocalStorage:', error.message);
      return local.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)).slice(0, maxItems);
    }
  },

  async getRecentActivityContext(uid, maxItems = 8) {
    if (!uid) return [];
    const [history, legacyContext] = await Promise.all([
      this.getUserHistory(uid, maxItems),
      Promise.resolve(this.getRecentQueryContext(uid, maxItems))
    ]);
    const activityContext = history.map(item => {
      if (item.type === 'code') return `Recently generated code for: ${item.prompt || 'a coding request'}`;
      if (item.type === 'preference') return `Saved user preference: ${item.preference || item.prompt || ''}`;
      return `${item.type === 'search' ? 'Recent search' : 'Recent user request'}: ${item.prompt || ''}`;
    }).filter(item => !item.endsWith(': '));
    return [...legacyContext, ...activityContext].filter(Boolean).slice(-maxItems);
  },

  getCachedAiBrain(uid) {
    return uid ? readCachedAiBrain(uid) : null;
  },

  async getAiBrain(uid) {
    if (!uid) return null;
    const cached = readCachedAiBrain(uid);
    try {
      const snapshot = await getDoc(doc(db, 'users', uid));
      const remoteBrain = snapshot.exists() ? snapshot.data()?.ai_brain : null;
      if (remoteBrain && typeof remoteBrain === 'object') {
        const brain = normalizeAiBrain(remoteBrain);
        if (cached && cached.updatedAt > brain.updatedAt) return cached;
        localStorage.setItem(AI_BRAIN_STORAGE_KEY, JSON.stringify({ uid, ...brain }));
        return brain;
      }
    } catch (error) {
      console.warn('Firestore getAiBrain fallback to LocalStorage:', error.message);
    }
    return cached || normalizeAiBrain({});
  },

  async saveAiBrain(uid, value) {
    if (!uid) throw new Error('Sign in to save your AI Brain preferences.');
    const brain = normalizeAiBrain({ ...value, updatedAt: Date.now() });
    localStorage.setItem(AI_BRAIN_STORAGE_KEY, JSON.stringify({ uid, ...brain }));
    this.recordUserHistory(uid, {
      type: 'preference',
      preference: JSON.stringify(brain),
      prompt: 'Updated AI Brain preferences'
    });
    try {
      await updateDoc(doc(db, 'users', uid), { ai_brain: brain });
      return { brain, synced: true };
    } catch (error) {
      console.warn('Firestore saveAiBrain fallback to LocalStorage:', error.message);
      return { brain, synced: false };
    }
  },

  /**
   * Get maximum limits for a given tier
   */
  getLimitsForTier(tier = TIERS.FREE) {
    const normalizedTier = getTier({ tier });
    const mult = TIER_MULTIPLIERS[normalizedTier] || 1;
    return {
      ...TIER_LIMITS[normalizedTier],
      multiplier: mult
    };
  },

  getProfileLimits(profile = {}) {
    const normalizedTier = getTier(profile);
    const defaults = this.getLimitsForTier(normalizedTier);
    return {
      chat: defaults.chat,
      image: defaults.image,
      video: defaults.video,
      multiplier: defaults.multiplier
    };
  },

  /**
   * Get or create User Profile with usage and tier tracking
   * Sends EmailJS welcome email on first registration
   */
  async getUserProfile(uid, initialUser = {}) {
    const localKey = `${STORAGE_PREFIX}user_${uid}`;
    let profileData = null;
    let isNewUser = false;

    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        profileData = userSnap.data();
      } else {
        isNewUser = true;
        const now = Date.now();
        profileData = {
          uid,
          email: initialUser.email || '',
          displayName: initialUser.displayName || 'Zulora Member',
          photoURL: initialUser.photoURL || '',
          isPro: false,
          planTier: 'Free',
          textLimit: BASE_LIMITS.chat,
          imageLimit: BASE_LIMITS.image,
          videoLimit: BASE_LIMITS.video,
          textUsed: 0,
          imageUsed: 0,
          videoUsed: 0,
          tier: TIERS.FREE,
          tierUpdatedAt: now,
          welcomeEmailSent: false,
          usage: {
            chatCount: 0,
            chatWindowStart: now,
            imageCount: 0,
            imageWindowStart: now,
            videoCount: 0,
            videoWindowStart: now
          },
          createdAt: now
        };
        await setDoc(userRef, profileData);
      }
    } catch (err) {
      console.warn('Firestore getUserProfile fallback to local cache:', err.message);
      const cached = localStorage.getItem(localKey);
      if (cached) {
        profileData = JSON.parse(cached);
      } else {
        isNewUser = true;
        const now = Date.now();
        profileData = {
          uid,
          email: initialUser.email || '',
          displayName: initialUser.displayName || 'Zulora Member',
          photoURL: initialUser.photoURL || '',
          isPro: false,
          planTier: 'Free',
          textLimit: BASE_LIMITS.chat,
          imageLimit: BASE_LIMITS.image,
          videoLimit: BASE_LIMITS.video,
          textUsed: 0,
          imageUsed: 0,
          videoUsed: 0,
          tier: TIERS.FREE,
          tierUpdatedAt: now,
          welcomeEmailSent: false,
          usage: {
            chatCount: 0,
            chatWindowStart: now,
            imageCount: 0,
            imageWindowStart: now,
            videoCount: 0,
            videoWindowStart: now
          },
          createdAt: now
        };
      }
    }

    const tier = getTier(profileData);
    const limits = this.getLimitsForTier(tier);
    profileData = {
      ...profileData,
      tier,
      planTier: tier === TIERS.FREE ? 'Free' : tier === TIERS.PRO ? 'Pro' : 'Ultra',
      textLimit: limits.chat,
      imageLimit: limits.image,
      videoLimit: limits.video
    };

    const cachedProfile = localStorage.getItem(localKey);
    if (cachedProfile) {
      try {
        const local = JSON.parse(cachedProfile);
        if (local.usageLocalOnly) {
          const usage = { ...(profileData.usage || {}) };
          for (const type of ['chat', 'image', 'video']) {
            const startKey = `${type}WindowStart`;
            const countKey = `${type}Count`;
            if (Number(local.usage?.[startKey]) === Number(usage[startKey])) {
              usage[countKey] = Math.max(Number(usage[countKey]) || 0, Number(local.usage?.[countKey]) || 0);
              profileData[type === 'chat' ? 'textUsed' : `${type}Used`] = usage[countKey];
            }
          }
          const localTokenStart = Number(local.usage?.tokenWindowStart) || 0;
          const remoteTokenStart = Number(usage.tokenWindowStart) || 0;
          if (localTokenStart && (!remoteTokenStart || localTokenStart >= remoteTokenStart)) {
            usage.tokenWindowStart = localTokenStart;
            usage.tokenUsed = localTokenStart === remoteTokenStart
              ? Math.max(Number(usage.tokenUsed) || 0, Number(local.usage?.tokenUsed) || 0)
              : Number(local.usage?.tokenUsed) || 0;
          }
          profileData.usage = usage;
          profileData.usageLocalOnly = true;
        }
      } catch { /* ignore a malformed local cache */ }
    }

    // Check if welcome email needs to be sent
    if (!profileData.welcomeEmailSent && (initialUser.email || profileData.email)) {
      const emailRecipient = {
        displayName: profileData.displayName || initialUser.displayName,
        email: profileData.email || initialUser.email
      };
      
      // Trigger EmailJS welcome notification asynchronously
      emailService.sendWelcomeEmail(emailRecipient).then(async (res) => {
        if (res.success) {
          profileData.welcomeEmailSent = true;
          await this.updateUserProfile(uid, { welcomeEmailSent: true });
        }
      }).catch(err => {
        console.warn('Welcome email trigger note:', err);
      });
    }

    // Evaluate and reset dynamic windows
    profileData = this.evaluateUsageWindows(profileData);
    profileData.usage = {
      ...(profileData.usage || {}),
      chatCount: Number(profileData.textUsed ?? profileData.usage?.chatCount ?? 0),
      imageCount: Number(profileData.imageUsed ?? profileData.usage?.imageCount ?? 0),
      videoCount: Number(profileData.videoUsed ?? profileData.usage?.videoCount ?? 0)
    };
    localStorage.setItem(localKey, JSON.stringify(profileData));
    return profileData;
  },

  /**
   * Evaluate rolling time windows and reset counts if expired
   */
  evaluateUsageWindows(profile) {
    const now = Date.now();
    const usage = { ...(profile.usage || {}) };
    let changed = false;

    // Chat window check (2 hours)
    if (!usage.chatWindowStart || now - usage.chatWindowStart >= CHAT_WINDOW_MS) {
      usage.chatCount = 0;
      profile.textUsed = 0;
      usage.chatWindowStart = now;
      changed = true;
    }

    // Image window check (24 hours)
    if (!usage.imageWindowStart || now - usage.imageWindowStart >= DAY_WINDOW_MS) {
      usage.imageCount = 0;
      profile.imageUsed = 0;
      usage.imageWindowStart = now;
      changed = true;
    }

    // Video window check (24 hours)
    if (!usage.videoWindowStart || now - usage.videoWindowStart >= DAY_WINDOW_MS) {
      usage.videoCount = 0;
      profile.videoUsed = 0;
      usage.videoWindowStart = now;
      changed = true;
    }

    if (changed) {
      profile.usage = usage;
    }
    return profile;
  },

  /**
   * Check the current allowance for early UI feedback. The server performs
   * the authoritative check and increments usage after successful generation.
   */
  async checkUsageAllowance(uid, type = 'chat') {
    let profile = await this.getUserProfile(uid);
    profile = this.evaluateUsageWindows(profile);

    const limits = this.getProfileLimits(profile);
    const actionStatus = await rateLimiter.check(uid, type, limits[type]);

    const tokenWindowStart = Number(profile.usage?.tokenWindowStart) || Date.now();
    const tokenExpired = Date.now() - tokenWindowStart >= TOKEN_WINDOW_MS || tokenWindowStart > Date.now();
    const tokenUsed = tokenExpired ? 0 : Math.max(0, Number(profile.usage?.tokenUsed) || 0);
    const tokenLimit = TOKEN_LIMITS[getTier(profile)];
    const tokenAllowed = tokenUsed < tokenLimit;
    const tokenStatus = {
      usedPercent: Math.max(0, Math.min(100, Math.floor((tokenUsed / tokenLimit) * 100))),
      resetAt: new Date((tokenExpired ? Date.now() : tokenWindowStart) + TOKEN_WINDOW_MS).toISOString(),
      blocked: !tokenAllowed
    };
    if (!actionStatus.allowed) {
      return {
        allowed: false,
        upgradeRequired: true,
        usage: {
          ...tokenStatus,
          actionCount: actionStatus.count,
          actionLimit: actionStatus.limit,
          actionUsedPercent: actionStatus.usedPercent,
          actionResetAt: new Date(actionStatus.resetAt).toISOString(),
          blocked: true
        },
        tier: getTier(profile),
        error: `${type} quota reached. Please wait for the quota window to reset.`
      };
    }
    if (!tokenAllowed) return { allowed: false, usage: tokenStatus, tier: getTier(profile), error: 'Daily AI token allocation reached.' };

    return {
      allowed: true,
      usage: {
        ...tokenStatus,
        actionCount: actionStatus.count,
        actionLimit: actionStatus.limit,
        actionUsedPercent: actionStatus.usedPercent,
        actionResetAt: new Date(actionStatus.resetAt).toISOString()
      },
      tier: profile.planTier || profile.tier || TIERS.FREE
    };
  },

  /** Local quota cache used when a generation is served by a browser fallback. */
  recordLocalUsage(uid, type, estimatedTokens = undefined) {
    if (!['chat', 'image', 'video'].includes(type)) return null;
    const localKey = `${STORAGE_PREFIX}user_${uid}`;
    let profile = {};
    try { profile = JSON.parse(localStorage.getItem(localKey) || '{}'); }
    catch { profile = {}; }
    profile = this.evaluateUsageWindows(profile);
    const now = Date.now();
    const usage = {
      ...(profile.usage || {}),
      tokenWindowStart: (Number(profile.usage?.tokenWindowStart) && now - Number(profile.usage.tokenWindowStart) < TOKEN_WINDOW_MS) ? Number(profile.usage.tokenWindowStart) : now,
      tokenUsed: ((Number(profile.usage?.tokenWindowStart) && now - Number(profile.usage.tokenWindowStart) < TOKEN_WINDOW_MS) ? Number(profile.usage?.tokenUsed) || 0 : 0) + Math.max(1, Math.ceil(Number(estimatedTokens) || (type === 'image' ? 2_048 : type === 'video' ? 4_096 : 1_000)))
    };
    profile = {
      ...profile,
      usage,
      usageLocalOnly: true
    };
    localStorage.setItem(localKey, JSON.stringify(profile));
    return profile;
  },

  /** Mirror a locally counted successful action to Firestore using the signed-in client's SDK. */
  async syncLocalUsageToFirestore(uid, localProfile, type) {
    if (!uid || !['chat', 'image', 'video'].includes(type) || !localProfile) return null;
    const userRef = doc(db, 'users', uid);
    const countKey = `${type}Count`;
    const startKey = `${type}WindowStart`;
    const usedKey = type === 'chat' ? 'textUsed' : `${type}Used`;
    const localCount = Number(localProfile[usedKey] ?? localProfile.usage?.[countKey] ?? 0);
    const localStart = Number(localProfile.usage?.[startKey]) || Date.now();

    try {
      const synced = await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(userRef);
        const remote = snapshot.exists() ? snapshot.data() : {};
        const current = this.evaluateUsageWindows({ ...remote });
        const remoteStart = Number(current.usage?.[startKey]) || localStart;
        const remoteCount = Number(current[usedKey] ?? current.usage?.[countKey] ?? 0);
        const sameWindow = remoteStart === localStart;
        const nextCount = sameWindow ? Math.max(localCount, remoteCount + 1) : localCount;
        const usage = { ...(current.usage || {}), [startKey]: localStart, [countKey]: nextCount };
        const update = { [usedKey]: nextCount, usage };
        if (snapshot.exists()) transaction.update(userRef, update);
        else transaction.set(userRef, { uid, ...update }, { merge: true });
        return { ...current, ...update, usageLocalOnly: false };
      });

      const localKey = `${STORAGE_PREFIX}user_${uid}`;
      const merged = { ...localProfile, ...synced };
      delete merged.usageLocalOnly;
      localStorage.setItem(localKey, JSON.stringify(merged));
      return merged;
    } catch (error) {
      console.warn('Firestore client usage sync fell back to LocalStorage:', error.message);
      return null;
    }
  },

  clearLocalUsage(uid) {
    const localKey = `${STORAGE_PREFIX}user_${uid}`;
    try {
      const profile = JSON.parse(localStorage.getItem(localKey) || '{}');
      delete profile.usageLocalOnly;
      localStorage.setItem(localKey, JSON.stringify(profile));
    } catch { /* ignore a malformed local cache */ }
  },

  recordQueryContext(uid, prompt, mode = 'chat') {
    const key = `${STORAGE_PREFIX}queries_${uid}`;
    const text = String(prompt || '').trim().slice(0, 1200);
    if (!text) return;
    try {
      const history = readLocalList(key).filter(item => item.text !== text);
      history.unshift({ text, mode, createdAt: Date.now() });
      localStorage.setItem(key, JSON.stringify(history.slice(0, 30)));
    } catch (error) {
      console.warn('Could not save recent query context:', error.message);
    }
  },

  getRecentQueryContext(uid, limit = 8) {
    const key = `${STORAGE_PREFIX}queries_${uid}`;
    return readLocalList(key).slice(0, limit).map(item => item.text).filter(Boolean);
  },

  /**
   * Update User Profile in Firestore & LocalStorage
   */
  async updateUserProfile(uid, updates) {
    const localKey = `${STORAGE_PREFIX}user_${uid}`;
    try {
      const cached = localStorage.getItem(localKey);
      let current = cached ? JSON.parse(cached) : {};
      current = { ...current, ...updates };
      localStorage.setItem(localKey, JSON.stringify(current));

      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, updates);
    } catch (err) {
      console.warn('Firestore updateUserProfile fallback:', err.message);
    }
  },

  // ==========================================
  // CHAT SESSIONS & HISTORY CRUD
  // ==========================================

  /**
   * Save or update a chat session under users/{uid}/chats/{chatId}
   */
  async saveChatSession(uid, chatId, sessionData) {
    if (chatId && typeof chatId === 'object') {
      sessionData = chatId;
      chatId = sessionData.id;
    }
    if (!chatId || !sessionData) return;

    const localKey = `${STORAGE_PREFIX}chats_${uid}`;
    const now = Date.now();
    try {
      const existing = readLocalList(localKey);
      const index = existing.findIndex(c => c.id === chatId);
      const updated = {
        ...sessionData,
        id: chatId,
        updatedAt: now
      };
      if (!updated.title || updated.title === 'Untitled Chat') {
        const firstPrompt = updated.messages?.find(message => message.role === 'user')?.displayContent || updated.messages?.find(message => message.role === 'user')?.content;
        updated.title = deriveChatTitle(firstPrompt);
      }
      if (index >= 0) {
        existing[index] = { ...existing[index], ...updated };
      } else {
        existing.unshift(updated);
      }
      localStorage.setItem(localKey, JSON.stringify(existing));
    } catch (err) {
      console.warn('Local chat cache save error:', err.message);
    }

    try {
      const localSessions = readLocalList(localKey);
      const localSession = localSessions.find(session => session.id === chatId);
      const payload = { ...localSession, ...sessionData, id: chatId, updatedAt: now };
      const title = payload.title && payload.title !== 'Untitled Chat'
        ? payload.title
        : deriveChatTitle(payload.messages?.find(message => message.role === 'user')?.displayContent || payload.messages?.find(message => message.role === 'user')?.content);
      await setDoc(doc(db, 'users', uid, 'chats', chatId), { ...payload, title }, { merge: true });
    } catch (err) {
      console.warn('Firestore saveChatSession fallback:', err.message);
    }
  },

  /**
   * Get all chat sessions for a user, sorted by updatedAt desc
   */
  async getChatSessions(uid) {
    const localKey = `${STORAGE_PREFIX}chats_${uid}`;
    const localSessions = readLocalList(localKey).map(normalizeChatSession);

    try {
      const chatsRef = collection(db, 'users', uid, 'chats');
      const snapshot = await getDocs(chatsRef);
      const remoteSessions = snapshot.docs.map(docSnap => {
        const raw = { id: docSnap.id, ...docSnap.data() };
        const normalized = normalizeChatSession(raw);
        if (normalized.title !== raw.title) {
          setDoc(doc(db, 'users', uid, 'chats', docSnap.id), { title: normalized.title }, { merge: true }).catch(() => {});
        }
        return normalized;
      });
      const merged = new Map(localSessions.map(session => [session.id, session]));
      remoteSessions.forEach(session => {
        const cached = merged.get(session.id);
        merged.set(session.id, cached && Number(cached.updatedAt) > Number(session.updatedAt)
          ? { ...session, ...cached }
          : session);
      });
      const sessions = [...merged.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
      localStorage.setItem(localKey, JSON.stringify(sessions));
      return sessions;
    } catch (err) {
      console.warn('Firestore getChatSessions fallback:', err.message);
    }

    return localSessions.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  },

  async getChatSession(uid, chatId) {
    const localKey = `${STORAGE_PREFIX}chats_${uid}`;
    const cached = readLocalList(localKey).find(session => session.id === chatId) || null;
    try {
      const snapshot = await getDoc(doc(db, 'users', uid, 'chats', chatId));
      if (snapshot.exists()) {
        const rawSession = { id: snapshot.id, ...snapshot.data() };
        const session = normalizeChatSession(rawSession);
        if (session.title !== rawSession.title) {
          setDoc(doc(db, 'users', uid, 'chats', chatId), { title: session.title }, { merge: true }).catch(() => {});
        }
        const sessions = readLocalList(localKey).filter(item => item.id !== chatId);
        sessions.unshift(session);
        localStorage.setItem(localKey, JSON.stringify(sessions));
        return session;
      }
    } catch (err) {
      console.warn('Firestore getChatSession fallback:', err.message);
    }
    return cached;
  },

  /**
   * Rename a chat session
   */
  async renameChatSession(uid, chatId, newTitle) {
    const localKey = `${STORAGE_PREFIX}chats_${uid}`;
    const updatedAt = Date.now();
    const existing = readLocalList(localKey);
    const cachedSession = existing.find(chat => chat.id === chatId) || {};
    const updated = existing.map(chat => chat.id === chatId
      ? { ...chat, title: newTitle, updatedAt }
      : chat);
    try { localStorage.setItem(localKey, JSON.stringify(updated)); }
    catch (error) { console.warn('Local chat rename fallback:', error.message); }

    try {
      const chatDocRef = doc(db, 'users', uid, 'chats', chatId);
      await setDoc(chatDocRef, { ...cachedSession, id: chatId, title: newTitle, updatedAt }, { merge: true });
    } catch (err) {
      console.warn('Firestore renameChatSession fallback:', err.message);
    }
  },

  /**
   * Delete a chat session
   */
  async deleteChatSession(uid, chatId) {
    try {
      const chatDocRef = doc(db, 'users', uid, 'chats', chatId);
      await deleteDoc(chatDocRef);
    } catch (err) {
      console.warn('Firestore deleteChatSession fallback:', err.message);
    }

    const localKey = `${STORAGE_PREFIX}chats_${uid}`;
    try {
      const existing = JSON.parse(localStorage.getItem(localKey) || '[]');
      const filtered = existing.filter(c => c.id !== chatId);
      localStorage.setItem(localKey, JSON.stringify(filtered));
    } catch (e) {
      console.error(e);
    }
  },

  // ==========================================
  // ASSET HISTORY (IMAGES & VIDEOS)
  // ==========================================

  /**
   * Save a generated asset (image or video)
   */
  async saveAsset(uid, assetData) {
    const asset = {
      ...assetData,
      id: assetData.id || 'asset_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      createdAt: Date.now()
    };

    if (asset.url?.startsWith('data:')) {
      try {
        const mimeType = asset.url.match(/^data:([^;]+);base64,/)?.[1] || 'image/png';
        const objectRef = ref(storage, `users/${uid}/assets/${asset.id}`);
        await uploadString(objectRef, asset.url, 'data_url', { contentType: mimeType });
        asset.url = await getDownloadURL(objectRef);
      } catch (err) {
        console.warn('Firebase Storage upload fallback:', err.message);
      }
    }

    try {
      const assetDocRef = doc(db, 'users', uid, 'assets', asset.id);
      await setDoc(assetDocRef, asset);
    } catch (err) {
      console.warn('Firestore saveAsset fallback:', err.message);
    }

    const localKey = `${STORAGE_PREFIX}assets_${uid}`;
    try {
      const existing = JSON.parse(localStorage.getItem(localKey) || '[]');
      existing.unshift(asset);
      localStorage.setItem(localKey, JSON.stringify(existing.slice(0, 100)));
    } catch (e) {
      console.error(e);
    }

    return asset;
  },

  /**
   * Get assets by type ('image' | 'video' | null for all)
   */
  async getUserAssets(uid, type = null) {
    const localKey = `${STORAGE_PREFIX}assets_${uid}`;
    let assets = [];

    try {
      const assetsRef = collection(db, 'users', uid, 'assets');
      const q = type 
        ? query(assetsRef, where('type', '==', type), orderBy('createdAt', 'desc'))
        : query(assetsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        snapshot.forEach(docSnap => {
          assets.push({ id: docSnap.id, ...docSnap.data() });
        });
        localStorage.setItem(localKey, JSON.stringify(assets));
        return assets;
      }
    } catch (err) {
      console.warn('Firestore getUserAssets fallback:', err.message);
    }

    try {
      const all = JSON.parse(localStorage.getItem(localKey) || '[]');
      return type ? all.filter(a => a.type === type) : all;
    } catch {
      return [];
    }
  },

  /**
   * Delete an asset
   */
  async deleteAsset(uid, assetId) {
    try {
      const assetDocRef = doc(db, 'users', uid, 'assets', assetId);
      await deleteDoc(assetDocRef);
    } catch (err) {
      console.warn('Firestore deleteAsset fallback:', err.message);
    }

    const localKey = `${STORAGE_PREFIX}assets_${uid}`;
    try {
      const existing = JSON.parse(localStorage.getItem(localKey) || '[]');
      const filtered = existing.filter(a => a.id !== assetId);
      localStorage.setItem(localKey, JSON.stringify(filtered));
    } catch (e) {
      console.error(e);
    }
  }
};

export default firestoreService;
