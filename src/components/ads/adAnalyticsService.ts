/**
 * src/components/ads/adAnalyticsService.ts
 * =========================================
 * Firestore-backed Ad Analytics, Campaign CRUD, and User Wallet management.
 * Tracks impressions, clicks, CTR and ad-to-Pro conversion rates.
 * Enhanced with Global Multi-Collection querying ('adCampaigns', 'adminAds', 'customAds').
 */

import {
  collection, doc, addDoc, getDoc, getDocs, query,
  orderBy, limit, onSnapshot, updateDoc, serverTimestamp,
  increment, setDoc
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import {
  CustomAd as BaseCustomAd,
  AdPlacement as BaseAdPlacement,
  AdStatus as BaseAdStatus,
  AdEventLog as BaseAdEventLog,
  getActiveAds,
  createAdCampaign as serviceCreateCampaign,
  updateAdCampaign as serviceUpdateCampaign,
  logAdImpression as serviceLogImpression,
  logAdClick as serviceLogClick,
  useActiveAds,
  subscribeToActiveAds,
  AD_COLLECTIONS,
  DEFAULT_PROMO_AD
} from '../../lib/ads/adService';

/* ─── Types ─────────────────────────────────────────────────────────────── */

export type AdPlacement = BaseAdPlacement;
export type AdStatus = BaseAdStatus;
export type CustomAd = BaseCustomAd;
export type AdEventLog = BaseAdEventLog;

export interface UserWallet {
  uid: string;
  balanceInr: number;
  totalSpent: number;
  lastUpdated?: number;
}

// Re-export core functions from adService
export { useActiveAds, subscribeToActiveAds, DEFAULT_PROMO_AD, AD_COLLECTIONS };

/* ─── Ad Campaign CRUD ───────────────────────────────────────────────────── */

export async function createAdCampaign(ad: Omit<CustomAd, 'id'>): Promise<string> {
  return serviceCreateCampaign(ad);
}

/**
 * Retrieves active/approved custom ads globally across all collections.
 * Does NOT filter by userId when serving public placements to broadcast everywhere.
 */
export async function getActiveCustomAds(
  placement?: AdPlacement,
  sponsorUid?: string
): Promise<CustomAd[]> {
  try {
    let ads = await getActiveAds(placement);
    if (sponsorUid) {
      ads = ads.filter(a => a.sponsorUid === sponsorUid);
    }
    return ads;
  } catch (err: any) {
    console.warn('[AdAnalyticsService] getActiveCustomAds failed:', err.message);
    return [];
  }
}

/**
 * Retrieves all ad campaigns across all collections (for Admin Panel management).
 */
export async function getAllCustomAds(): Promise<CustomAd[]> {
  try {
    const allAds: CustomAd[] = [];
    await Promise.allSettled(
      AD_COLLECTIONS.map(async coll => {
        const snap = await getDocs(collection(db, coll));
        snap.forEach(d => {
          allAds.push({
            id: d.id,
            ...(d.data() as any),
            _sourceCollection: coll
          });
        });
      })
    );

    // Deduplicate by id and targetUrl
    const seen = new Set<string>();
    const deduped: CustomAd[] = [];
    for (const ad of allAds) {
      const key = ad.id || `${ad.title}_${ad.targetUrl}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(ad);
      }
    }

    deduped.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return deduped;
  } catch {
    return [];
  }
}

/**
 * Retrieves user ad campaigns without requiring composite index.
 */
export async function getUserAdCampaigns(uid: string): Promise<CustomAd[]> {
  try {
    const all = await getAllCustomAds();
    return all.filter(a => a.sponsorUid === uid || (a as any).userId === uid);
  } catch {
    return [];
  }
}

export async function updateAdCampaign(id: string, updates: Partial<CustomAd>): Promise<void> {
  return serviceUpdateCampaign(id, updates);
}

/* ─── Event Logging ─────────────────────────────────────────────────────── */

export async function logAdImpression(
  adId: string,
  userId: string,
  metaOrTitle: string | { adTitle?: string; placement?: string; sourceCollection?: string } = {},
  placementStr?: string
): Promise<void> {
  const meta = typeof metaOrTitle === 'string'
    ? { adTitle: metaOrTitle, placement: placementStr || 'bottom_banner' }
    : metaOrTitle;

  return serviceLogImpression(adId, userId, meta);
}

export async function logAdClick(
  adId: string,
  userId: string,
  metaOrTitle: string | { adTitle?: string; targetUrl?: string; placement?: string; sourceCollection?: string } = {},
  targetUrlStr?: string,
  placementStr?: string
): Promise<void> {
  const meta = typeof metaOrTitle === 'string'
    ? { adTitle: metaOrTitle, targetUrl: targetUrlStr || '', placement: placementStr || 'bottom_banner' }
    : metaOrTitle;

  return serviceLogClick(adId, userId, meta);
}

export function subscribeAdAnalytics(callback: (events: AdEventLog[]) => void): () => void {
  try {
    const q = query(collection(db, 'adAnalytics'), orderBy('timestamp', 'desc'), limit(200));
    return onSnapshot(
      q,
      snap => {
        callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as AdEventLog)));
      },
      error => {
        console.warn('[AdService] subscribeAdAnalytics error:', error.message);
        // Fallback without orderBy in case timestamp index is compiling
        getDocs(collection(db, 'adAnalytics')).then(snap => {
          callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as AdEventLog)));
        }).catch(() => {});
      }
    );
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
    }).catch(() => {});
    await updateDoc(doc(db, 'adCampaigns', adId), {
      budgetInr: increment(-amountInr),
      updatedAt: Date.now()
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}
