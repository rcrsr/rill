// vitest 5 no longer searches parent directories for a config file, so this
// package-level config inherits the root config via mergeConfig. That keeps the
// `@rcrsr/rill` -> packages/core/src alias in effect when `vitest run` starts
// from this directory.
//
// Coverage settings live here, not in the root config, because the root config
// is shared by every package and coverage is scoped to core's own sources.
import { defineConfig, mergeConfig } from 'vitest/config';
import rootConfig from '../../vitest.config';

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/generated/**'],
      },
    },
  })
);
