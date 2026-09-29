/**
 * Zulora AI — AI Coding Studio & Embedded Superdesign.dev Templates
 * ===================================================================
 * Complete production-grade website & code generation studio merging
 * user requirements with exact Superdesign.dev architectural specifications.
 *
 * Includes 3 Default Flagship Templates:
 *  1. Maker's Landing Page (Warm Paper & Travelling Product)
 *  2. Record-Label Portal Hero & Throwable Card Deck
 *  3. Dark Tech / Developer UI & Event Stream Bento
 */

import { callWaterfallLLM } from './browserAgentEngine';

export const SUPERDESIGN_TEMPLATES = {
  MAKERS_LANDING: {
    id: 'makers_landing',
    name: "Maker's Landing Page (Warm Paper & Travelling Product)",
    summary: `A maker's landing page built on one travelling product: a single fixed image of the object keyframed across the opening sections so it is present throughout without being repeated, and a demonstration that draws itself so the page performs the thing it sells.`,
    style: `Warm paper ground with a deep ink near-black and one ink blue used for emphasis and never as a fill. A high-contrast text serif carries every heading with its italic reserved for the emphasised phrase; a typewriter monospace carries all labels and body copy.`,
    spec: `Apply a warm stationery style. Palette: ground #EFE9DD, secondary ground #E5DED0, ink #141C2B, secondary ink #4A5364, muted #767E8C, one ink blue #2C4A8F, hairlines rgba(20,28,43,.16). Typography: 'Newsreader' 400-600 for display and headings at letter-spacing -.02em, with its ITALIC used for the emphasised phrase in the blue; 'Courier Prime' 400-700 at 11-12px with letter-spacing .07em-.1em for labels and body, line-height near 1.9 so the typewriter face stays readable. Border-radius 0 everywhere including buttons. MUST keep the blue to type, a rule or a drawn line, never a filled area. DO NOT use a gradient, a glow, a bento grid, rounded cards, or a drop shadow on anything except the product cut-out.`,
    layout: `Six sections under a travelling product: a hero with the wordmark spread across the foot, a two-column argument, a demonstration with a variant picker, a material section, a measurements list and a close whose wordmark is cropped by the page edge.
Navigation: Fixed 58px bar on a translucent ground with a 12px backdrop blur and a bottom hairline. Serif wordmark at 19px with a trailing period in the accent, monospaced uppercase links turning accent on hover, one square button.
Hero: Full viewport minus the nav on the secondary ground, overflow clipped, laid out as a column. Copy block no wider than 46vw with monospaced kicker, headline clamp(32px,4.6vw,68px) with italic accent phrase, monospaced lede and two square buttons. Bottom hairline monospaced specs. Spread wordmark across foot with space-between.
Argument and material: Two-column pairing heading and monospaced lede against hairline-ruled rows, small uppercase accent labels.
Demonstration: Variant picker buttons (aria-pressed), bordered SVG output panel using strokeDashoffset drawing animation.
Measurements: Single column hairline-ruled rows with tabular figures.
Close: Short headline with italic accent phrase, monospaced fine-print line, two buttons, footer strip, cropped spread wordmark.`,
    components: [
      'The travelling product: Position:fixed cut-out moving along scroll keyframe path interpolating x, y, rotation, scale, opacity.',
      'A demonstration that draws itself: SVG path using getTotalLength(), strokeDasharray, strokeDashoffset animated over ~2s.',
      'Spread wordmark: Flex row justify-content:space-between, large negative tracking, spreading outward on scroll.'
    ]
  },

  RECORD_LABEL: {
    id: 'record_label',
    name: 'Record-Label Portal Hero & Throwable Card Deck',
    summary: `A record-label landing page whose hero is a portal: two panels part outward to uncover a full-bleed image while the wordmark grows, its tracking tightens and its two halves travel to opposite edges. The catalogue below is a physical deck of sleeves you throw aside.`,
    style: `Near-black ground with a warm bone ink, one amber accent and one teal, both taken from the photography so the page and the image are the same palette. A wide geometric display face carries every heading; a neutral sans carries all small type at wide tracking.`,
    spec: `Apply a dark label style. Palette: ground #0A0C0E, secondary ground #101317, ink #EDE7DC, secondary ink #9EA5A8, muted #6C7378, amber #E8913C, teal #2E6B72, hairlines rgba(237,231,220,.13). Typography: 'Syne' 600-800 for the wordmark and headings at letter-spacing -.02em to -.03em; 'Sora' 400-600 at 10.5-16px, with labels uppercase at letter-spacing .12em-.15em. Pull the two accents OUT of the hero photograph so the interface and the image agree. MUST keep both accents to type, a dot or a rule, never a filled area. DO NOT use a gradient banner, a bento grid, a glow, or a drop shadow on anything except the deck cards.`,
    layout: `Six sections. A tall portal hero with a sticky stage, a full-height statement fold, a two-column releases section carrying a throwable deck, a hairline roster, a dates table, and a close whose wordmark is cropped by the page edge.
Navigation: Fixed 58px bar on a translucent ground with a 14px backdrop blur and bottom hairline. Display wordmark at 15px with trailing amber period, uppercase links at 10.5px turning amber on hover, one pill button.
Portal hero: Tall section (~2.5 viewports) with sticky stage. Back to front: full-bleed image overscaled; duotone wash overlay; radial veil; TWO solid panels meeting in middle parting on scroll; glowing accent dots; split wordmark.
Releases with Throwable Deck: Draggable vinyl/sleeve card deck with physics throw and swipe.
Roster & Tour Dates: Hairline-separated grid with amber/teal badge indicators.`,
    components: [
      'The portal title: Wordmark grows while tracking tightens and halves separate on scroll position.',
      'The portal opening: Opaque panels translate outward on scroll position to uncover background image.',
      'Throwable card deck: Stacked absolute cards with pointerdown/pointermove/release drag throwing physics and touch support.'
    ]
  },

  DARK_TECH: {
    id: 'dark_tech',
    name: 'Dark Tech / Developer UI & Event Stream Bento',
    summary: `A sophisticated developer-centric UI with a dark theme, utilizing square primary buttons, pill-shaped status indicators, and rigorous monospace typography for data integrity. High-contrast table structures and subtle radial accent glows.`,
    style: `Dark Tech aesthetic. Palette: deep #000 background, cards #0a0a0a with 1px ring border rgba(255,255,255,0.145). Typography: 'Inter Display' (500, letter-spacing -1px to -3.36px) for headlines, 'Geist Mono' for metrics (#999999). CTAs: 'btn-square' (0px border-radius, background #FFFFFF, text #121212). Accents: active blue #52a8ff, success green #62c073. Hero scrim: linear-gradient(to top, rgba(0,0,0,0.76) 0%, rgba(0,0,0,0) 93.785%).`,
    spec: `Palette: deep #000 background, cards #0a0a0a with 1px ring border rgba(255,255,255,0.145). Typography: 'Inter Display' (500, letter-spacing -1px to -3.36px) for headlines, 'Geist Mono' for metrics (#999999). CTAs: 'btn-square' (0px border-radius, background #FFFFFF, text #121212). Accents: active blue #52a8ff, success green #62c073. Hero scrim: linear-gradient(to top, rgba(0,0,0,0.76) 0%, rgba(0,0,0,0) 93.785%). DO NOT use soft colorful bubbly shadows. Preserve pure developer monospace grid lines.`,
    layout: `Header (top 38px, padding 56px, geometric SVG logo, nav, 'Book a demo' CTA). Hero section (100svh, fluid headline 32px-60px, subtext, square CTA with arrow). Event Stream Table (trace ID, duration chips, progress-bar timing visualization). Bento Feature Grid (Regression, Failure Clustering, Version Replay code-diff). Metrics Grid (4-column grid with Geist 56px values).`,
    components: [
      'Status Chip (v-chip): Pill indicator (radius 100px), #1f1f1f background, 6px colored dot (#62c073 PASS, #999999 WARN, #ededed ERROR).',
      'Timeline Progress Bar: Horizontal bar with relative width and position percentages showing execution timing.',
      'Code Diff Viewer: High-contrast side-by-side terminal with line numbers.'
    ]
  }
};

/**
 * Builds the comprehensive AI System Prompt embedding all 3 Superdesign templates.
 */
export function buildSuperdesignSystemPrompt(selectedTemplateKey = null) {
  const t1 = SUPERDESIGN_TEMPLATES.MAKERS_LANDING;
  const t2 = SUPERDESIGN_TEMPLATES.RECORD_LABEL;
  const t3 = SUPERDESIGN_TEMPLATES.DARK_TECH;

  let activeGuidance = '';
  if (selectedTemplateKey && SUPERDESIGN_TEMPLATES[selectedTemplateKey]) {
    const t = SUPERDESIGN_TEMPLATES[selectedTemplateKey];
    activeGuidance = `\nSELECTED TARGET TEMPLATE: "${t.name}"\nYou MUST strictly follow this template's spec, palette, typography, and layout rules.\n`;
  }

  return `You are Zulora AI's Superdesign Coding Studio Engine.
Your task is to generate complete, single-file production-grade HTML/CSS/JavaScript websites by merging the user's specific product/business requirements with the exact Superdesign.dev specifications below.
${activeGuidance}
=========================================
TEMPLATE 1: MAKER'S LANDING PAGE (WARM PAPER & TRAVELLING PRODUCT)
=========================================
Summary: ${t1.summary}
Style: ${t1.style}
Spec: ${t1.spec}
Layout & Structure: ${t1.layout}
Special Components:
${t1.components.map(c => `- ${c}`).join('\n')}

=========================================
TEMPLATE 2: RECORD-LABEL PORTAL HERO & THROWABLE CARD DECK
=========================================
Summary: ${t2.summary}
Style: ${t2.style}
Spec: ${t2.spec}
Layout & Structure: ${t2.layout}
Special Components:
${t2.components.map(c => `- ${c}`).join('\n')}

=========================================
TEMPLATE 3: DARK TECH / DEVELOPER UI & EVENT STREAM BENTO
=========================================
Summary: ${t3.summary}
Style & Spec: ${t3.spec}
Layout & Structure: ${t3.layout}
Special Components:
${t3.components.map(c => `- ${c}`).join('\n')}

CRITICAL CODING INSTRUCTIONS:
1. Output ONLY a complete, standalone, self-contained HTML document starting with <!DOCTYPE html> and ending with </html>.
2. Include all necessary Google Fonts in <head> (e.g. 'Newsreader', 'Courier Prime', 'Syne', 'Sora', 'Inter', 'Geist Mono').
3. Include all CSS in a <style> block and all interactive JS (scroll tracking, card throwing, SVG path drawing) in a <script> block before </body>.
4. Merge the user's content, brand name, copy, features, and imagery into the chosen Superdesign template.
5. NO placeholders or "insert code here". Output full, functioning, interactive code.`;
}

/**
 * Automatically detects the best Superdesign template based on the user's prompt.
 */
export function detectBestSuperdesignTemplate(prompt) {
  const p = (prompt || '').toLowerCase();

  // Template 1: Maker / Physical craft / hardware / stationery / book
  if (p.includes('maker') || p.includes('craft') || p.includes('hardware') || p.includes('warm paper') || p.includes('wood') || p.includes('leather') || p.includes('watch') || p.includes('stationery') || p.includes('vintage') || p.includes('book')) {
    return 'MAKERS_LANDING';
  }

  // Template 2: Record label / music / album / artist / creative portfolio / card deck
  if (p.includes('music') || p.includes('record') || p.includes('label') || p.includes('album') || p.includes('audio') || p.includes('artist') || p.includes('portal') || p.includes('vinyl') || p.includes('deck') || p.includes('sleeve')) {
    return 'RECORD_LABEL';
  }

  // Template 3: Dark tech / SaaS / developer / API / dashboard / telemetry / cloud
  if (p.includes('dark tech') || p.includes('developer') || p.includes('saas') || p.includes('api') || p.includes('cloud') || p.includes('stream') || p.includes('bento') || p.includes('metric') || p.includes('dashboard') || p.includes('database')) {
    return 'DARK_TECH';
  }

  // Default to Dark Tech for software, or Maker's Landing for general products
  return p.includes('code') || p.includes('software') || p.includes('app') ? 'DARK_TECH' : 'MAKERS_LANDING';
}

/**
 * Generates a complete Superdesign website code using the Waterfall LLM engine.
 */
export async function generateSuperdesignWebsite(userPrompt, templateKey = null, options = {}) {
  const selectedKey = templateKey || detectBestSuperdesignTemplate(userPrompt);
  const systemPrompt = buildSuperdesignSystemPrompt(selectedKey);

  const prompt = `Create a complete, interactive, single-file HTML website following the chosen Superdesign template for the following requirement:
${userPrompt}

Ensure all interactive components (smooth scroll animations, SVG self-drawing, throwable cards, or timeline bar) are fully coded and functional. Output ONLY raw HTML.`;

  const result = await callWaterfallLLM(prompt, systemPrompt, {
    maxTokens: options.maxTokens || 3500,
    temperature: options.temperature || 0.25,
    timeoutMs: options.timeoutMs || 8000
  });

  if (result.success && result.text) {
    let cleanHtml = result.text.trim();
    if (cleanHtml.startsWith('```html')) {
      cleanHtml = cleanHtml.replace(/^```html\s*/i, '').replace(/```\s*$/, '').trim();
    } else if (cleanHtml.startsWith('```')) {
      cleanHtml = cleanHtml.replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
    }
    return {
      success: true,
      html: cleanHtml,
      template: selectedKey,
      provider: result.provider
    };
  }

  return {
    success: false,
    error: result.error || 'Failed to generate website code',
    html: ''
  };
}

export default {
  SUPERDESIGN_TEMPLATES,
  buildSuperdesignSystemPrompt,
  detectBestSuperdesignTemplate,
  generateSuperdesignWebsite
};
