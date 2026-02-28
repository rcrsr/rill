import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@rcrsr/rill': path.resolve(__dirname, '../../core/src/index.ts'),
      '@rcrsr/rill-agent-shared': path.resolve(
        __dirname,
        '../shared/src/index.ts'
      ),
    },
  },
  test: {
    globals: false,
  },
});
