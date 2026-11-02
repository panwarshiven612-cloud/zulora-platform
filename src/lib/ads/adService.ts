/**
 * src/lib/ads/adService.ts
 * =========================
 * Global Zulora Ad Broadcasting Service & Real-Time Hooks.
 * 
 * Key Architecture:
 * 1. Global Multi-Collection Query: Listens to 'adCampaigns', 'adminAds', and 'customAds'
 *    in Firestore to catch all admin-created, approved, and user campaigns.
 * 2. Unrestricted Public Broadcast: Does NOT filter by userId, ensuring all active/approved
 *    campaigns are immediately broadcasted to all visitors globally.
 * 3. Composite Index Free: Queries collections and evaluates approval/active status in-memory,
 *    preventing Firestore missing composite index failures.
 * 4. Real-time onSnapshot Synchronization: useActiveAds hook updates instantly when an admin
 *    approves or creates an ad.
 * 5. Complete Analytics: Tracks impressions and clicks into Firestore 'adAnalytics' collection.
 */

import { useState, useEffect, useRef } from 'react';
import {
  collection, doc, addDoc, getDocs, onSnapshot,
  updateDoc, increment, serverTimestamp
} from 'firebase/firestore';
import { db } from '../../services/firebase';

/* ─── Types ─────────────────────────────────────────────────────────────── */

export type AdPlacement = 'bottom_banner' | 'sidebar' | 'chat_sponsored_card' | 'rewarded_modal';
export type AdStatus = 'pending' | 'active' | 'approved' | 'paused' | 'rejected' | 'exhausted';

export interface CustomAd {
  id?: string;
  title: string;
  description?: string;
  imageUrl?: string;
  targetUrl: string;
  ctaText?: string;
  sponsorName?: string;
  sponsorUid?: string;
  placement?: AdPlacement | string;
  status?: AdStatus | string;
  approved?: boolean;
  budgetInr?: number;
  impressionBudget?: number;
  impressions?: number;
  clicks?: number;
  createdAt?: number;
  updatedAt?: number;
  _sourceCollection?: string;
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

/* ─── Target Collections ─────────────────────────────────────────────────── */

export const AD_COLLECTIONS = ['adCampaigns', 'adminAds', 'customAds'] as const;

/**
 * Checks whether an ad document represents an active/approved broadcastable ad.
 * Evaluates active status, approved flag, and filters out paused/rejected/exhausted ads.
 */
export function isAdActive(ad: Partial<CustomAd>): boolean {
  if (!ad) return false;

  // Disqualify stopped, paused, rejected, or exhausted ads
  const st = String(ad.status || '').toLowerCase().trim();
  if (st === 'paused' || st === 'rejected' || st === 'exhausted' || st === 'archived' || st === 'inactive') {
    return false;
  }

  // Active if status is 'active' or 'approved', or boolean approved/isLive/active is true
  const hasApprovedFlag = ad.approved === true || (ad as any).isLive === true || (ad as any).active === true;
  const hasActiveStatus = st === 'active' || st === 'approved';

  // If status is explicitly pending and not approved, do not show to public
  if (st === 'pending' && !hasApprovedFlag) {
    return false;
  }

  // If budget is set and exhausted
  if (ad.impressionBudget && ad.impressions && ad.impressions >= ad.impressionBudget) {
    return false;
  }

  return hasActiveStatus || hasApprovedFlag;
}

/**
 * Normalizes raw Firestore document data into a CustomAd object.
 */
function normalizeAdDoc(id: string, data: any, sourceCollection: string): CustomAd {
  return {
    id,
    title: String(data.title || 'Featured Promotion').trim(),
    description: data.description ? String(data.description).trim() : undefined,
    imageUrl: data.imageUrl ? String(data.imageUrl).trim() : undefined,
    targetUrl: String(data.targetUrl || 'https://zulora.in').trim(),
    ctaText: String(data.ctaText || 'Learn More').trim(),
    sponsorName: String(data.sponsorName || 'Zulora Partner').trim(),
    sponsorUid: data.sponsorUid || undefined,
    placement: data.placement || 'bottom_banner',
    status: data.status || (data.approved ? 'active' : 'pending'),
    approved: Boolean(data.approved || data.status === 'active' || data.status === 'approved'),
    budgetInr: Number(data.budgetInr || 0),
    impressionBudget: Number(data.impressionBudget || 0),
    impressions: Number(data.impressions || 0),
    clicks: Number(data.clicks || 0),
    createdAt: Number(data.createdAt || Date.now()),
    updatedAt: Number(data.updatedAt || Date.now()),
    _sourceCollection: sourceCollection
  };
}

/**
 * High quality default fallback promotional creative.
 * Used only if Firestore has zero active campaigns to guarantee non-blank rendering.
 */
export const DEFAULT_PROMO_AD: CustomAd = {
  id: 'zulora_official_pro_spotlight',
  title: 'Zulora AI Pro & Superintelligence',
  description: 'Unlock 65,000 token execution budget, Gemini 3.8 Flash, instant Groq LPU hardware, and ad-free browsing!',
  imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
  targetUrl: 'https://zulora.in/pricing',
  ctaText: 'Upgrade to Pro',
  sponsorName: 'Zulora AI Official',
  placement: 'bottom_banner',
  status: 'active',
  approved: true,
  createdAt: Date.now()
};

/* ─── Global Real-Time Subscription ──────────────────────────────────────── */

/**
 * Subscribes to all active Zulora ad campaigns globally across collections.
 * Real-time listener: triggers whenever an admin creates, approves, or modifies an ad.
 * Removes user ID restrictions so ads are broadcasted to all users.
 */
export function subscribeToActiveAds(
  callback: (ads: CustomAd[]) => void,
  placement?: AdPlacement | string
): () => void {
  const collectionAdsMap = new Map<string, CustomAd[]>();

  const emit = () => {
    const allDocs: CustomAd[] = [];
    for (const ads of collectionAdsMap.values()) {
      allDocs.push(...ads);
    }

    // Deduplicate by ID and targetUrl
    const seenIds = new Set<string>();
    const deduped: CustomAd[] = [];

    for (const ad of allDocs) {
      const key = ad.id || `${ad.title}_${ad.targetUrl}`;
      if (!seenIds.has(key)) {
        seenIds.add(key);
        deduped.push(ad);
      }
    }

    // Sort newest first
    deduped.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

    // Filter by placement if specified
    let filtered = deduped;
    if (placement) {
      filtered = deduped.filter(a => {
        if (!a.placement) return true;
        if (a.placement === placement) return true;
        // bottom_banner acts as universal broadcast for chat cards as well
        if (placement === 'chat_sponsored_card' && a.placement === 'bottom_banner') return true;
        return false;
      });
    }

    callback(filtered);
  };

  const unsubs: (() => void)[] = [];

  for (const collName of AD_COLLECTIONS) {
    try {
      const colRef = collection(db, collName);
      const unsub = onSnapshot(
        colRef,
        snapshot => {
          const valid: CustomAd[] = [];
          snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const ad = normalizeAdDoc(docSnap.id, data, collName);
            if (isAdActive(ad)) {
              valid.push(ad);
            }
          });
          collectionAdsMap.set(collName, valid);
          emit();
        },
        error => {
          console.warn(`[AdService] onSnapshot listener error on ${collName}:`, error.message);
          collectionAdsMap.set(collName, []);
          emit();
        }
      );
      unsubs.push(unsub);
    } catch (err: any) {
      console.warn(`[AdService] Failed to attach listener to ${collName}:`, err.message);
    }
  }

  return () => {
    unsubs.forEach(u => {
      try { u(); } catch {}
    });
  };
}

/**
 * One-shot asynchronous query for active ads across all collections.
 */
export async function getActiveAds(placement?: AdPlacement | string): Promise<CustomAd[]> {
  const allAds: CustomAd[] = [];

  await Promise.allSettled(
    AD_COLLECTIONS.map(async collName => {
      try {
        const snap = await getDocs(collection(db, collName));
        snap.forEach(d => {
          const ad = normalizeAdDoc(d.id, d.data(), collName);
          if (isAdActive(ad)) {
            allAds.push(ad);
          }
        });
      } catch (err: any) {
        console.warn(`[AdService] getActiveAds fetch failed for ${collName}:`, err.message);
      }
    })
  );

  // Deduplicate
  const seen = new Set<string>();
  const deduped: CustomAd[] = [];
  for (const ad of allAds) {
    const key = ad.id || `${ad.title}_${ad.targetUrl}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(ad);
    }
  }

  // Sort newest first
  deduped.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

  if (placement) {
    return deduped.filter(a => {
      if (!a.placement) return true;
      if (a.placement === placement) return true;
      if (placement === 'chat_sponsored_card' && a.placement === 'bottom_banner') return true;
      return false;
    });
  }

  return deduped;
}

/* ─── Frontend React Hook: useActiveAds ─────────────────────────────────── */

/**
 * useActiveAds: Real-time React hook to consume broadcasted active ads.
 * Broadcasts across bottom banners, sponsored cards, and rewarded modals.
 * When admin creates/approves an ad, activeAd updates instantly.
 */
export function useActiveAds(placement?: AdPlacement | string) {
  const [ads, setAds] = useState<CustomAd[]>([]);
  const [activeAd, setActiveAd] = useState<CustomAd | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const activeAdIdRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    const unsubscribe = subscribeToActiveAds(fetchedAds => {
      if (!mounted) return;
      setAds(fetchedAds);

      if (fetchedAds.length > 0) {
        // Keep current ad if still valid, otherwise pick one
        const currentStillActive = fetchedAds.find(a => a.id === activeAdIdRef.current);
        if (currentStillActive) {
          setActiveAd(currentStillActive);
        } else {
          const selected = fetchedAds[Math.floor(Math.random() * fetchedAds.length)];
          activeAdIdRef.current = selected.id || null;
          setActiveAd(selected);
        }
      } else {
        activeAdIdRef.current = null;
        setActiveAd(null);
      }
      setLoading(false);
    }, placement);

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [placement]);

  return { ads, activeAd, loading };
}

/* ─── Impression & Click Tracking ────────────────────────────────────────── */

/**
 * Logs an impression to the 'adAnalytics' Firestore collection and increments document counter.
 */
export async function logAdImpression(
  adId: string,
  userId: string = 'guest',
  meta: { adTitle?: string; placement?: string; sourceCollection?: string } = {}
): Promise<void> {
  if (!adId || adId.startsWith('zulora_official_')) return;

  const placement = meta.placement || 'bottom_banner';
  const adTitle = meta.adTitle || '';

  try {
    // 1. Record analytics event
    await addDoc(collection(db, 'adAnalytics'), {
      adId,
      userId: userId || 'guest',
      action: 'impression',
      adTitle,
      placement,
      timestamp: serverTimestamp()
    });

    // 2. Increment impression counter on ad document across possible collections
    const collectionsToTry = meta.sourceCollection ? [meta.sourceCollection] : AD_COLLECTIONS;
    await Promise.allSettled(
      collectionsToTry.map(coll =>
        updateDoc(doc(db, coll, adId), {
          impressions: increment(1),
          updatedAt: Date.now()
        })
      )
    );
  } catch (err: any) {
    console.warn('[AdService] Failed to log ad impression:', err.message);
  }
}

/**
 * Logs an ad click to the 'adAnalytics' Firestore collection and increments document counter.
 */
export async function logAdClick(
  adId: string,
  userId: string = 'guest',
  meta: { adTitle?: string; targetUrl?: string; placement?: string; sourceCollection?: string } = {}
): Promise<void> {
  if (!adId || adId.startsWith('zulora_official_')) return;

  const placement = meta.placement || 'bottom_banner';
  const adTitle = meta.adTitle || '';
  const targetUrl = meta.targetUrl || '';

  try {
    // 1. Record analytics event
    await addDoc(collection(db, 'adAnalytics'), {
      adId,
      userId: userId || 'guest',
      action: 'click',
      adTitle,
      targetUrl,
      placement,
      timestamp: serverTimestamp()
    });

    // 2. Increment click counter on ad document across possible collections
    const collectionsToTry = meta.sourceCollection ? [meta.sourceCollection] : AD_COLLECTIONS;
    await Promise.allSettled(
      collectionsToTry.map(coll =>
        updateDoc(doc(db, coll, adId), {
          clicks: increment(1),
          updatedAt: Date.now()
        })
      )
    );
  } catch (err: any) {
    console.warn('[AdService] Failed to log ad click:', err.message);
  }
}

/* ─── Campaign Creation & Admin Approval Updates ─────────────────────────── */

/**
 * Creates an ad campaign in both 'adCampaigns' and 'customAds' collections
 * so any listener or legacy code will find it.
 */
export async function createAdCampaign(ad: Partial<CustomAd>): Promise<string> {
  try {
    const isExplicitActive = ad.status === 'active' || ad.approved === true;
    const status = isExplicitActive ? 'active' : (ad.status || 'pending');
    const approved = isExplicitActive;

    const payload = {
      ...ad,
      status,
      approved,
      impressions: Number(ad.impressions || 0),
      clicks: Number(ad.clicks || 0),
      createdAt: ad.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    // Save to primary adCampaigns and backup customAds
    const [ref1] = await Promise.all([
      addDoc(collection(db, 'adCampaigns'), payload),
      addDoc(collection(db, 'customAds'), payload).catch(() => null)
    ]);

    return ref1?.id || '';
  } catch (err: any) {
    console.warn('[AdService] createAdCampaign failed:', err.message);
    return '';
  }
}

/**
 * Updates an ad campaign status / approval across all ad collections.
 */
export async function updateAdCampaign(adId: string, updates: Partial<CustomAd>): Promise<void> {
  if (!adId) return;

  const isApproved = updates.status === 'active' || updates.approved === true;
  const payload = {
    ...updates,
    ...(isApproved ? { approved: true, status: 'active' } : {}),
    updatedAt: Date.now()
  };

  await Promise.allSettled(
    AD_COLLECTIONS.map(coll => updateDoc(doc(db, coll, adId), payload))
  );
}

export default {
  useActiveAds,
  subscribeToActiveAds,
  getActiveAds,
  logAdImpression,
  logAdClick,
  createAdCampaign,
  updateAdCampaign,
  isAdActive,
  DEFAULT_PROMO_AD,
  AD_COLLECTIONS
};

