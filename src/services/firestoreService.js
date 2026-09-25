import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  deleteDoc,
  serverTimestamp,
  runTransaction
} from 'firebase/firestore';
import { db, storage } from './firebase';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { emailService } from './emailService';

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

// LocalStorage fallback prefix
const STORAGE_PREFIX = 'zulora_store_';
const AI_BRAIN_STORAGE_KEY = 'zulora_user_memory';
const normalizeAiBrain = brain => ({
  talkStyle: String(brain?.talkStyle || ''),
  customInstructions: String(brain?.customInstructions || ''),
  domainContext: String(brain?.domainContext || ''),
  updatedAt: Number(brain?.updatedAt) || 0
});

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
    const usageKey = `${type}Count`;
    const topLevelCounter = type === 'chat' ? 'textUsed' : `${type}Used`;
    const currentCount = Number(profile[topLevelCounter] ?? profile.usage[usageKey] ?? 0);
    const maxLimit = limits[type];

    if (currentCount >= maxLimit) {
      const windowStart = profile.usage[`${type}WindowStart`] || Date.now();
      const windowDuration = type === 'chat' ? CHAT_WINDOW_MS : DAY_WINDOW_MS;
      const resetsInMs = Math.max(0, (windowStart + windowDuration) - Date.now());

      return {
        allowed: false,
        currentCount,
        maxLimit,
        resetsInMs,
        tier: profile.planTier || profile.tier || TIERS.FREE,
        error: `Limit reached for ${type}. Current plan: ${profile.tier}. Upgrade to increase limits.`
      };
    }

    return {
      allowed: true,
      currentCount,
      maxLimit,
      remaining: maxLimit - currentCount,
      tier: profile.planTier || profile.tier || TIERS.FREE
    };
  },

  /** Local quota cache used when a generation is served by a browser fallback. */
  recordLocalUsage(uid, type) {
    if (!['chat', 'image', 'video'].includes(type)) return null;
    const localKey = `${STORAGE_PREFIX}user_${uid}`;
    let profile = {};
    try { profile = JSON.parse(localStorage.getItem(localKey) || '{}'); }
    catch { profile = {}; }
    profile = this.evaluateUsageWindows(profile);
    const now = Date.now();
    const countKey = `${type}Count`;
    const usedKey = type === 'chat' ? 'textUsed' : `${type}Used`;
    const startKey = `${type}WindowStart`;
    const limits = this.getProfileLimits(profile);
    const usage = {
      ...(profile.usage || {}),
      [countKey]: Number(profile[usedKey] ?? profile.usage?.[countKey] ?? 0) + 1,
      [startKey]: Number(profile.usage?.[startKey]) || now
    };
    profile = {
      ...profile,
      [usedKey]: usage[countKey],
      usage,
      usageLocalOnly: true,
      textLimit: limits.chat,
      imageLimit: limits.image,
      videoLimit: limits.video
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
