/**
 * memory.ts — Zulora AI Personal Context, Training Brain & Vault Indexer
 * =======================================================================
 * Bridges "AI Training & Personal Brain", "Zulora Vault", and "User Memory DB" into LLM inference:
 * - Stores user preferences, past searches, active projects, and username in a dedicated Firestore user document.
 * - Ingests user-fed custom documents and research items from `users/{userId}/vault` and `users/{userId}/search_vault`.
 * - Compiles a structured, high-priority context block injected into the LLM system prompt.
 * - Automatically indexes conversation summaries and key user facts back into Firestore.
 */

import { doc, getDoc, setDoc, updateDoc, collection, addDoc, query, orderBy, limit, getDocs, arrayUnion } from 'firebase/firestore';
import { db } from '../../services/firebase';

export interface AiBrainData {
  talkStyle?: string;
  customInstructions?: string;
  domainContext?: string;
  updatedAt?: number;
}

export interface UserVaultData {
  preferences?: string;
  customInstructions?: string;
  keyFacts?: string;
  documentsSummary?: string;
  updatedAt?: number;
}

export interface UserMemoryProfile {
  username?: string;
  pastSearches?: string[];
  activeProjects?: string[];
  preferences?: Record<string, any>;
  lastActivityAt?: number;
  lastSearchQuery?: string;
  lastSearchAt?: number;
  updatedAt?: number;
}

export interface UserPersonalMemory {
  brain: AiBrainData;
  vault: UserVaultData;
  profile: UserMemoryProfile;
  recentFacts: string[];
  vaultDocuments: string[];
  compiledContextPrompt: string;
}

const MEMORY_CACHE = new Map<string, { data: UserPersonalMemory; timestamp: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute cache

/**
 * Loads AI Brain settings from Firestore
 */
export async function getAiBrain(userId: string): Promise<AiBrainData> {
  if (!userId) return {};
  try {
    const userDocSnap = await getDoc(doc(db, 'users', userId));
    if (userDocSnap.exists()) {
      const data = userDocSnap.data();
      if (data?.ai_brain && typeof data.ai_brain === 'object') {
        return data.ai_brain as AiBrainData;
      }
    }

    const settingsSnap = await getDoc(doc(db, 'users', userId, 'settings', 'ai_brain'));
    if (settingsSnap.exists()) {
      return settingsSnap.data() as AiBrainData;
    }
  } catch (error) {
    console.warn('[Memory] Failed to read AI Brain from Firestore:', error);
  }
  return {};
}

/**
 * Loads User Vault preferences and personal facts from Firestore
 */
export async function getUserVault(userId: string): Promise<UserVaultData> {
  if (!userId) return {};
  try {
    const personalVaultSnap = await getDoc(doc(db, 'users', userId, 'vault', 'personal'));
    if (personalVaultSnap.exists()) {
      return personalVaultSnap.data() as UserVaultData;
    }

    const settingsVaultSnap = await getDoc(doc(db, 'users', userId, 'settings', 'vault'));
    if (settingsVaultSnap.exists()) {
      return settingsVaultSnap.data() as UserVaultData;
    }
  } catch (error) {
    console.warn('[Memory] Failed to read User Vault from Firestore:', error);
  }
  return {};
}

/**
 * Retrieves the dedicated User Memory Profile (username, past searches, active projects)
 */
export async function getUserMemoryProfile(userId: string): Promise<UserMemoryProfile> {
  if (!userId) return {};
  try {
    // 1. Check dedicated memory subcollection
    const memSnap = await getDoc(doc(db, 'users', userId, 'memory', 'profile'));
    if (memSnap.exists()) {
      return memSnap.data() as UserMemoryProfile;
    }

    // 2. Fallback to main user doc
    const userSnap = await getDoc(doc(db, 'users', userId));
    if (userSnap.exists()) {
      const data = userSnap.data();
      return {
        username: data.displayName || data.username || '',
        pastSearches: data.pastSearches || (data.lastSearchQuery ? [data.lastSearchQuery] : []),
        activeProjects: data.activeProjects || [],
        preferences: data.preferences || {},
        lastActivityAt: data.lastActiveAt?.seconds ? data.lastActiveAt.seconds * 1000 : data.lastActiveAt,
        lastSearchQuery: data.lastSearchQuery || '',
        lastSearchAt: data.lastSearchAt
      };
    }
  } catch (err) {
    console.warn('[Memory] Failed to get user memory profile:', err);
  }
  return {};
}

/**
 * Records a user search query into Firestore memory
 */
export async function recordUserSearch(userId: string, searchQuery: string): Promise<void> {
  if (!userId || !searchQuery || searchQuery.trim().length < 2) return;
  const clean = searchQuery.trim();

  try {
    const now = Date.now();
    // Update main user document
    await updateDoc(doc(db, 'users', userId), {
      lastSearchQuery: clean,
      lastSearchAt: now,
      lastActiveAt: now,
      pastSearches: arrayUnion(clean.slice(0, 100))
    }).catch(async () => {
      // If doc doesn't support update, use setDoc with merge
      await setDoc(doc(db, 'users', userId), {
        lastSearchQuery: clean,
        lastSearchAt: now,
        lastActiveAt: now,
        pastSearches: [clean.slice(0, 100)]
      }, { merge: true });
    });

    // Also update memory/profile doc
    await setDoc(doc(db, 'users', userId, 'memory', 'profile'), {
      lastSearchQuery: clean,
      lastSearchAt: now,
      lastActivityAt: now,
      pastSearches: arrayUnion(clean.slice(0, 100)),
      updatedAt: now
    }, { merge: true });

    MEMORY_CACHE.delete(userId);
  } catch (err) {
    console.debug('[Memory] recordUserSearch non-critical error:', err);
  }
}

/**
 * Records an active project into user's memory database
 */
export async function recordUserProject(userId: string, projectName: string, summary?: string): Promise<void> {
  if (!userId || !projectName) return;
  const cleanName = projectName.trim();

  try {
    const now = Date.now();
    await setDoc(doc(db, 'users', userId, 'memory', 'profile'), {
      activeProjects: arrayUnion(cleanName),
      lastProject: cleanName,
      lastProjectSummary: summary || '',
      updatedAt: now
    }, { merge: true });

    await setDoc(doc(db, 'users', userId), {
      activeProjects: arrayUnion(cleanName),
      lastActiveAt: now
    }, { merge: true });

    MEMORY_CACHE.delete(userId);
  } catch (err) {
    console.debug('[Memory] recordUserProject error:', err);
  }
}

/**
 * Fetches recent indexed facts from user's memory timeline
 */
export async function getRecentMemoryFacts(userId: string, count = 5): Promise<string[]> {
  if (!userId) return [];
  try {
    const q = query(
      collection(db, 'users', userId, 'memory_facts'),
      orderBy('timestamp', 'desc'),
      limit(count)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => String(d.data().fact || '')).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Fetches user custom documents / vault entries to ground the AI in user-fed knowledge
 */
export async function getUserVaultDocuments(userId: string, count = 5): Promise<string[]> {
  if (!userId) return [];
  try {
    const q = query(
      collection(db, 'users', userId, 'search_vault'),
      orderBy('createdAt', 'desc'),
      limit(count)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      const title = data.title || data.query || '';
      const summary = data.summary || data.snippet || data.content || '';
      return title ? `• ${title}: ${summary.slice(0, 200)}` : '';
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Compiles AI Brain, Vault, and User Memory into a unified, high-priority system prompt instruction
 */
export function compilePersonalContextPrompt(
  brain: AiBrainData, 
  vault: UserVaultData, 
  profile: UserMemoryProfile = {},
  facts: string[] = [],
  documents: string[] = []
): string {
  const sections: string[] = [];

  const userName = profile.username?.trim();
  if (userName) {
    sections.push(`- User Identity: Speaking with ${userName}. Address them naturally when appropriate.`);
  }

  const style = (brain.talkStyle || vault.preferences || '').trim();
  if (style) {
    sections.push(`- Communication Tone & Style Preference: ${style}`);
  }

  const instructions = [brain.customInstructions, vault.customInstructions].filter(Boolean).map(s => s?.trim()).filter(Boolean);
  if (instructions.length) {
    sections.push(`- Custom User Directives & Guidelines:\n  * ${instructions.join('\n  * ')}`);
  }

  const domain = (brain.domainContext || '').trim();
  if (domain) {
    sections.push(`- Domain Knowledge, Work Context & Project Rules:\n  ${domain}`);
  }

  if (profile.activeProjects && profile.activeProjects.length > 0) {
    sections.push(`- Active User Projects:\n  * ${profile.activeProjects.slice(0, 3).join('\n  * ')}`);
  }

  if (profile.pastSearches && profile.pastSearches.length > 0) {
    const recentQueries = profile.pastSearches.slice(-4).reverse();
    sections.push(`- Recent Exploration & Search History:\n  * ${recentQueries.join('\n  * ')}`);
  }

  const keyFacts = (vault.keyFacts || '').trim();
  if (keyFacts) {
    sections.push(`- Key User Background & Profile Facts:\n  ${keyFacts}`);
  }

  if (facts.length) {
    sections.push(`- Learned Long-Term Memory:\n  * ${facts.join('\n  * ')}`);
  }

  if (documents.length) {
    sections.push(`- Grounding Documents & Vault References:\n  ${documents.join('\n  ')}`);
  }

  if (sections.length === 0) return '';

  return [
    '==================================================',
    'PERSONAL BRAIN, VAULT & USER MEMORY CONTEXT',
    '==================================================',
    'Follow these personalized preferences, instructions, and user memory context strictly throughout this session:',
    ...sections,
    '=================================================='
  ].join('\n');
}

/**
 * Retrieves the compiled personal memory context for a given user ID
 */
export async function getUserPersonalContext(userId: string): Promise<string> {
  if (!userId) return '';

  const cached = MEMORY_CACHE.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data.compiledContextPrompt;
  }

  const [brain, vault, profile, facts, documents] = await Promise.all([
    getAiBrain(userId),
    getUserVault(userId),
    getUserMemoryProfile(userId),
    getRecentMemoryFacts(userId, 5),
    getUserVaultDocuments(userId, 5)
  ]);

  const compiledContextPrompt = compilePersonalContextPrompt(brain, vault, profile, facts, documents);
  MEMORY_CACHE.set(userId, {
    data: { brain, vault, profile, recentFacts: facts, vaultDocuments: documents, compiledContextPrompt },
    timestamp: Date.now()
  });

  return compiledContextPrompt;
}

/**
 * Asynchronously indexes important user facts or conversation context into Firestore
 */
export async function indexUserFact(userId: string, factText: string, category = 'conversation'): Promise<void> {
  if (!userId || !factText || factText.trim().length < 5) return;
  try {
    await addDoc(collection(db, 'users', userId, 'memory_facts'), {
      fact: factText.trim(),
      category,
      timestamp: Date.now()
    });
    // Invalidate memory cache so next retrieval includes updated facts
    MEMORY_CACHE.delete(userId);
  } catch (err) {
    console.warn('[Memory] Could not index user fact:', err);
  }
}

export default {
  getAiBrain,
  getUserVault,
  getUserMemoryProfile,
  recordUserSearch,
  recordUserProject,
  getUserPersonalContext,
  compilePersonalContextPrompt,
  indexUserFact
};
