import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
  },
  build: {
    // Raise the warning threshold slightly — we'll also split chunks
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          // React core
          'vendor-react': ['react', 'react-dom'],
          // Firebase
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          // Markdown & syntax highlighting (largest single dependency)
          'vendor-markdown': [
            'react-markdown',
            'remark-gfm',
            'react-syntax-highlighter',
          ],
          // Misc UI
          'vendor-ui': ['lucide-react', 'canvas-confetti', '@emailjs/browser'],
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-markdown',
      'remark-gfm',
      'react-syntax-highlighter',
      'lucide-react',
    ],
  },
});
