import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Zulora AI — Free Multi-Model AI Studio',
  description: 'Multi-model AI studio for chat, image generation, and video synthesis. Built by Shiven Panwar.',
  other: {
    'google-adsense-account': 'ca-pub-8102315442541393'
  }
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="google-adsense-account" content="ca-pub-8102315442541393" />
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8102315442541393"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

