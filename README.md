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
Zero-downtime waterfall routing across:
1. **Google Gemini 2.0 Flash**: Dynamic rotation across all 7 provided Gemini API keys.
2. **Groq Cloud**: High-throughput `llama-3.3-70b-versatile`.
3. **Cerebras AI**: Ultra-low latency `llama3.1-8b`.
4. **OpenRouter**: Intelligent routing between DeepSeek and Llama 3.3.
5. **Mistral AI**: `mistral-small-latest`.
6. **Pollinations AI**: Text generation & high-definition FLUX.1 image rendering.
7. **Fal AI**: FLUX Schnell and Fast-SVD video synthesis.
8. **Hugging Face**: FLUX.1-schnell inference.
9. **Cloudflare Workers AI**: Llama 3 and SDXL.
10. **Replicate**: SDXL & Stable Video Diffusion.
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
