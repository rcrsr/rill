import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
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
