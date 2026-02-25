import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@rcrsr/rill': path.resolve(__dirname, '../core/src/index.ts'),
      '@rcrsr/rill-compose': path.resolve(
        __dirname,
        '../compose/src/compose.ts'
      ),
    },
  },
  test: {
    globals: false,
  },
});
