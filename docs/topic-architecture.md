# rill Architecture

*How source text becomes a result*

## Pipeline Overview

rill processes scripts through a linear pipeline with 4 stages:

```text
Source Text → Lexer → Parser → Runtime → Result
               ↓         ↓
            Tokens      AST
```

Each stage transforms data and passes it forward. Errors at any stage halt execution with a structured error code (see [Error Reference](ref-errors.md)).

## Stage 1: Lexer

The lexer converts source text into a flat sequence of tokens. Each token carries a type, value, and source position.

| Input | Token Type | Value |
|-------|-----------|-------|
| `"hello"` | STRING | hello |
| `42` | NUMBER | 42 |
| `->` | PIPE | -> |
| `$name` | VARIABLE | name |
| `.len` | DOT_ACCESS | len |

The lexer handles string interpolation by splitting `"Hello {$name}"` into string parts and expression tokens. Triple-quoted strings (`"""..."""`) and escape sequences are resolved at this stage.

**Error category:** `RILL-L001` through `RILL-L005` (unterminated strings, invalid characters, malformed numbers).

## Stage 2: Parser

The parser converts the token stream into an Abstract Syntax Tree (AST). The AST represents the program structure as nested nodes.

A pipe chain like:

```text
"hello" -> .upper -> .len
```

Becomes an AST where each `->` creates a pipe node connecting its left operand to its right operand.

The parser resolves operator precedence, groups blocks (`{ }`), and validates syntax (balanced braces, correct operator usage). It does not check types or variable existence.

**Error category:** `RILL-P001` through `RILL-P010` (unexpected tokens, unclosed blocks, invalid expressions).

## Stage 3: Runtime

The runtime walks the AST and evaluates each node. It manages:

| Responsibility | Description |
|---------------|-------------|
| Variable scope | `$` pipe value, `$name` captures, `$ENV` environment |
| Type checking | Validates operand types for every operation |
| Pipe threading | Passes each result as `$` to the next pipe stage |
| Built-in methods | `.len`, `.trim`, `.keys`, collection operators |
| Host functions | Calls registered `app::` functions via `RuntimeContext` |
| Control flow | Conditionals (`?`), loops (`@`), `break`, `return` |
| Limits | Iteration caps, timeouts, abort signals |

The runtime enforces rill's type safety rules: no implicit coercion, no null values, no truthiness. Every type mismatch produces a `RuntimeError` with a specific error code.

**Error category:** `RILL-R001` through `RILL-R061` (type errors, undefined variables, limit violations).

## Host Integration Point

The runtime receives its configuration through `createRuntimeContext()`:

```typescript
import { parse, execute, createRuntimeContext } from '@rcrsr/rill';

const ast = parse(sourceText);
const ctx = createRuntimeContext({
  functions: { /* app:: functions */ },
  variables: { /* initial $variables */ },
  callbacks: { onLog: console.log },
});
const result = await execute(ast, ctx);
```

The host controls what domain functions the script can call. The runtime provides the language; the host provides the capabilities. See [Host Integration](integration-host.md) for the full API.

## Checker Mode

rill supports a static analysis mode (`rill-check`) that validates scripts without executing them. The checker walks the same AST but validates types, variable usage, and function signatures without calling host functions.

```bash
rill-check script.rill    # Type-check only, no execution
```

See [CLI Tools](integration-cli.md) for checker usage.

## See Also

| Document | Description |
|----------|-------------|
| [Error Reference](ref-errors.md) | All error codes with causes and resolutions |
| [Host Integration](integration-host.md) | Embedding rill in applications |
| [Reference](ref-language.md) | Complete language specification |
| [Grammar](ref-grammar.ebnf) | Formal EBNF grammar |
