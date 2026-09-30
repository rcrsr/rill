@../../brand/design-context.md

## Fiddle Conventions

- React UI lives in `src/components/{Name}.tsx` and framework-agnostic logic in `src/lib/{topic}.ts`. Lib never imports React. Tests go in a `__tests__/` subdirectory of the source directory.
- Import components directly with `.js` extensions; add no barrel file.
- `App.tsx` owns all app state; components receive props only. Run scripts through `runInWorker` in `src/lib/execution-runner.ts`, never on the main thread.
- Run tests as `pnpm test -- <path>`, or `pnpm --filter @rcrsr/rill-fiddle test -- <path>` from the root. Never use `npx` or `pnpm exec`: they bypass the script's `NODE_OPTIONS`.
