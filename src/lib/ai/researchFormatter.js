/**
 * researchFormatter.js — Zulora Research Deep Reasoning & Structured Output Framework
 * ===================================================================================
 * Implements the official 8-Part Deep Research Schema:
 * 1. Executive Summary (5 lines max with key stats)
 * 2. Key Findings (5-7 bullets with facts and source tags)
 * 3. Detailed Analysis (Sub-question headings, direct answer first, evidence, "What this means")
 * 4. Comparison Table (At least 5 players/options with price, strengths, weaknesses, source)
 * 5. Risks and Counter-arguments (At least 3)
 * 6. Recommendations (5 ranked, actionable steps: what to do, why, expected result)
 * 7. Confidence and Limits (What is confident, uncertain, missing)
 * 8. Sources (Numbered list: publisher, title, date, URL)
 */

export const RESEARCH_TRIGGER_REGEX = /\b(?:research|deep\s*dive|in-depth|cite|citation|paper|sources|benchmark|analysis|audit|compare|investigate|thorough|market\s*analysis|competitive\s*analysis|landscape|evaluation|comprehensive|detailed\s*report)\b/i;

export const ZULORA_RESEARCH_8_PART_PROMPT = `
================================================================================
ZULORA RESEARCH DEEP REASONING: STRICT 8-PART OUTPUT FRAMEWORK
================================================================================
You are functioning in Zulora Deep Research Mode. You MUST format your response strictly according to the following 8-part structure. Do NOT skip, merge, or reorder any of these sections.

### 1. Executive Summary
- Provide a concise summary in 5 lines maximum.
- Include critical metrics, key statistics, and definitive high-level takeaways.

### 2. Key Findings
- 5 to 7 bullet points containing dense factual takeaways.
- Include inline evidence citations or source attribution tags (e.g. [1], [2]).

### 3. Detailed Analysis
- Break down the analysis with logical sub-question headings (e.g., "#### What drives adoption?").
- Under each heading:
  * Direct Answer First: State the direct conclusion immediately in the opening sentence.
  * Evidence & Proof: Provide factual data, technical depth, or market evidence.
  * "What this means": Conclude the subsection with a clear statement on strategic implications.

### 4. Comparison Table
- Provide a comprehensive Markdown comparison table covering at least 5 key players, products, or strategic options.
- Mandatory Columns:
  | Option / Player | Key Strengths | Weaknesses & Trade-offs | Pricing / Cost Structure | Source Reference |
  |---|---|---|---|---|

### 5. Risks and Counter-arguments
- Detail at least 3 distinct, well-reasoned counter-arguments, failure modes, regulatory risks, or edge-case constraints.

### 6. Recommendations
- 5 prioritized, ranked, actionable steps:
  1. [Rank 1 Action]: What to do | Why it matters | Expected result / metric impact
  2. [Rank 2 Action]: What to do | Why it matters | Expected result / metric impact
  3. [Rank 3 Action]: What to do | Why it matters | Expected result / metric impact
  4. [Rank 4 Action]: What to do | Why it matters | Expected result / metric impact
  5. [Rank 5 Action]: What to do | Why it matters | Expected result / metric impact

### 7. Confidence and Limits
- State transparently:
  * High Confidence: What is verified and rock-solid.
  * Uncertain / Assumptions: Areas where data varies or requires qualification.
  * Missing Information: Key unknowns or gaps requiring further primary research.

### 8. Sources
- Numbered list of authoritative references formatted as:
  [1] Publisher / Author — "Article or Document Title" (Publication Date / Year) - URL or Citation
  [2] Publisher / Author — "Article or Document Title" (Publication Date / Year) - URL or Citation
================================================================================
`;

export function isResearchQuery(prompt = '', modelPreference = '') {
  const text = String(prompt || '').trim();
  const pref = String(modelPreference || '').trim().toLowerCase();

  if (pref === 'think' || pref === 'gemini-2.5-pro' || pref.includes('research')) {
    return true;
  }

  return RESEARCH_TRIGGER_REGEX.test(text);
}

export function formatResearchPrompt(baseSystemPrompt = '', searchContext = '') {
  const parts = [
    baseSystemPrompt,
    ZULORA_RESEARCH_8_PART_PROMPT
  ];

  if (searchContext && searchContext.trim()) {
    parts.push(`GROUNDING RESEARCH SOURCES:\n${searchContext.trim()}`);
  }

  return parts.filter(Boolean).join('\n\n');
}

export default {
  RESEARCH_TRIGGER_REGEX,
  ZULORA_RESEARCH_8_PART_PROMPT,
  isResearchQuery,
  formatResearchPrompt
};

