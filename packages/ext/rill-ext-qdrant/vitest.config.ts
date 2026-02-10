import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@rcrsr/rill': path.resolve(__dirname, '../../core/src/index.ts'),
    },
  },
  test: {
    globals: false,
  },
});
