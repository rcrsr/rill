# @rcrsr/rill-language-service

Language service tooling for [rill](https://rill.run) — outline, semantic tokens, formatting, scope resolution, hover, go-to-definition, completion, and a static checker.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-language-service @rcrsr/rill
```

`@rcrsr/rill` is a required peer dependency. This package's `peerDependencies` field declares the supported range, and your package manager warns when the installed version falls outside it. The AST crosses the package boundary, so a single shared copy keeps AST types and AST values consistent. Every entry point takes a `ParseResult` from its `parseWithRecovery`, so parse once and pass the result to each call.

## Quick Start

```typescript
import { parseWithRecovery, tokenize } from '@rcrsr/rill';
import { documentSymbols, semanticTokens, formatDocument } from '@rcrsr/rill-language-service';
import { runRules } from '@rcrsr/rill-language-service/rules';
import { getHover } from '@rcrsr/rill-language-service/scope';

const source = '5 => $x\n$x -> log\n';
const parsed = parseWithRecovery(source);

const outline = documentSymbols(parsed);
const tokens = semanticTokens(parsed, tokenize(source), source);
const edits = formatDocument(parsed, source);
const diagnostics = runRules(parsed, source, { rules: {} });
const hover = getHover(parsed, 9); // offset of `$x` on line 2 → variable `x`
```

`parseWithRecovery` does not throw on malformed input. It reports `success: false` and still returns a partial AST, so tooling keeps working while the user types.

## Exports

The package ships three subpaths.

### `@rcrsr/rill-language-service`

| Export | Purpose |
|--------|---------|
| `documentSymbols(parsed)` | Outline symbols for a document |
| `semanticTokens(parsed, tokens, source)` | Semantic tokens for highlighting |
| `formatDocument(parsed, source)` | Format a document, returning `TextEdit[]` |
| `spanToRange(span)` | Convert a `SourceSpan` to a line/column `Range` |
| `version` | Package version string |

### `@rcrsr/rill-language-service/scope`

| Export | Purpose |
|--------|---------|
| `resolveScopeAt(parsed, offset)` | Bindings visible at an offset |
| `findDefinition(parsed, offset)` | Go to definition; `null` when unresolved |
| `getHover(parsed, offset)` | Hover info; `null` when nothing is under the offset |
| `getCompletions(parsed, offset)` | Completion candidates |

### `@rcrsr/rill-language-service/rules`

| Export | Purpose |
|--------|---------|
| `RULES` | Default rule registry; each rule carries a `category` |
| `runRules(parsed, source, config, rules?)` | Run the checker, returning `Diagnostic[]` |
| `capturesInSubtree(node)` | Capture facts for a subtree |

`runRules` defaults to `RULES`; pass a rule array to run a subset. `config` is a `CheckConfig`, whose `rules` field holds per-rule state and whose optional `checkerMode` selects `'strict'` or `'permissive'`. The registry holds 40 rules: 37 active and 3 reserved stubs.

## Documentation

See the [Language Service API reference](https://rill.run/docs/reference/language-service/) for full signatures and types.

## License

MIT
