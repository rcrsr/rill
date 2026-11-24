// vitest 5 no longer searches parent directories for a config file, so this
// package-level config inherits the root config via mergeConfig. That keeps the
// `@rcrsr/rill` -> packages/core/src alias in effect when `vitest run` starts
// from this directory.
//
// Timing tests (`*.timing.test.ts`) assert wall-clock ratios, so another test
// file competing for the CPU moves the ratio. They run as their own project in
// a later group: vitest finishes every `unit` file, then runs the timing files
// one at a time on an otherwise idle process. The `rill/timing-test-isolation`
// lint rule fails a timing test not named this way.
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import rootConfig from '../../vitest.config';

const TIMING_GLOB = '**/*.timing.test.ts';

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
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
  })
);
