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
      '@rcrsr/rill-agent-registry': path.resolve(
        __dirname,
        '../registry/src/index.ts'
      ),
      '@rcrsr/rill-agent-ext-ahi': path.resolve(
        __dirname,
        '../ahi/src/index.ts'
      ),
      '@rcrsr/rill-agent-harness': path.resolve(__dirname, './src/index.ts'),
      '@rcrsr/rill-agent-harness/http': path.resolve(
        __dirname,
        './src/http/index.ts'
      ),
      '@rcrsr/rill-agent-harness/stdio': path.resolve(
        __dirname,
        './src/stdio/index.ts'
      ),
      '@rcrsr/rill-agent-harness/gateway': path.resolve(
        __dirname,
        './src/gateway/index.ts'
      ),
      '@rcrsr/rill-agent-harness/worker': path.resolve(
        __dirname,
        './src/worker/index.ts'
      ),
    },
  },
  test: {
    globals: false,
  },
});
