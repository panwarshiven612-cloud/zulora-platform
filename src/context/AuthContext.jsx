import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services/authService';
import { firestoreService, TIERS } from '../services/firestoreService';
import { rateLimiter } from '../services/rateLimiter';

const AuthContext = createContext(null);

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
    return localStorage.getItem('zulora_theme') || 'dark';
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
    localStorage.setItem('zulora_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Reload user profile from Firestore / storage
  const refreshProfile = useCallback(async (uid, userObj) => {
    if (!uid) return null;
    const profile = await firestoreService.getUserProfile(uid, userObj);
    const hydrated = await hydratePersistentUsage(uid, profile);
    setUserProfile(hydrated);
    return hydrated;
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

  // Resolve the first auth event and any OAuth redirect before exposing protected tools.
  useEffect(() => {
    let active = true;
    let initialAuthResolved = false;
    let redirectResolved = false;
    let latestUid = null;
    let profiledUid = null;

    const finishLoading = () => {
      if (active && initialAuthResolved && redirectResolved) setLoading(false);
    };

    const applyUser = async user => {
      if (!active) return;
      latestUid = user?.uid || null;
      setCurrentUser(user || null);
      if (!user) {
        profiledUid = null;
        setUserProfile(null);
        return;
      }
      if (profiledUid === user.uid) return;
      profiledUid = user.uid;
      try {
        const profile = await firestoreService.getUserProfile(user.uid, user);
        const hydrated = await hydratePersistentUsage(user.uid, profile);
        if (active && latestUid === user.uid) setUserProfile(hydrated);
      } catch (error) {
        console.warn('Could not load the signed-in user profile:', error);
      }
    };

    const unsubscribe = authService.onAuthStateChange(async user => {
      await applyUser(user);
      if (!active) return;
      initialAuthResolved = true;
      finishLoading();
    });

    authService.checkRedirectResult().then(async user => {
      if (user && active && latestUid !== user.uid) await applyUser(user);
    }).catch(error => {
      console.warn('Could not complete sign-in redirect:', error);
    }).finally(() => {
      redirectResolved = true;
      finishLoading();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    setLoading(true);
    const result = await authService.signInWithGoogle();
    if (result.success && result.user) {
      setCurrentUser(result.user);
      await refreshProfile(result.user.uid, result.user);
    }
    setLoading(false);
    return result;
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
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
