## Commands

```bash
npm run build          # Compile TypeScript to dist/
npm test               # Run all tests
npm run test:watch     # Watch mode
npm run typecheck      # Type validation only
npm run lint           # Check lint errors
npm run lint:fix       # Auto-fix lint errors
npm run format         # Format with prettier
npm run check          # Complete validation (build, test, lint)
```

## Test Organization

| Directory | Purpose | Policy |
|-----------|---------|--------|
| `tests/language/` | Language behavior specification | **Protected.** Only modify for language spec changes. |
| `tests/runtime/` | Runtime API and implementation | Normal test maintenance applies. |

Run subsets: `npm test -- tests/language` or `npm test -- tests/runtime`

## Architecture

```
Source Text → Lexer → Tokens → Parser → AST → Runtime → Result
```

## Design Principles

1. **Pipes over assignment** — No `=` operator. Data flows via `->`.
2. **Type-safe** — No implicit coercion. `"5" + 1` errors, not `"51"` or `6`.
3. **No null/undefined** — Empty values valid, "no value" cannot exist.
4. **Value-based** — Deep copy, value comparison. No references.
5. **Immutable types** — Variables lock type on first assignment.
6. **Singular control flow** — No exceptions. Errors halt execution.
7. **Vanilla language** — Host provides all domain functions.

## Documentation

| Document | Content |
|----------|---------|
| @docs/00_INDEX.md | Documentation index |
| @docs/01_guide.md | Beginner introduction |
| @docs/11_reference.md | Language specification |
| @docs/14_host-integration.md | Embedding API |
| @docs/15_grammar.ebnf | Formal grammar |

## Documentation Examples

Run `npx tsx scripts/test-examples.ts docs/` to validate all code blocks.

**Fence types:**
- ` ```rill ` — Executable code (tested)
- ` ```text ` — Pseudo-code, syntax demos (skipped)

**Function namespacing:**
- `app::prompt()`, `app::fetch()` — Host-provided functions use `app::` prefix
- `log`, `range`, `parse_json` — Built-ins need no prefix
- `$module.func()` — Module imports via `use:` frontmatter

**Auto-skipped patterns:**
- `# Error:` — Expected error demonstrations
- `# ...` — Continuation markers
