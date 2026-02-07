import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@rcrsr/rill': new URL('../core/src/index.ts', import.meta.url).pathname,
    },
  },
  build: {
    target: 'es2020',
  },
});
