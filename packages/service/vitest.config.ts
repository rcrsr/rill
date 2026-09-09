// vitest 5 no longer searches parent directories for a config file, so each
// package that runs `vitest run` from its own directory re-exports the root
// config to keep the `@rcrsr/rill` -> packages/core/src alias in effect.
export { default } from '../../vitest.config';
