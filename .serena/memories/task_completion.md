# Task Completion Checklist

When completing a task, run these commands:

## Required Steps

1. **Type check**: `npm run typecheck`
   - Ensures no TypeScript errors

2. **Lint**: `npm run lint`
   - Checks code quality rules
   - Use `npm run lint:fix` to auto-fix issues

3. **Format**: `npm run format`
   - Applies Prettier formatting
   - Use `npm run format:check` to verify without changes

4. **Test**: `npm test`
   - Runs all Vitest tests
   - Must pass before committing

## Build Verification

5. **Build**: `npm run build`
   - Compiles TypeScript to dist/
   - Verifies output is correct

## Optional Steps

- **Run demo**: `npx tsx src/demo.ts`
  - Sanity check for runtime behavior

- **Coverage**: `npm run test:coverage`
  - Check test coverage for new code
