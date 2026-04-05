import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
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
]);
