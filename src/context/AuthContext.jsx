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

  // Listen to Auth State
  useEffect(() => {
    const unsubscribe = authService.onAuthStateChange(async (user) => {
      if (user) {
        setCurrentUser(user);
        await refreshProfile(user.uid, user);
      } else {
        setCurrentUser(null);
        setUserProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [refreshProfile]);

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

  const signInAsDemo = async (custom = {}) => {
    setLoading(true);
    const demo = authService.signInAsDemoUser(custom);
    setCurrentUser(demo);
    await refreshProfile(demo.uid, demo);
    setLoading(false);
    return demo;
  };

  const logout = async () => {
    await authService.signOut();
    setCurrentUser(null);
    setUserProfile(null);
  };

  const upgradeTier = async (newTier) => {
    if (!currentUser) return;
    const updated = await firestoreService.upgradeUserTier(currentUser.uid, newTier);
    setUserProfile(updated);
    return updated;
  };

  const checkAndIncrement = async (type) => {
    if (!currentUser) return { allowed: false, error: 'User not signed in' };
    const result = await firestoreService.checkAndIncrementUsage(currentUser.uid, type);
    await refreshProfile(currentUser.uid, currentUser);
    
    // Automatically trigger usage limits modal if limit reached
    if (!result.allowed) {
      setIsUsageModalOpen(true);
    }
    return result;
  };

  const currentTier = userProfile?.tier || TIERS.FREE;
  const currentLimits = firestoreService.getLimitsForTier(currentTier);

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
    signInAsDemo,
    logout,
    refreshProfile: () => refreshProfile(currentUser?.uid, currentUser),
    upgradeTier,
    checkAndIncrement,
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

