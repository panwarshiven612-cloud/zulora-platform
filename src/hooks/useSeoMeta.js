import { useEffect } from 'react';

const BASE_URL = 'https://zulora.in';

const ROUTE_META = {
  '/': {
    title: 'Zulora AI — Multi-Model AI Studio | Chat, Image & Video Generation',
    description: 'Zulora AI is a production-ready multi-model AI studio. Chat with Gemini, Groq & Mistral, generate images, create videos — all free to start.',
    canonical: `${BASE_URL}/`
  },
  '/signin': {
    title: 'Sign In — Zulora AI',
    description: 'Sign in to Zulora AI with your Google account. Access AI chat, image generation, video studio and cloud storage.',
    canonical: `${BASE_URL}/signin`
  },
  '/login': {
    title: 'Sign In — Zulora AI',
    description: 'Sign in to Zulora AI with your Google account.',
    canonical: `${BASE_URL}/signin`
  },
  '/dashboard': {
    title: 'AI Chat — Zulora AI Workspace',
    description: 'Chat with Gemini, Llama, Groq and more AI models in one place. Zulora AI workspace with connectors, memory and voice input.',
    canonical: `${BASE_URL}/dashboard`
  },
  '/image': {
    title: 'AI Image Studio — Zulora AI',
    description: 'Generate stunning AI images using FLUX, Stable Diffusion and more. Edit, upscale and download with one click.',
    canonical: `${BASE_URL}/image`
  },
  '/video': {
    title: 'AI Video Studio — Zulora AI',
    description: 'Create cinematic AI videos with text prompts. Powered by Fal, Replicate and Pollinations video engines.',
    canonical: `${BASE_URL}/video`
  },
  '/studio': {
    title: 'AI Code Studio — Zulora AI',
    description: 'Build, preview and export full-stack web applications with AI-powered code generation in Zulora Studio.',
    canonical: `${BASE_URL}/studio`
  },
  '/library': {
    title: 'Your Library — Zulora AI',
    description: 'Browse your saved AI chats, generated images, videos and code projects in Zulora Library.',
    canonical: `${BASE_URL}/library`
  },
  '/brain': {
    title: 'AI Brain — Zulora AI',
    description: 'Personalise Zulora AI with your preferences, custom instructions and domain context.',
    canonical: `${BASE_URL}/brain`
  },
  '/vault': {
    title: 'Memory Vault — Zulora AI',
    description: 'Store key facts, preferences and instructions so Zulora AI always remembers your context.',
    canonical: `${BASE_URL}/vault`
  },
  '/settings': {
    title: 'Account Settings — Zulora AI',
    description: 'Manage your Zulora AI account, plan, API usage and connected services.',
    canonical: `${BASE_URL}/settings`
  }
};

const DEFAULT_META = ROUTE_META['/'];

function setMeta(name, content) {
  let el = document.querySelector(`meta[name="${name}"]`) ||
            document.querySelector(`meta[property="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    const isOg = name.startsWith('og:') || name.startsWith('twitter:');
    el.setAttribute(isOg ? 'property' : 'name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(href) {
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/**
 * useSeoMeta — Dynamically updates <title>, meta description, og:*, and canonical
 * per route. Call once in your top-level routing component.
 *
 * @param {string} pathname  current window.location.pathname
 * @param {object} [override]  { title, description, canonical }
 */
export function useSeoMeta(pathname, override = {}) {
  useEffect(() => {
    const meta = { ...DEFAULT_META, ...(ROUTE_META[pathname] || {}), ...override };

    // Title
    document.title = meta.title;

    // Meta description
    setMeta('description', meta.description);

    // Open Graph
    setMeta('og:title', meta.title);
    setMeta('og:description', meta.description);
    setMeta('og:url', meta.canonical);

    // Twitter
    setMeta('twitter:title', meta.title);
    setMeta('twitter:description', meta.description);

    // Canonical link
    setCanonical(meta.canonical);
  }, [pathname, override?.title]);
}

export default useSeoMeta;

