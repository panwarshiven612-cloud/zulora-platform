const PREVIEW_POLICY = `default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; connect-src 'none'; img-src data: blob: https:; media-src data: blob: https:; style-src 'unsafe-inline' data: https://cdnjs.cloudflare.com https://fonts.googleapis.com https://cdn.jsdelivr.net https://unpkg.com; script-src 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; font-src data: https://cdnjs.cloudflare.com https://fonts.gstatic.com; worker-src blob:`;

const DEPENDENCIES = [
  {
    id: 'tailwind',
    detect: /cdn\.tailwindcss\.com/i,
    markup: '<script src="https://cdn.tailwindcss.com"></script>'
  },
  {
    id: 'animate',
    detect: /animate\.min\.css|animate__animated/i,
    markup: '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css">'
  },
  {
    id: 'gsap',
    detect: /(?:cdnjs\.cloudflare\.com\/ajax\/libs\/gsap|gsap(?:\.min)?\.js|\bgsap\.)/i,
    markup: '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>'
  }
];

/** Normalize generated markup and apply one restrictive, CDN-aware iframe policy. */
export function preparePreviewDocument(source) {
  let html = String(source || '');
  if (!/<html(?:\s|>)/i.test(html)) {
    html = `<!doctype html><html><head></head><body>${html}</body></html>`;
  } else if (!/<!doctype\s+html/i.test(html)) {
    html = `<!doctype html>${html}`;
  }

  if (!/<head(?:\s|>)/i.test(html)) {
    html = html.replace(/<html(?:\s[^>]*)?>/i, match => `${match}<head></head>`);
  }
  if (!/<meta\s+[^>]*charset\s*=/i.test(html)) {
    html = html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}<meta charset="UTF-8">`);
  }
  if (!/<meta\s+[^>]*name=["']viewport["']/i.test(html)) {
    html = html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}<meta name="viewport" content="width=device-width, initial-scale=1">`);
  }

  html = html.replace(/<meta\s+[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
  html = html.replace(/<meta\s+[^>]*content=["'][^"']*Content-Security-Policy[^"']*["'][^>]*>/gi, '');
  html = html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}<meta http-equiv="Content-Security-Policy" content="${PREVIEW_POLICY}">`);

  const dependencies = DEPENDENCIES
    .filter(dependency => !dependency.detect.test(html))
    .map(dependency => dependency.markup)
    .join('');
  const hasLucide = /lucide/i.test(html);
  const hasFontAwesome = /font-?awesome/i.test(html);
  const iconDependency = hasLucide
    ? (/<script[^>]+lucide/i.test(html) ? '' : '<script src="https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js"></script><script>document.addEventListener("DOMContentLoaded",()=>window.lucide?.createIcons?.());</script>')
    : hasFontAwesome ? '' : '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css">';
  if (dependencies || iconDependency) html = html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${dependencies}${iconDependency}`);
  return html;
}

export default preparePreviewDocument;
