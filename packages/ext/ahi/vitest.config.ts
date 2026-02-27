import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@rcrsr/rill': path.resolve(__dirname, '../../core/src/index.ts'),
      '@rcrsr/rill-compose': path.resolve(
        __dirname,
        '../../compose/src/compose.ts'
      ),
      '@rcrsr/rill-registry-client': path.resolve(
        __dirname,
        '../../registry-client/src/index.ts'
      ),
    },
  },
  test: {
    globals: false,
  },
});
