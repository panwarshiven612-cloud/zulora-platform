import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services/authService';
import { firestoreService, TIERS } from '../services/firestoreService';

const AuthContext = createContext(null);

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
    setUserProfile(profile);
    return profile;
  }, []);

  const recordUsage = useCallback(async (type, serverTracked = false) => {
    if (!currentUser?.uid) return null;
    try {
      if (serverTracked) {
        firestoreService.clearLocalUsage(currentUser.uid);
        return await refreshProfile(currentUser.uid, currentUser);
      }
      const profile = firestoreService.recordLocalUsage(currentUser.uid, type);
      if (profile) setUserProfile(profile);
      const syncedProfile = await firestoreService.syncLocalUsageToFirestore(currentUser.uid, profile, type);
      if (syncedProfile) setUserProfile(syncedProfile);
      return syncedProfile || profile;
    } catch (error) {
      console.warn('Could not update the usage display:', error.message);
      return null;
    }
  }, [currentUser, refreshProfile]);

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
        if (active && latestUid === user.uid) setUserProfile(profile);
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
