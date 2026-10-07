# Zulora AI — Next-Gen Intelligence Studio

<div align="center">
  <img src="https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg" alt="Zulora AI Logo" width="120" style="border-radius: 24px; box-shadow: 0 8px 32px rgba(14, 165, 233, 0.3);" />
  <h3>Pristine Pearl & Azure Glassmorphic AI Suite</h3>
  <p><strong>Created by Zulora | Founded & Engineered by Shiven Panwar (Young Entrepreneur)</strong></p>

  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
  [![Vite](https://img.shields.io/badge/Built%20with-Vite-646CFF.svg)](https://vitejs.dev/)
  [![TailwindCSS](https://img.shields.io/badge/Styled%20with-TailwindCSS-06B6D4.svg)](https://tailwindcss.com/)
  [![Firebase](https://img.shields.io/badge/Auth%20%26%20Database-Firebase-FFCA28.svg)](https://firebase.google.com/)
</div>

---

## 🌟 Overview

**Zulora AI** is a production-ready, fully responsive web application engineered with a **Pearl & Azure Glassmorphic aesthetic** (`#f8fafc` pearl white background, deep immersive dark glass surfaces, and `#0ea5e9` azure accents).

It unites 10 premier foundation models under an automated failover waterfall architecture, ensuring zero downtime for mission-critical chat, deep research, high-definition image generation, and cinematic video synthesis.

---

## 🚀 Key Features

### 1. 🔐 Mandatory Authentication & Access Gating
- Firebase Authentication with Google OAuth (`signInWithPopup` / `signInWithRedirect`).
- Strict access gating redirecting unauthenticated users to the interactive landing page.
- Welcome notification email triggered via **EmailJS** (`@emailjs/browser`) upon initial user registration, with one-time delivery tracked in Cloud Firestore (`welcomeEmailSent: true`).

### 2. ⚡ Multi-Model Automated Fallback Engine (`src/services/apiRouter.js`)
Chat requests use a provider waterfall:
1. **Google Gemini**: Gemini 3.5 Flash routes to Gemini 3.1 Pro when unavailable.
2. **Groq LPU**: Llama 3.3 70B is the final backup, with OpenAI-compatible tool definitions.

Image and video generation use their own provider routing, including Pollinations, Fal AI, Hugging Face, Cloudflare, and Replicate where configured.
8. **Hugging Face**: FLUX.1-schnell image inference.
9. **Cloudflare Workers AI**: Llama 3 and SDXL.
10. **Replicate**: Image generation and video fallback.
11. **Zulora Edge Fallback**: Local neural edge engine for guaranteed response delivery.

### 3. 📊 Usage Limits, Multipliers & Credit System
Stored and tracked dynamically in **Firebase Cloud Firestore** under `users/{uid}`:
- **Free Tier (1x)**:
  - 50 Chats per 2 hours (rolling window)
  - 30 Images per day (24-hour window)
  - 4 Videos per day (24-hour window)
- **Pro Tier (₹299 / month - 2x)**:
  - 100 Chats per 2 hours
  - 60 Images per day
  - 8 Videos per day
- **Ultra Pro Max (₹599 / month - 5x)**:
  - 250 Chats per 2 hours
  - 150 Images per day
  - 20 Videos per day
- Dedicated **Usage Limits Modal** featuring real-time percentage rings, reset countdown timers, and instant upgrade flows.

### 4. 🎨 Creative Studios
- **Chat & Deep Research**: Model preference selector, web grounding with citations, voice input (STT), voice output (TTS), code syntax copy, and multimodal image uploads.
- **Image Studio**: 6 art styles (Photorealistic 8K, Azure Glass, Cyberpunk, Anime, 3D Pixar, Oil Painting), aspect ratios (1:1, 16:9, 9:16, 4:3, 3:4), lightbox preview, and HD downloads.
- **Video Studio**: Camera motion presets (Cinematic Pan, 360 Orbit, Drone Shot, FPV Track), motion speed sliders, and MP4 downloads.

### 5. 🗂️ History & Persistence
- Chat sessions, search queries, and generated visual assets stored under user UIDs in Cloud Firestore.
- Full sidebar history with rename and delete capabilities.

---

## 🌐 Ecosystem Portals & Contact

- **Zulora School Platform**: [school.zulora.in](https://school.zulora.in)
- **Zulora Cloud Drive**: [drive.zulora.in](https://drive.zulora.in)
- **WhatsApp Helpline**: [+91 6395211325](https://wa.me/916395211325)
- **Email Support**: `zulora.help@gmail.com`
- **Founder**: Shiven Panwar (Young Entrepreneur)

## Native Connectors & Zulora Drive setup

The Connectors hub uses an authenticated Google API proxy in production; it does not use browser tabs or require the Zulora Computer Plugin extension. The proxy verifies the signed-in Firebase user, forwards the short-lived Google access token only for the requested API call, and does not persist it. Local development calls Google directly. The extension remains the separate tool for explicitly requested page and DOM automation.

Before enabling Gmail, Sheets, Calendar, or Forms, set `VITE_GOOGLE_CLIENT_ID` to a Google Cloud **Web application** OAuth client ID. Add the deployed app origins to its authorized JavaScript origins, configure the OAuth consent screen, and enable Gmail API, Google Sheets API, Google Calendar API, Google Forms API, and Google Drive API (spreadsheet name discovery uses read-only Drive metadata). The required scopes are requested per connector when the user connects it.

Never set `VITE_GOOGLE_CLIENT_SECRET`: Vite embeds `VITE_*` values in the browser bundle. This app uses the Google Identity Services browser token flow. Keep any OAuth client secret server-side only; rotate a secret if it was exposed in a chat, source file, or browser bundle.

Google Identity Services access tokens are short-lived and do not include refresh tokens. The production proxy does not store Google access or refresh tokens; a user reconnects after the current access token expires. Server-side unattended refresh would require a separately deployed authorization-code flow and secure refresh-token storage.

Zulora Drive uses a second, named Firebase app for project `zulora-drive`, with its own Firebase Google sign-in. Enable Google as a sign-in provider and add the app's authorized domains in that project's Firebase console. The checked-in `firestore.rules` and `storage.rules` include owner-scoped Drive paths; deploy them to the Drive project with `firebase deploy --project zulora-drive --only firestore:rules,storage` after selecting that Firebase project. The Firebase client configuration in `src/config/firebaseDrive.js` is public app configuration; Firebase Security Rules enforce data access.

---

## 🛠️ Getting Started

### Prerequisites
- Node.js 18+ (tested on v24)
- npm 9+

### Installation
```bash
# Clone the repository
git clone https://github.com/panwarshiven612-cloud/zulora-platform.git
cd zulora-platform

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env

# Run local development server
npm run dev

# Build for production
npm run build
```

---

## 📄 License
MIT License © 2026 Zulora AI | Created by Shiven Panwar.
