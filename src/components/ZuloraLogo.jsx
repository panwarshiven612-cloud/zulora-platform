import React, { useState } from 'react';

const LOGO_SOURCES = [
  '/assets/zulora-logo.png',
  '/assets/logo.jpg',
  'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg'
];

/**
 * ZuloraLogo — Resilient logo component with multi-stage fallback and clean inline SVG.
 * Ensures the logo NEVER breaks regardless of network or asset availability.
 */
export const ZuloraLogo = ({
  className = 'w-10 h-10',
  imgClassName = 'w-full h-full object-cover',
  alt = 'Zulora AI',
  glassmorphic = false
}) => {
  const [sourceIndex, setSourceIndex] = useState(0);

  const containerClasses = glassmorphic
    ? `relative flex items-center justify-center p-1 rounded-2xl bg-white/20 dark:bg-white/10 backdrop-blur-xl border border-white/40 dark:border-white/20 shadow-xl ${className}`
    : `relative overflow-hidden rounded-2xl ${className}`;

  if (sourceIndex >= LOGO_SOURCES.length) {
    // Pure vector SVG fallback if all raster images fail
    return (
      <div className={`${containerClasses} bg-gradient-to-br from-sky-500 via-indigo-600 to-violet-700`}>
        <svg viewBox="0 0 24 24" className="w-3/5 h-3/5 text-white" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      <img
        src={LOGO_SOURCES[sourceIndex]}
        alt={alt}
        className={imgClassName}
        onError={() => setSourceIndex(prev => prev + 1)}
      />
    </div>
  );
};

export default ZuloraLogo;
