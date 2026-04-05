import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: process.env.FIDDLE_BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@rcrsr/rill': new URL('../core/src/index.ts', import.meta.url).pathname,
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('react-dom') || id.includes('react/')) {
            return 'react';
          }
          if (id.includes('@codemirror/') || id.includes('@lezer/')) {
            return 'codemirror';
          }
        },
      },
    },
  },
});
