// vitest 5 no longer searches parent directories for a config file, so this
// package-level config inherits the root config via mergeConfig. That keeps the
// `@rcrsr/rill` -> packages/core/src alias in effect when `vitest run` starts
// from this directory.
//
// Coverage settings live here, not in the root config, because the root config
// is shared by every package and coverage is scoped to core's own sources.
//
// Timing tests (`*.timing.test.ts`) assert size ratios on wall-clock time, so
// another test file competing for the CPU moves the ratio. They run as their
// own project in a later group: vitest finishes every `unit` file, then runs
// the timing files one at a time on an otherwise idle process.
// tests/runtime/timing-isolation.test.ts fails a timing test that is not named
// this way.
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import rootConfig from '../../vitest.config';

const TIMING_GLOB = '**/*.timing.test.ts';

// vitest's 5 s default fails CPU-heavy tests that pass in about 1 s when the
// machine is busy: call-depth-ceiling.test.ts took 1.2 s idle and timed out at
// 5.2 s with half the cores held by other processes. The timeout bounds a hang,
// not a duration, so 30 s keeps a stuck test failing while a slow one finishes.
// The slowest unit test takes about 1.5 s on an idle machine.
const TEST_TIMEOUT_MS = 30_000;

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/generated/**'],
      },
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            testTimeout: TEST_TIMEOUT_MS,
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
  })
);
