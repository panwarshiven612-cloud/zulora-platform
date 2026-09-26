import React, { useState } from 'react';
import { 
  Heart, 
  ExternalLink, 
  MessageCircle, 
  Mail, 
  Shield, 
  FileText, 
  X,
  Globe
} from 'lucide-react';

export const Footer = () => {
  const [showTerms, setShowTerms] = useState(false);
  const LOGO_URL = "https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg";

  return (
    <>
      <footer className="w-full border-t border-slate-200/80 dark:border-slate-800/80 bg-white/70 dark:bg-slate-950/70 backdrop-blur-xl transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          
          {/* Main Footer Row */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            
            {/* Logo and Brand Info */}
            <div className="flex items-center gap-3">
              <img
                src={LOGO_URL}
                alt="Zulora AI Logo"
                className="w-8 h-8 rounded-xl object-cover ring-1 ring-sky-500/40"
              />
              <div className="flex flex-col">
                <span className="text-sm font-black text-slate-900 dark:text-white">
                  Zulora <span className="text-sky-500">AI</span>
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Next-Gen Intelligence Studio
                </span>
              </div>
            </div>

            {/* Quick Contact Links */}
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <a
                href="https://wa.me/916395211325"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors font-semibold"
              >
                <MessageCircle className="w-4 h-4 text-emerald-500" />
                <span>+91 6395211325</span>
              </a>

              <a
                href="mailto:zulora.help@gmail.com"
                className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-sky-500 dark:hover:text-sky-400 transition-colors font-semibold"
              >
                <Mail className="w-4 h-4 text-sky-500" />
                <span>zulora.help@gmail.com</span>
              </a>

              <button
                onClick={() => setShowTerms(true)}
                className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                <span>Terms & Conditions</span>
              </button>
            </div>

          </div>

          {/* Bottom Divider & Ecosystem Portals */}
          <div className="pt-4 border-t border-slate-200/60 dark:border-slate-800/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            
            {/* Portals */}
            <div className="flex items-center gap-4">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Zulora Portals:</span>
              <a
                href="https://school.zulora.in"
                target="_blank"
                rel="noreferrer"
                className="hover:text-sky-500 transition-colors flex items-center gap-1 hover:underline"
              >
                <Globe className="w-3 h-3 text-sky-500" />
                <span>school.zulora.in</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>

              <a
                href="https://drive.zulora.in"
                target="_blank"
                rel="noreferrer"
                className="hover:text-sky-500 transition-colors flex items-center gap-1 hover:underline"
              >
                <Globe className="w-3 h-3 text-indigo-500" />
                <span>drive.zulora.in</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>

            {/* Creator Attribution */}
            <div className="text-center sm:text-right font-medium">
              Created by <span className="font-bold text-slate-800 dark:text-slate-200">Zulora</span> | Made by{' '}
              <span className="font-bold text-sky-600 dark:text-sky-400">
                Shiven Panwar (Young Entrepreneur)
              </span>
            </div>

          </div>

        </div>
      </footer>

      {/* Terms & Conditions Modal */}
      {showTerms && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xl animate-fade-in">
          <div className="fixed inset-0" onClick={() => setShowTerms(false)} />
          <div className="relative max-w-2xl w-full rounded-3xl glass-dark border border-slate-800 p-6 sm:p-8 z-10 max-h-[85vh] overflow-y-auto space-y-4 text-xs text-slate-300">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Shield className="w-4 h-4 text-sky-400" />
                <span>Zulora AI — Terms & Conditions</span>
              </h3>
              <button
                onClick={() => setShowTerms(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 leading-relaxed">
              <p>
                <strong>1. Acceptance of Terms:</strong> By logging into and utilizing Zulora AI, you agree to comply with our platform policies and fair usage policies.
              </p>
              <p>
                <strong>2. Usage Quotas & Tiers:</strong> Zulora AI applies a rolling hourly capacity pool across chat, image, and video generation. The available capacity varies by plan and is shown as a usage percentage with its reset time. Abuse or automated scraping is strictly prohibited.
              </p>
              <p>
                <strong>3. AI Content Disclaimer:</strong> Content generated by neural models (Gemini, Groq, Cerebras, OpenRouter, Mistral) should be independently verified for critical legal, medical, or financial decision-making.
              </p>
              <p>
                <strong>4. Founder & Corporate Identity:</strong> Zulora AI was created and founded by Shiven Panwar. Inquiries regarding integrations or enterprise contracts may be directed to <code className="text-sky-400">zulora.help@gmail.com</code> or WhatsApp <code className="text-emerald-400">+91 6395211325</code>.
              </p>
              <p>
                <strong>5. Company Portals:</strong> Affiliated initiatives include <a href="https://school.zulora.in" className="text-sky-400 underline">school.zulora.in</a> and <a href="https://drive.zulora.in" className="text-sky-400 underline">drive.zulora.in</a>.
              </p>
            </div>

            <div className="pt-4 border-t border-slate-800 text-right">
              <button
                onClick={() => setShowTerms(false)}
                className="px-4 py-2 rounded-xl azure-gradient-btn text-white font-bold text-xs"
              >
                I Understand
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Footer;
