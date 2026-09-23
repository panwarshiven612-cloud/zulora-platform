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

export const TIER_PRICING = {
  [TIERS.FREE]: { price: 0, label: 'Free Tier', multiplier: 1 },
  [TIERS.PRO]: { price: 299, label: 'Pro Tier', multiplier: 2, period: 'month' },
  [TIERS.ULTRA]: { price: 599, label: 'Ultra Pro Max', multiplier: 5, period: 'month' }
};

const CHAT_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const DAY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// LocalStorage fallback prefix
const STORAGE_PREFIX = 'zulora_store_';

export const firestoreService = {
  /**
   * Get maximum limits for a given tier
   */
  getLimitsForTier(tier = TIERS.FREE) {
    const mult = TIER_MULTIPLIERS[tier] || 1;
    return {
      chat: BASE_LIMITS.chat * mult,
      image: BASE_LIMITS.image * mult,
      video: BASE_LIMITS.video * mult,
      multiplier: mult
    };
  },

  getProfileLimits(profile = {}) {
    const tier = profile.planTier || profile.tier || TIERS.FREE;
    const normalizedTier = String(tier).toLowerCase();
    const defaults = this.getLimitsForTier(normalizedTier === 'ultrapro' || normalizedTier === 'ultra_pro_max' ? TIERS.ULTRA : normalizedTier);
    return {
      chat: Number(profile.textLimit ?? defaults.chat),
      image: Number(profile.imageLimit ?? defaults.image),
      video: Number(profile.videoLimit ?? defaults.video),
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
        profileData = {
          ...JSON.parse(cached),
          isPro: false,
          tier: TIERS.FREE
        };
      } else {
        isNewUser = true;
        const now = Date.now();
        profileData = {
          uid,
          email: initialUser.email || '',
          displayName: initialUser.displayName || 'Zulora Member',
          photoURL: initialUser.photoURL || '',
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
    if (!usage.chatWindowStart || now - usage.chatWindowStart > CHAT_WINDOW_MS) {
      usage.chatCount = 0;
      profile.textUsed = 0;
      usage.chatWindowStart = now;
      changed = true;
    }

    // Image window check (24 hours)
    if (!usage.imageWindowStart || now - usage.imageWindowStart > DAY_WINDOW_MS) {
      usage.imageCount = 0;
      profile.imageUsed = 0;
      usage.imageWindowStart = now;
      changed = true;
    }

    // Video window check (24 hours)
    if (!usage.videoWindowStart || now - usage.videoWindowStart > DAY_WINDOW_MS) {
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
   * Check the current allowance without consuming it. Call recordUsage only
   * after a generation has returned a usable result.
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

  async recordUsage(uid, type = 'chat') {
    const counter = `${type}Count`;
    const startKey = `${type}WindowStart`;
    const localKey = `${STORAGE_PREFIX}user_${uid}`;
    try {
      const userRef = doc(db, 'users', uid);
      let committedProfile;
      await runTransaction(db, async transaction => {
        const snap = await transaction.get(userRef);
        const profile = snap.exists() ? snap.data() : { usage: {} };
        const profileWithUsage = this.evaluateUsageWindows({ ...profile, usage: profile.usage || {} });
        const topLevelCounter = type === 'chat' ? 'textUsed' : `${type}Used`;
        const count = Number(profileWithUsage[topLevelCounter] ?? profileWithUsage.usage?.[counter] ?? 0);
        transaction.set(userRef, { [topLevelCounter]: count + 1, usage: { ...profileWithUsage.usage, [counter]: count + 1, [startKey]: profileWithUsage.usage[startKey] || Date.now() } }, { merge: true });
        profileWithUsage[topLevelCounter] = count + 1;
        profileWithUsage.usage[counter] = count + 1;
        committedProfile = profileWithUsage;
      });
      if (committedProfile) localStorage.setItem(localKey, JSON.stringify(committedProfile));
    } catch (err) {
      console.warn('Firestore recordUsage fallback:', err.message);
      const profile = JSON.parse(localStorage.getItem(localKey) || '{}');
      const topLevelCounter = type === 'chat' ? 'textUsed' : `${type}Used`;
      const nextCount = Number(profile[topLevelCounter] ?? profile.usage?.[counter] ?? 0) + 1;
      profile[topLevelCounter] = nextCount;
      profile.usage = { ...(profile.usage || {}), [counter]: nextCount, [startKey]: profile.usage?.[startKey] || Date.now() };
      localStorage.setItem(localKey, JSON.stringify(profile));
    }
  },

  async checkAndIncrementUsage(uid, type = 'chat') {
    const result = await this.checkUsageAllowance(uid, type);
    if (result.allowed) await this.recordUsage(uid, type);
    return result;
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
    const localKey = `${STORAGE_PREFIX}chats_${uid}`;
    try {
      const chatDocRef = doc(db, 'users', uid, 'chats', chatId);
      await setDoc(chatDocRef, {
        ...sessionData,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (err) {
      console.warn('Firestore saveChatSession fallback:', err.message);
    }

    // Save locally
    try {
      const existing = JSON.parse(localStorage.getItem(localKey) || '[]');
      const index = existing.findIndex(c => c.id === chatId);
      const updated = {
        ...sessionData,
        id: chatId,
        updatedAt: Date.now()
      };
      if (index >= 0) {
        existing[index] = { ...existing[index], ...updated };
      } else {
        existing.unshift(updated);
      }
      localStorage.setItem(localKey, JSON.stringify(existing));
    } catch (err) {
      console.error('LocalStorage save error:', err);
    }
  },

  /**
   * Get all chat sessions for a user, sorted by updatedAt desc
   */
  async getChatSessions(uid) {
    const localKey = `${STORAGE_PREFIX}chats_${uid}`;
    let sessions = [];

    try {
      const chatsRef = collection(db, 'users', uid, 'chats');
      const q = query(chatsRef, orderBy('updatedAt', 'desc'));
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        snapshot.forEach(docSnap => {
          sessions.push({ id: docSnap.id, ...docSnap.data() });
        });
        localStorage.setItem(localKey, JSON.stringify(sessions));
        return sessions;
      }
    } catch (err) {
      console.warn('Firestore getChatSessions fallback:', err.message);
    }

    try {
      sessions = JSON.parse(localStorage.getItem(localKey) || '[]');
    } catch {
      sessions = [];
    }
    return sessions;
  },

  /**
   * Rename a chat session
   */
  async renameChatSession(uid, chatId, newTitle) {
    try {
      const chatDocRef = doc(db, 'users', uid, 'chats', chatId);
      await updateDoc(chatDocRef, { title: newTitle, updatedAt: Date.now() });
    } catch (err) {
      console.warn('Firestore renameChatSession fallback:', err.message);
    }

    const localKey = `${STORAGE_PREFIX}chats_${uid}`;
    try {
      const existing = JSON.parse(localStorage.getItem(localKey) || '[]');
      const updated = existing.map(chat => {
        if (chat.id === chatId) {
          return { ...chat, title: newTitle, updatedAt: Date.now() };
        }
        return chat;
      });
      localStorage.setItem(localKey, JSON.stringify(updated));
    } catch (e) {
      console.error(e);
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
