/**
 * src/components/ads/adAnalyticsService.ts
 * =========================================
 * Firestore-backed Ad Analytics, Campaign CRUD, and User Wallet management.
 * Tracks impressions, clicks, CTR and ad-to-Pro conversion rates.
 */

import {
  collection, doc, addDoc, getDoc, getDocs, query, where,
  orderBy, limit, onSnapshot, updateDoc, serverTimestamp,
  increment, setDoc, Timestamp
} from 'firebase/firestore';
import { db } from '../../services/firebase';

/* ─── Types ─────────────────────────────────────────────────────────────── */

export type AdPlacement = 'bottom_banner' | 'sidebar' | 'chat_sponsored_card' | 'rewarded_modal';
export type AdStatus = 'pending' | 'active' | 'paused' | 'rejected' | 'exhausted';

export interface CustomAd {
  id?: string;
  title: string;
  description?: string;
  imageUrl?: string;
  targetUrl?: string;
  ctaText?: string;
  sponsorName?: string;
  sponsorUid?: string;        // null = admin ad
  placement: AdPlacement;
  status: AdStatus;
  budgetInr?: number;         // ₹ wallet budget allocated
  impressionBudget?: number;  // max impressions
  impressions?: number;
  clicks?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface AdEventLog {
  id?: string;
  adId: string;
  userId: string;
  action: 'impression' | 'click' | 'dismiss';
  adTitle?: string;
  placement?: AdPlacement | string;
  targetUrl?: string;
  timestamp?: any;
}

export interface UserWallet {
  uid: string;
  balanceInr: number;
  totalSpent: number;
  lastUpdated?: number;
}

/* ─── Ad Campaign CRUD ───────────────────────────────────────────────────── */

export async function createAdCampaign(ad: Omit<CustomAd, 'id'>): Promise<string> {
  try {
    const ref = await addDoc(collection(db, 'customAds'), {
      ...ad,
      status: 'pending',
      impressions: 0,
      clicks: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    return ref.id;
  } catch (err: any) {
    console.warn('[AdService] createAdCampaign:', err.message);
    return '';
  }
}

export async function getActiveCustomAds(
  placement?: AdPlacement,
  sponsorUid?: string
): Promise<CustomAd[]> {
  try {
    const colRef = collection(db, 'customAds');
    let q = query(colRef, where('status', '==', 'active'), orderBy('createdAt', 'desc'), limit(20));
    const snap = await getDocs(q);
    let ads = snap.docs.map(d => ({ id: d.id, ...d.data() } as CustomAd));
    if (placement) ads = ads.filter(a => !a.placement || a.placement === placement || a.placement === 'bottom_banner');
    if (sponsorUid) ads = ads.filter(a => a.sponsorUid === sponsorUid);
    return ads;
  } catch {
    return [];
  }
}

export async function getAllCustomAds(): Promise<CustomAd[]> {
  try {
    const snap = await getDocs(query(collection(db, 'customAds'), orderBy('createdAt', 'desc'), limit(100)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as CustomAd));
  } catch {
    return [];
  }
}

export async function getUserAdCampaigns(uid: string): Promise<CustomAd[]> {
  try {
    const q = query(
      collection(db, 'customAds'),
      where('sponsorUid', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as CustomAd));
  } catch {
    return [];
  }
}

export async function updateAdCampaign(id: string, updates: Partial<CustomAd>): Promise<void> {
  try {
    await updateDoc(doc(db, 'customAds', id), { ...updates, updatedAt: Date.now() });
  } catch (err: any) {
    console.warn('[AdService] updateAdCampaign:', err.message);
  }
}

/* ─── Event Logging ─────────────────────────────────────────────────────── */

export async function logAdImpression(
  adId: string,
  userId: string,
  metaOrTitle: string | { adTitle?: string; placement?: string } = {},
  placementStr?: string
): Promise<void> {
  try {
    const meta = typeof metaOrTitle === 'string'
      ? { adTitle: metaOrTitle, placement: placementStr || 'bottom_banner' }
      : metaOrTitle;

    await Promise.all([
      addDoc(collection(db, 'adAnalytics'), {
        adId, userId,
        action: 'impression',
        adTitle: meta.adTitle || '',
        placement: meta.placement || 'bottom_banner',
        timestamp: serverTimestamp()
      }),
      updateDoc(doc(db, 'customAds', adId), {
        impressions: increment(1),
        updatedAt: Date.now()
      }).catch(() => {})
    ]);
  } catch {}
}

export async function logAdClick(
  adId: string,
  userId: string,
  metaOrTitle: string | { adTitle?: string; targetUrl?: string; placement?: string } = {},
  targetUrlStr?: string,
  placementStr?: string
): Promise<void> {
  try {
    const meta = typeof metaOrTitle === 'string'
      ? { adTitle: metaOrTitle, targetUrl: targetUrlStr || '', placement: placementStr || 'bottom_banner' }
      : metaOrTitle;

    await Promise.all([
      addDoc(collection(db, 'adAnalytics'), {
        adId, userId,
        action: 'click',
        adTitle: meta.adTitle || '',
        targetUrl: meta.targetUrl || '',
        placement: meta.placement || 'bottom_banner',
        timestamp: serverTimestamp()
      }),
      updateDoc(doc(db, 'customAds', adId), {
        clicks: increment(1),
        updatedAt: Date.now()
      }).catch(() => {})
    ]);
  } catch {}
}

export function subscribeAdAnalytics(callback: (events: AdEventLog[]) => void): () => void {
  try {
    const q = query(collection(db, 'adAnalytics'), orderBy('timestamp', 'desc'), limit(200));
    return onSnapshot(q, snap => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as AdEventLog)));
    });
  } catch {
    return () => {};
  }
}

/* ─── User Wallet ────────────────────────────────────────────────────────── */

export async function getUserWallet(uid: string): Promise<UserWallet> {
  try {
    const snap = await getDoc(doc(db, 'userWallets', uid));
    if (snap.exists()) return snap.data() as UserWallet;
    return { uid, balanceInr: 0, totalSpent: 0, lastUpdated: Date.now() };
  } catch {
    return { uid, balanceInr: 0, totalSpent: 0, lastUpdated: Date.now() };
  }
}

export async function adjustUserWallet(uid: string, deltaInr: number): Promise<boolean> {
  try {
    const ref = doc(db, 'userWallets', uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const current = snap.data() as UserWallet;
      const newBalance = Math.max(0, (current.balanceInr || 0) + deltaInr);
      await updateDoc(ref, {
        balanceInr: newBalance,
        totalSpent: deltaInr < 0 ? (current.totalSpent || 0) + Math.abs(deltaInr) : (current.totalSpent || 0),
        lastUpdated: Date.now()
      });
    } else {
      await setDoc(ref, {
        uid,
        balanceInr: Math.max(0, deltaInr),
        totalSpent: 0,
        lastUpdated: Date.now()
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function deductAdBudget(uid: string, adId: string, amountInr: number): Promise<boolean> {
  try {
    const wallet = await getUserWallet(uid);
    if (wallet.balanceInr < amountInr) return false;
    await adjustUserWallet(uid, -amountInr);
    await updateDoc(doc(db, 'customAds', adId), {
      budgetInr: increment(-amountInr),
      updatedAt: Date.now()
    });
    return true;
  } catch {
    return false;
  }
}
