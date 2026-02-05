/**
 * Vitest Workspace Configuration
 *
 * This file configures workspace-level test settings for the pnpm monorepo.
 * Each package runs tests independently with shared global settings.
 *
 * Workspace Projects:
 * - root: Current tests (temporary - will migrate to packages/core)
 * - core: @rcrsr/rill package tests
 * - cli: @rcrsr/rill-cli package tests
 * - ext: @rcrsr/rill-ext-* extension packages tests
 *
 * Shared Configuration:
 * - globals: true (enables global test functions)
 * - environment: 'node' (Node.js test environment)
 * - coverage: v8 provider with text, html, lcov reporters
 *
 * Run specific projects:
 *   npx vitest --project=core
 *   npx vitest --project=cli
 *   npx vitest --project=ext
 *
 * Run all tests:
 *   npx vitest
 */
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  // Root level tests (temporary - will move to packages during migration)
  {
    test: {
      name: 'root',
      globals: true,
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        include: ['src/**/*.ts'],
        exclude: ['src/index.ts', 'src/demo.ts'],
      },
    },
  },
  // Core package (@rcrsr/rill)
  {
    extends: './tsconfig.base.json',
    test: {
      name: 'core',
      globals: true,
      environment: 'node',
      include: ['packages/core/tests/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        include: ['packages/core/src/**/*.ts'],
        exclude: ['packages/core/src/index.ts'],
      },
    },
  },
  // CLI package (@rcrsr/rill-cli)
  {
    extends: './tsconfig.base.json',
    test: {
      name: 'cli',
      globals: true,
      environment: 'node',
      include: ['packages/cli/tests/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        include: ['packages/cli/src/**/*.ts'],
      },
    },
  },
  // Extension packages (@rcrsr/rill-ext-*)
  {
    extends: './tsconfig.base.json',
    test: {
      name: 'ext',
      globals: true,
      environment: 'node',
      include: ['packages/ext/*/tests/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        include: ['packages/ext/*/src/**/*.ts'],
      },
    },
  },
]);
