import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services/authService';
import { firestoreService, TIERS } from '../services/firestoreService';
import { rateLimiter } from '../services/rateLimiter';

const noop = () => {};
const SAFE_AUTH_CONTEXT = {
  currentUser: null,
  userProfile: null,
  loading: true,
  tier: TIERS.FREE,
  limits: { chat: 50, image: 30, video: 4 },
  usage: { chatCount: 0, imageCount: 0, videoCount: 0 },
  theme: 'dark',
  toggleTheme: noop,
  signInWithGoogle: async () => ({ success: false, error: 'Authentication is unavailable.' }),
  logout: async () => {},
  refreshProfile: async () => null,
  isPro: false,
  checkUsage: async () => ({ allowed: false, error: 'Authentication is unavailable.' }),
  recordUsage: async () => null,
  isUsageModalOpen: false,
  setIsUsageModalOpen: noop,
  isPricingModalOpen: false,
  setIsPricingModalOpen: noop
};
const AuthContext = createContext(SAFE_AUTH_CONTEXT);
const PROFILE_TIMEOUT_MS = 8_000;
const AUTH_BOOTSTRAP_TIMEOUT_MS = 12_000;
const FALLBACK_AVATAR = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#38bdf8"/><stop offset="1" stop-color="#6366f1"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#g)"/><circle cx="32" cy="25" r="11" fill="#eaf7ff"/><path d="M12 58c2-13 9-20 20-20s18 7 20 20" fill="#eaf7ff"/></svg>')}`;

function createFallbackProfile(uid, user = {}) {
  const emailName = String(user?.email || '').split('@')[0];
  return {
    uid,
    displayName: user?.displayName || emailName || 'Zulora Member',
    email: user?.email || '',
    photoURL: user?.photoURL || FALLBACK_AVATAR,
    isPro: false,
    tier: TIERS.FREE,
    planTier: 'Free',
    usage: { chatCount: 0, imageCount: 0, videoCount: 0, tokenUsed: 0 }
  };
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
    })
  ]).finally(() => window.clearTimeout(timer));
}

function completeProfile(profile, fallback) {
  return {
    ...fallback,
    ...(profile || {}),
    uid: fallback.uid,
    displayName: profile?.displayName || fallback.displayName,
    email: profile?.email || fallback.email,
    photoURL: profile?.photoURL || fallback.photoURL,
    usage: { ...fallback.usage, ...(profile?.usage || {}) }
  };
}

async function hydratePersistentUsage(uid, profile) {
  if (!uid || !profile) return profile;
  const limits = firestoreService.getProfileLimits(profile);
  const tokenLimit = firestoreService.getProfileTokenLimit(profile);
  const types = ['chat', 'image', 'video'];
  const states = await Promise.all(types.map(type => rateLimiter.getStatus(uid, type, limits[type], tokenLimit)));
  const usage = { ...(profile.usage || {}) };
  const now = Date.now();
  const localTokens = states.reduce((total, state) => total + state.tokenCount, 0);
  const storedStart = Number(usage.tokenWindowStart) || 0;
  const storedIsCurrent = storedStart > 0 && storedStart <= now && now - storedStart < 24 * 60 * 60 * 1000;
  const storedTokens = storedIsCurrent ? Math.max(0, Number(usage.tokenUsed) || 0) : 0;
  const consumedTokens = Math.max(storedTokens, localTokens);
  const tokenStarts = states.map(state => state.tokenCount ? state.tokenWindowStart : 0).filter(Boolean);
  const tokenWindowStart = Math.min(...[storedIsCurrent ? storedStart : 0, ...tokenStarts].filter(Boolean)) || now;
  types.forEach((type, index) => {
    const state = states[index];
    usage[`${type}Count`] = state.count;
    usage[`${type}WindowStart`] = state.windowStart;
    usage[`${type}UsedPercent`] = state.usedPercent;
    usage[`${type}ResetAt`] = state.resetAt;
    usage[`${type}TokenCount`] = state.tokenCount;
  });
  usage.tokenUsed = consumedTokens;
  usage.tokenWindowStart = tokenWindowStart;
  usage.tokenUsedPercent = Math.min(100, Math.floor((consumedTokens / tokenLimit) * 100));
  const hydrated = {
    ...profile,
    textUsed: states[0].count,
    imageUsed: states[1].count,
    videoUsed: states[2].count,
    usage
  };
  try { localStorage.setItem(`zulora_store_user_${uid}`, JSON.stringify(hydrated)); }
  catch { /* The indexedDB quota ledger remains the persistent source. */ }
  return hydrated;
}

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('zulora_theme') || 'dark'; }
    catch { return 'dark'; }
  });
  const [isUsageModalOpen, setIsUsageModalOpen] = useState(false);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);

  // Sync theme class to documentElement
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try { localStorage.setItem('zulora_theme', theme); }
    catch { /* The selected theme still applies for this session. */ }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Reload user profile from Firestore / storage
  const refreshProfile = useCallback(async (uid, userObj) => {
    if (!uid) return null;
    const fallback = createFallbackProfile(uid, userObj);
    try {
      const hydrated = await withTimeout((async () => {
        const profile = await firestoreService.getUserProfile(uid, userObj);
        return hydratePersistentUsage(uid, completeProfile(profile, fallback));
      })(), PROFILE_TIMEOUT_MS, 'User profile loading');
      const safeProfile = completeProfile(hydrated, fallback);
      setUserProfile(safeProfile);
      return safeProfile;
    } catch (error) {
      console.warn('Using a local fallback profile:', error);
      setUserProfile(fallback);
      return fallback;
    }
  }, []);

  const recordUsage = useCallback(async (type, serverTracked = false, estimatedTokens = undefined, skipActionLimit = false) => {
    if (!currentUser?.uid) return null;
    try {
      const profile = userProfile || {};
      await rateLimiter.record(currentUser.uid, type, firestoreService.getProfileLimits(profile)[type], estimatedTokens, {
        countAction: !skipActionLimit,
        tokenLimit: firestoreService.getProfileTokenLimit(profile)
      });
      if (serverTracked) {
        firestoreService.clearLocalUsage(currentUser.uid);
        return await refreshProfile(currentUser.uid, currentUser);
      }
      const localProfile = firestoreService.recordLocalUsage(currentUser.uid, type, estimatedTokens);
      const hydrated = await hydratePersistentUsage(currentUser.uid, localProfile);
      if (hydrated) setUserProfile(hydrated);
      return hydrated;
    } catch (error) {
      console.warn('Could not update the usage display:', error.message);
      return null;
    }
  }, [currentUser, userProfile, refreshProfile]);

  // Resolve auth and a possible OAuth redirect before exposing protected tools.
  useEffect(() => {
    let active = true;
    let latestUid = null;
    let profiledUid = null;
    let authStateEventSeen = false;
    let redirectUser = null;

    let resolveInitialAuth;
    const initialAuth = new Promise(resolve => { resolveInitialAuth = resolve; });

    const loadProfile = user => {
      const fallback = createFallbackProfile(user.uid, user);
      setUserProfile(previous => previous?.uid === user.uid ? previous : fallback);
      if (profiledUid === user.uid) return;
      profiledUid = user.uid;
      withTimeout((async () => {
        const profile = await firestoreService.getUserProfile(user.uid, user);
        return hydratePersistentUsage(user.uid, completeProfile(profile, fallback));
      })(), PROFILE_TIMEOUT_MS, 'User profile loading').then(profile => {
        if (active && latestUid === user.uid) setUserProfile(completeProfile(profile, fallback));
      }).catch(error => {
        console.warn('Could not load the signed-in user profile; using safe defaults:', error);
      });
    };

    const applyUser = user => {
      if (!active) return;
      latestUid = user?.uid || null;
      setCurrentUser(user || null);
      if (!user) {
        profiledUid = null;
        setUserProfile(null);
        return;
      }
      loadProfile(user);
    };

    const unsubscribe = authService.onAuthStateChange(user => {
      try {
        if (!user && !authStateEventSeen && redirectUser) {
          authStateEventSeen = true;
          return;
        }
        authStateEventSeen = true;
        applyUser(user);
      } catch (error) {
        console.error('Could not apply the Firebase auth state:', error);
      } finally {
        resolveInitialAuth(user || null);
      }
    }, error => {
      try {
        console.error('Firebase auth state listener failed:', error);
        if (active) {
          latestUid = null;
          profiledUid = null;
          setCurrentUser(null);
          setUserProfile(null);
        }
      } finally {
        resolveInitialAuth(null);
      }
    });

    const redirectResult = withTimeout(authService.checkRedirectResult(), AUTH_BOOTSTRAP_TIMEOUT_MS, 'Google sign-in redirect')
      .then(user => {
        if (user && active) {
          redirectUser = user;
          if (latestUid !== user.uid) applyUser(user);
        }
      })
      .catch(error => {
        console.warn('Could not complete Google sign-in redirect:', error);
      });

    const finishBootstrap = async () => {
      try {
        await Promise.all([
          withTimeout(initialAuth, AUTH_BOOTSTRAP_TIMEOUT_MS, 'Firebase auth initialization'),
          redirectResult
        ]);
      } catch (error) {
        console.warn('Firebase auth initialization did not finish normally:', error);
      } finally {
        if (active) setLoading(false);
      }
    };
    finishBootstrap();

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    setLoading(true);
    try {
      const result = await authService.signInWithGoogle();
      if (result.success && result.user) {
        setCurrentUser(result.user);
        refreshProfile(result.user.uid, result.user);
      }
      return result;
    } catch (error) {
      console.error('Google sign-in failed:', error);
      return { success: false, error: error?.message || 'Google sign-in failed.', code: error?.code };
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await authService.signOut();
    setCurrentUser(null);
    setUserProfile(null);
  };

  const checkUsage = async (type) => {
    if (!currentUser) return { allowed: false, error: 'User not signed in' };
    const result = await firestoreService.checkUsageAllowance(currentUser.uid, type);
    // Automatically trigger usage limits modal if limit reached
    if (!result.allowed) {
      setIsUsageModalOpen(true);
    }
    return result;
  };

  useEffect(() => {
    if (!currentUser?.uid) return undefined;
    const key = `zulora_store_user_${currentUser.uid}`;
    const syncFromStorage = event => {
      if (event.key !== key || !event.newValue) return;
      try { setUserProfile(JSON.parse(event.newValue)); }
      catch { /* ignore malformed tab-local profile data */ }
    };
    window.addEventListener('storage', syncFromStorage);
    return () => window.removeEventListener('storage', syncFromStorage);
  }, [currentUser?.uid]);

  const storedTier = userProfile?.planTier || userProfile?.tier || TIERS.FREE;
  const normalizedTier = String(storedTier).toLowerCase().replace(/[ _-]/g, '');
  const currentTier = normalizedTier.includes('ultra')
    ? TIERS.ULTRA
    : normalizedTier.includes('pro') ? TIERS.PRO : TIERS.FREE;
  const isPro = currentTier !== TIERS.FREE;
  const currentLimits = firestoreService.getProfileLimits(userProfile || {});

  const value = {
    currentUser,
    userProfile,
    loading,
    tier: currentTier,
    limits: currentLimits,
    usage: userProfile?.usage || { chatCount: 0, imageCount: 0, videoCount: 0 },
    theme,
    toggleTheme,
    signInWithGoogle,
    logout,
    refreshProfile: () => refreshProfile(currentUser?.uid, currentUser),
    isPro,
    checkUsage,
    recordUsage,
    isUsageModalOpen,
    setIsUsageModalOpen,
    isPricingModalOpen,
    setIsPricingModalOpen
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  return useContext(AuthContext) || SAFE_AUTH_CONTEXT;
};

export default AuthContext;
