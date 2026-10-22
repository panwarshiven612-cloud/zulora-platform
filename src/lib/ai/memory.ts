/**
 * memory.ts — Zulora AI Personal Context & Memory Indexer
 * ========================================================
 * Bridges "AI Training & Personal Brain" and "Zulora Vault" into the LLM runtime:
 * - Reads user custom instructions, communication preferences, and domain rules.
 * - Extracts key facts, constraints, and long-term project context from the user's Vault.
 * - Injects structured memory into the LLM system prompt so all model responses are deeply personalized.
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
  updatedAt?: number;
}

export interface UserPersonalMemory {
  brain: AiBrainData;
  vault: UserVaultData;
  recentFacts: string[];
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
    const snap = await getDoc(doc(db, 'users', userId, 'settings', 'ai_brain'));
    if (snap.exists()) {
      return snap.data() as AiBrainData;
    }
  } catch (error) {
    console.warn('[Memory] Failed to read AI Brain from Firestore:', error);
  }
  return {};
}

/**
 * Loads User Vault preferences from Firestore
 */
export async function getUserVault(userId: string): Promise<UserVaultData> {
  if (!userId) return {};
  try {
    const snap = await getDoc(doc(db, 'users', userId, 'settings', 'vault'));
    if (snap.exists()) {
      return snap.data() as UserVaultData;
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
 * Compiles AI Brain & Vault into a unified system prompt instruction
 */
export function compilePersonalContextPrompt(brain: AiBrainData, vault: UserVaultData, facts: string[] = []): string {
  const sections: string[] = [];

  const style = (brain.talkStyle || vault.preferences || '').trim();
  if (style) {
    sections.push(`- Communication Tone & Style: ${style}`);
  }

  const instructions = [brain.customInstructions, vault.customInstructions].filter(Boolean).map(s => s?.trim()).filter(Boolean);
  if (instructions.length) {
    sections.push(`- Custom User Instructions:\n  * ${instructions.join('\n  * ')}`);
  }

  const domain = (brain.domainContext || '').trim();
  if (domain) {
    sections.push(`- Domain Knowledge & Project Rules:\n  ${domain}`);
  }

  const keyFacts = (vault.keyFacts || '').trim();
  if (keyFacts) {
    sections.push(`- Key User Facts & Background:\n  ${keyFacts}`);
  }

  if (facts.length) {
    sections.push(`- Recently Learned Context:\n  * ${facts.join('\n  * ')}`);
  }

  if (sections.length === 0) return '';

  return [
    '==================================================',
    'PERSONAL BRAIN & ZULORA VAULT USER CONTEXT',
    '==================================================',
    'Follow these personalized preferences and instructions strictly throughout this session:',
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

  const [brain, vault, facts] = await Promise.all([
    getAiBrain(userId),
    getUserVault(userId),
    getRecentMemoryFacts(userId, 5)
  ]);

  const compiledContextPrompt = compilePersonalContextPrompt(brain, vault, facts);
  MEMORY_CACHE.set(userId, {
    data: { brain, vault, recentFacts: facts, compiledContextPrompt },
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

