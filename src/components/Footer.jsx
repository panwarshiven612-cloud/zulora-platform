import React from 'react';
import { ExternalLink, Globe, Mail, MessageCircle } from 'lucide-react';

export const Footer = () => (
  <footer className="w-full border-t border-slate-200/80 bg-white/70 backdrop-blur-xl transition-colors dark:border-slate-800/80 dark:bg-slate-950/70">
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-7 sm:px-6 lg:px-8">
      <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
        <a href="https://zulora.in" className="flex items-center gap-3" aria-label="Zulora AI home">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-white to-sky-100 font-black text-sky-700 shadow ring-1 ring-sky-200">Z</span>
          <span>
            <span className="block text-sm font-black text-slate-900 dark:text-white">Zulora <span className="text-sky-500">AI</span></span>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">Next-Gen Intelligence Studio</span>
          </span>
        </a>

        <nav aria-label="Support contacts" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <a href="mailto:zulora.help@gmail.com" className="inline-flex items-center gap-1.5 transition-colors hover:text-sky-600"><Mail className="h-3.5 w-3.5" /> zulora.help@gmail.com</a>
          <a href="https://wa.me/916395211325" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 transition-colors hover:text-emerald-600"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp +91 6395211325</a>
          <span>24/7 user support for Zulora AI & Zulora Drive</span>
        </nav>
      </div>

      <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200/60 pt-4 text-[11px] text-slate-500 dark:border-slate-800/60 dark:text-slate-400 sm:flex-row">
        <nav aria-label="Zulora portals" className="flex flex-wrap items-center justify-center gap-4">
          <span className="font-semibold text-slate-700 dark:text-slate-300">Zulora Portals:</span>
          <a href="https://school.zulora.in" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-sky-600"><Globe className="h-3 w-3 text-sky-500" /> School <ExternalLink className="h-2.5 w-2.5" /></a>
          <a href="https://drive.zulora.in" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-sky-600"><Globe className="h-3 w-3 text-indigo-500" /> Drive <ExternalLink className="h-2.5 w-2.5" /></a>
        </nav>
        <p className="m-0 text-center sm:text-right">© {new Date().getFullYear()} Zulora AI · Created by Shiven Panwar</p>
      </div>
    </div>
  </footer>
);

export default Footer;
