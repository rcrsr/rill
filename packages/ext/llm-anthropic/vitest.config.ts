import { defineConfig } from 'vitest/config';
import { rillAliases } from '../vitest-rill-aliases.js';

export default defineConfig({
  resolve: {
    alias: rillAliases(__dirname),
  },
  test: {
    globals: false,
  },
});
