import React from 'react';
import { CloudUpload, Download, ExternalLink, Palette, Rocket } from 'lucide-react';

const PRESETS = [
  {
    id: 'pearl',
    label: 'Pearl',
    guidance: 'Use the Pearl UI preset: warm pearl-white surfaces, soft blue accents, crisp dark text, refined serif display headings, rounded glass panels, subtle blur, thin translucent borders, and restrained shadows. Keep contrast high and the layout responsive.'
  },
  {
    id: 'azure',
    label: 'Azure',
    guidance: 'Use the Azure UI preset: deep navy and azure surfaces, cool cyan highlights, readable white type, layered glassmorphism panels, backdrop blur, fine luminous borders, and restrained glow. Keep controls accessible and responsive.'
  },
  {
    id: 'glass',
    label: 'Glass',
    guidance: 'Use an accessible glassmorphism design: translucent layered panels, backdrop blur, soft neutral gradients, clear type contrast, subtle borders, and responsive spacing. Avoid putting text directly over busy backgrounds.'
  }
];

function downloadText(contents, filename, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}
function deployScripts() {
  const files = [
    {
      name: 'deploy-vercel.ps1',
      text: '$ErrorActionPreference = "Stop"\nif (-not (Get-Command vercel -ErrorAction SilentlyContinue)) { throw "Install Vercel CLI first: npm i -g vercel" }\nvercel deploy --prod --yes\n'
    },
    {
      name: 'deploy-vercel.sh',
      text: '#!/usr/bin/env sh\nset -eu\ncommand -v vercel >/dev/null 2>&1 || { echo "Install Vercel CLI: npm i -g vercel" >&2; exit 1; }\nvercel deploy --prod --yes\n'
    },
    {
      name: 'deploy-netlify.ps1',
      text: '$ErrorActionPreference = "Stop"\nif (-not (Get-Command netlify -ErrorAction SilentlyContinue)) { throw "Install Netlify CLI first: npm i -g netlify-cli" }\nnetlify deploy --prod --dir .\n'
    },
    {
      name: 'deploy-netlify.sh',
      text: '#!/usr/bin/env sh\nset -eu\ncommand -v netlify >/dev/null 2>&1 || { echo "Install Netlify CLI: npm i -g netlify-cli" >&2; exit 1; }\nnetlify deploy --prod --dir .\n'
    }
  ];
  files.forEach(file => downloadText(file.text, file.name));
}

export default function CodingStudio({ html = '', fileName = 'index.html', onApplyPreset, onToast, showExports = true }) {
  const applyPreset = preset => {
    onApplyPreset?.(preset);
    onToast?.(`${preset.label} preset added to the build prompt.`);
  };

  const exportToDrive = async () => {
    if (!html) return;
    const driveFileName = `${fileName}.txt`;
    const connected = await new Promise(resolve => {
      const finish = value => {
        window.clearTimeout(timer);
        window.removeEventListener('ZULORA_PONG', onPong);
        resolve(value);
      };
      const onPong = () => finish(true);
      const timer = window.setTimeout(() => finish(false), 900);
      window.addEventListener('ZULORA_PONG', onPong, { once: true });
      window.dispatchEvent(new CustomEvent('ZULORA_PING'));
    });

    if (connected) {
      const response = await new Promise(resolve => {
        const finish = value => {
          window.clearTimeout(timer);
          window.removeEventListener('ZULORA_DRIVE_EXPORT_RESULT', onResult);
          resolve(value);
        };
        const onResult = event => finish(event.detail || null);
        const timer = window.setTimeout(() => finish(null), 45000);
        window.addEventListener('ZULORA_DRIVE_EXPORT_RESULT', onResult, { once: true });
        window.dispatchEvent(new CustomEvent('ZULORA_EXPORT_TO_DRIVE', { detail: { html, fileName: driveFileName } }));
      });
      if (response?.ok && response?.success) {
        onToast?.(response.message || `Uploaded ${fileName} to Zulora Drive.`);
        return;
      }
      if (response?.error) {
        downloadText(html, fileName, 'text/html;charset=utf-8');
        onToast?.(`${response.error} A local HTML copy was downloaded.`);
        return;
      }
    }

    downloadText(html, fileName, 'text/html;charset=utf-8');
    window.open('https://drive.zulora.in', '_blank', 'noopener,noreferrer');
    if (!connected) onToast?.('No Zulora extension bridge found. Downloaded the HTML and opened Drive for upload.');
  };

  return <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[.08] bg-[#10131e]/70 p-2.5 text-white backdrop-blur-xl">
    <span className="mr-1 flex items-center gap-1.5 px-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500"><Palette size={13} /> UI preset</span>
    {PRESETS.map(preset => <button key={preset.id} onClick={() => applyPreset(preset)} className="rounded-lg border border-white/10 bg-white/[.035] px-3 py-2 text-[11px] font-semibold text-slate-300 transition hover:border-cyan-200/25 hover:bg-cyan-200/[.08] hover:text-cyan-100">{preset.label}</button>)}
    {showExports && <>
      <span className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />
      <button onClick={exportToDrive} disabled={!html} className="flex items-center gap-1.5 rounded-lg border border-cyan-200/15 bg-cyan-200/[.06] px-3 py-2 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-200/10 disabled:cursor-not-allowed disabled:opacity-40" title="Uploads the HTML source as a .txt file because Drive blocks executable HTML"><CloudUpload size={13} />Export source to Drive</button>
      <button onClick={() => { downloadText(html, fileName, 'text/html;charset=utf-8'); onToast?.(`Downloaded ${fileName}.`); }} disabled={!html} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-slate-300 transition hover:bg-white/[.06] disabled:cursor-not-allowed disabled:opacity-40"><Download size={13} />HTML</button>
      <button onClick={() => { deployScripts(); onToast?.('Downloaded Vercel and Netlify scripts for PowerShell and macOS/Linux. Run one from the folder containing index.html.'); }} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-slate-300 transition hover:bg-white/[.06]"><Rocket size={13} />Deploy scripts</button>
      <a href="https://vercel.com/new" target="_blank" rel="noopener noreferrer" className="ml-auto hidden items-center gap-1 text-[10px] text-slate-500 transition hover:text-cyan-100 md:flex">Vercel <ExternalLink size={11} /></a>
    </>}
  </div>;
}
