import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  noExternal: ['@rcrsr/rill-ext-llm-shared'],
});
