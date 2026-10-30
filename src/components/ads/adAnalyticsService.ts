/**
 * adAnalyticsService.ts — Zulora AI Ad Analytics & Custom Campaign Service
 * =======================================================================
 * Logs impression and click events to the `adAnalytics` Firestore collection.
 * Manages custom promotional sponsor ads in the `customAds` collection.
 */

import { 
  collection, 
  addDoc, 
  getDocs, 
  doc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot 
} from 'firebase/firestore';
import { db } from '../../services/firebase';

export interface CustomAd {
  id?: string;
  title: string;
  sponsorName: string;
  imageUrl: string;
  targetUrl: string;
  ctaText?: string;
  description?: string;
  active: boolean;
  placement?: 'bottom_banner' | 'sidebar' | 'both';
  createdAt?: number;
  impressions?: number;
  clicks?: number;
}

export interface AdEventLog {
  id?: string;
  adId: string;
  adTitle?: string;
  userId: string;
  action: 'impression' | 'click';
  targetUrl?: string;
  placement?: string;
  path?: string;
  userAgent?: string;
  timestamp: number;
  createdAt: string;
}

// In-memory deduplication set to avoid spamming multiple impressions in quick succession
const loggedImpressionsInSession = new Set<string>();

/**
 * Log an ad impression event in Firestore
 */
export async function logAdImpression(
  adId: string, 
  userId: string = 'anonymous', 
  metadata: { adTitle?: string; placement?: string } = {}
): Promise<void> {
  if (!adId) return;

  const sessionKey = `${adId}-${userId}-${Math.floor(Date.now() / (10 * 60 * 1000))}`; // dedupe within 10-minute window
  if (loggedImpressionsInSession.has(sessionKey)) {
    return;
  }
  loggedImpressionsInSession.add(sessionKey);

  try {
    await addDoc(collection(db, 'adAnalytics'), {
      adId,
      adTitle: metadata.adTitle || 'Sponsored Ad',
      userId: userId || 'anonymous',
      action: 'impression',
      placement: metadata.placement || 'bottom_banner',
      path: typeof window !== 'undefined' ? window.location.pathname : '',
      timestamp: Date.now(),
      createdAt: new Date().toISOString()
    });
  } catch (err) {
    // Non-blocking telemetry failure
    console.debug('[AdAnalytics] Impression log skipped:', err);
  }
}

/**
 * Log an ad click event in Firestore
 */
export async function logAdClick(
  adId: string, 
  userId: string = 'anonymous', 
  metadata: { adTitle?: string; targetUrl?: string; placement?: string } = {}
): Promise<void> {
  if (!adId) return;

  try {
    await addDoc(collection(db, 'adAnalytics'), {
      adId,
      adTitle: metadata.adTitle || 'Sponsored Ad',
      userId: userId || 'anonymous',
      action: 'click',
      targetUrl: metadata.targetUrl || '',
      placement: metadata.placement || 'bottom_banner',
      path: typeof window !== 'undefined' ? window.location.pathname : '',
      timestamp: Date.now(),
      createdAt: new Date().toISOString()
    });
  } catch (err) {
    console.debug('[AdAnalytics] Click log error:', err);
  }
}

/**
 * Fetches all active custom promotional ads from Firestore
 */
export async function getActiveCustomAds(placement?: 'bottom_banner' | 'sidebar'): Promise<CustomAd[]> {
  try {
    const q = query(
      collection(db, 'customAds'),
      where('active', '==', true)
    );
    const snap = await getDocs(q);
    const ads: CustomAd[] = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as CustomAd));

    if (!placement) return ads;

    return ads.filter(ad => !ad.placement || ad.placement === placement || ad.placement === 'both');
  } catch (err) {
    console.warn('[AdAnalytics] Failed to fetch custom ads from Firestore:', err);
    return [];
  }
}

/**
 * Listen to real-time custom ads in Admin Panel
 */
export function subscribeCustomAds(callback: (ads: CustomAd[]) => void): () => void {
  try {
    const q = query(collection(db, 'customAds'), orderBy('createdAt', 'desc'), limit(50));
    return onSnapshot(q, (snapshot) => {
      const ads = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as CustomAd));
      callback(ads);
    }, (error) => {
      console.warn('[AdAnalytics] customAds listener error:', error);
      callback([]);
    });
  } catch (err) {
    console.warn('[AdAnalytics] subscribeCustomAds error:', err);
    return () => {};
  }
}

/**
 * Create or save a new custom promotional ad
 */
export async function saveCustomAd(ad: Omit<CustomAd, 'id'>): Promise<string> {
  const docRef = await addDoc(collection(db, 'customAds'), {
    ...ad,
    createdAt: Date.now(),
    updatedAt: new Date().toISOString()
  });
  return docRef.id;
}

/**
 * Toggle active status of a custom ad
 */
export async function toggleCustomAd(adId: string, active: boolean): Promise<void> {
  await updateDoc(doc(db, 'customAds', adId), {
    active,
    updatedAt: new Date().toISOString()
  });
}

/**
 * Delete a custom ad
 */
export async function deleteCustomAd(adId: string): Promise<void> {
  await deleteDoc(doc(db, 'customAds', adId));
}

/**
 * Listen to ad analytics events for the Admin Control Center
 */
export function subscribeAdAnalytics(callback: (events: AdEventLog[]) => void): () => void {
  try {
    const q = query(
      collection(db, 'adAnalytics'), 
      orderBy('timestamp', 'desc'), 
      limit(200)
    );
    return onSnapshot(q, (snapshot) => {
      const events = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as AdEventLog));
      callback(events);
    }, (err) => {
      console.warn('[AdAnalytics] adAnalytics listener error:', err);
      callback([]);
    });
  } catch (err) {
    console.warn('[AdAnalytics] subscribeAdAnalytics error:', err);
    return () => {};
  }
}
