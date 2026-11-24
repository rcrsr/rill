// Timing tests (`*.timing.test.{ts,tsx}`) assert wall-clock budgets, so
// another test file competing for the CPU moves the measurement. They run as
// their own project in a later group: vitest finishes every `unit` file, then
// runs the timing files one at a time on an otherwise idle process. The
// `rill/timing-test-isolation` lint rule fails a timing test not named this way.
import { configDefaults, defineConfig } from 'vitest/config';

const TIMING_GLOB = '**/*.timing.test.{ts,tsx}';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/**/__tests__/**'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          exclude: [...configDefaults.exclude, TIMING_GLOB],
        },
      },
      {
        extends: true,
        test: {
          name: 'timing',
          include: [TIMING_GLOB],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
