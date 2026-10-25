/**
 * memory.ts — Zulora AI Personal Context, Training Brain & Vault Indexer
 * =======================================================================
 * Bridges "AI Training & Personal Brain" and "Zulora Vault" into LLM inference:
 * - Reads user custom instructions, communication preferences, and domain rules from both
 *   `users/{userId}.ai_brain` and `users/{userId}/settings/ai_brain`.
 * - Reads user long-term vault preferences and key facts from both
 *   `users/{userId}/vault/personal` and `users/{userId}/settings/vault`.
 * - Ingests user-fed custom documents and research items from `users/{userId}/vault` and `users/{userId}/search_vault`.
 * - Compiles a structured, high-priority context block injected into the LLM system prompt.
 * - Automatically indexes conversation summaries and key user facts back into Firestore.
 */

import { doc, getDoc, setDoc, updateDoc, collection, addDoc, query, orderBy, limit, getDocs } from 'firebase/firestore';
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

export interface UserPersonalMemory {
  brain: AiBrainData;
  vault: UserVaultData;
  recentFacts: string[];
  vaultDocuments: string[];
  compiledContextPrompt: string;
}

const MEMORY_CACHE = new Map<string, { data: UserPersonalMemory; timestamp: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute cache

/**
 * Loads AI Brain settings from Firestore (checks both user document and settings subcollection)
 */
export async function getAiBrain(userId: string): Promise<AiBrainData> {
  if (!userId) return {};
  try {
    // 1. Check user profile doc directly (where firestoreService.saveAiBrain stores it)
    const userDocSnap = await getDoc(doc(db, 'users', userId));
    if (userDocSnap.exists()) {
      const data = userDocSnap.data();
      if (data?.ai_brain && typeof data.ai_brain === 'object') {
        return data.ai_brain as AiBrainData;
      }
    }

    // 2. Check settings subcollection fallback
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
    // 1. Check vault/personal subcollection (where firestoreService.saveVault stores it)
    const personalVaultSnap = await getDoc(doc(db, 'users', userId, 'vault', 'personal'));
    if (personalVaultSnap.exists()) {
      return personalVaultSnap.data() as UserVaultData;
    }

    // 2. Check settings/vault subcollection fallback
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
 * Compiles AI Brain & Vault into a unified, high-priority system prompt instruction
 */
export function compilePersonalContextPrompt(
  brain: AiBrainData, 
  vault: UserVaultData, 
  facts: string[] = [],
  documents: string[] = []
): string {
  const sections: string[] = [];

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
    'PERSONAL BRAIN & ZULORA VAULT USER CONTEXT',
    '==================================================',
    'Follow these personalized preferences, instructions, and vault documents strictly throughout this session:',
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

  const [brain, vault, facts, documents] = await Promise.all([
    getAiBrain(userId),
    getUserVault(userId),
    getRecentMemoryFacts(userId, 5),
    getUserVaultDocuments(userId, 5)
  ]);

  const compiledContextPrompt = compilePersonalContextPrompt(brain, vault, facts, documents);
  MEMORY_CACHE.set(userId, {
    data: { brain, vault, recentFacts: facts, vaultDocuments: documents, compiledContextPrompt },
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
  getUserPersonalContext,
  compilePersonalContextPrompt,
  indexUserFact
};
