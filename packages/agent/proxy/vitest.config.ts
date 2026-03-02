import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@rcrsr/rill-agent-shared': path.resolve(
        __dirname,
        '../shared/src/index.ts'
      ),
      '@rcrsr/rill-agent-harness': path.resolve(
        __dirname,
        '../harness/src/index.ts'
      ),
      '@rcrsr/rill-agent-bundle': path.resolve(
        __dirname,
        '../bundle/src/index.ts'
      ),
    },
  },
  test: {
    globals: false,
  },
});
