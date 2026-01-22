# CLAUDE.md

## Project

rill is a pipe-based scripting language for orchestrating workflows. ~10,600 lines TypeScript. Zero dependencies.

**Status:** Experimental (v0.0.1). Breaking changes until v1.0.

## Commands

```bash
npm run build          # Compile TypeScript to dist/
npm test               # Run all tests
npm run test:watch     # Watch mode
npm run typecheck      # Type validation only
npm run lint           # Check lint errors
npm run lint:fix       # Auto-fix lint errors
npm run format         # Format with prettier
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

| Directory | Purpose |
|-----------|---------|
| `src/lexer/` | Tokenizer with position tracking |
| `src/parser/` | Recursive descent parser → AST |
| `src/runtime/` | AST execution with pluggable context |
| `src/runtime/smart-parser.ts` | LLM output parsing (JSON, XML, YAML) |
| `src/types.ts` | AST nodes, tokens, error hierarchy |
| `src/index.ts` | Public API exports |

## Key Types

- **`RillValue`** — Union: string, number, bool, list, dict, closure, tuple
- **`RillClosure`** — Function with captured environment
- **`RuntimeContext`** — Execution context (variables, functions, callbacks)
- **`RillError`** — Base error with code, message, location

## Control Flow Internals

- `BreakSignal` and `ReturnSignal` are thrown to unwind call stack
- `AutoExceptionError` halts on pattern-matched failures
- All errors extend `RillError` with source location

## Public API

```typescript
import { parse, execute, createRuntimeContext } from '@rcrsr/rill';

const ast = parse(sourceCode);
const ctx = createRuntimeContext({ variables, functions, callbacks });
const result = await execute(ast, ctx);
```

## Design Principles

1. **Pipes over assignment** — No `=` operator. Data flows via `->`.
2. **No null/undefined** — Empty values valid, "no value" cannot exist.
3. **Value-based** — Deep copy, value comparison. No references.
4. **Immutable types** — Variables lock type on first assignment.
5. **Singular control flow** — No exceptions. Errors halt execution.
6. **Vanilla language** — Host provides all domain functions.

## Documentation

| Document | Content |
|----------|---------|
| [docs/reference.md](docs/reference.md) | Language specification |
| [docs/guide.md](docs/guide.md) | Beginner introduction |
| [docs/collections.md](docs/collections.md) | each, map, filter, fold |
| [docs/host-integration.md](docs/host-integration.md) | Embedding API |
| [docs/grammar.ebnf](docs/grammar.ebnf) | Formal grammar |

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
