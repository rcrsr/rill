@../../brand/design-context.md

## Fiddle Conventions

- React UI lives in `src/components/{Name}.tsx` and framework-agnostic logic in `src/lib/{topic}.ts`. Lib never imports React. Tests go in a `__tests__/` subdirectory of the source directory. `vi.spyOn` only side-effecting modules (worker, storage, clipboard); import real constants.
- Import components directly with `.js` extensions; add no barrel file.
- Components are named exports with a `{Name}Props` interface; no default exports. Each file starts with a header comment and `// ====` section banners.
- `App.tsx` owns app-level and persisted state; components receive data and callbacks via props and keep only transient interaction state locally. Run scripts through `runInWorker` in `src/lib/execution-runner.ts`, never on the main thread.
- Run tests as `pnpm test <path>`, or `pnpm --filter @rcrsr/rill-fiddle test <path>` from the root. Never use `npx` or `pnpm exec`: they bypass the script's `NODE_OPTIONS`.
- Add a code example only as an `EXAMPLES` entry in `src/lib/examples.ts`; never edit `Toolbar.tsx` for it.
- Rill source in `src/lib/examples.ts` and `*.rill` fixtures follows rill idioms; load `docs/llm/anti-patterns.txt` before writing it.
- The fiddle runs the same runtime and semantics as production; add no convenience that changes execution behavior.
