# rill Project Overview

## Purpose
rill is a pipe-based scripting language for orchestrating workflows. It is an imperative, dynamically-typed scripting language with first-class closures.

## Tech Stack
- **Language**: TypeScript (ES2022 target)
- **Runtime**: Node.js 18+, also compatible with Bun, Deno, and browsers
- **Module System**: ESM (NodeNext)
- **Testing**: Vitest
- **Linting**: ESLint with TypeScript plugin
- **Formatting**: Prettier
- **Dependencies**: Zero runtime dependencies

## Architecture
Classic interpreter pipeline:
```
Source Text → Lexer → Tokens → Parser → AST → Runtime → Result
```

### Directory Structure
```
src/
├── lexer/           # Tokenizer (source → tokens)
├── parser/          # Recursive descent parser (tokens → AST)
├── runtime/
│   ├── core/        # Execution engine, values, signals
│   └── ext/         # Built-in functions, content parsing
├── types.ts         # AST nodes, error types, tokens
├── index.ts         # Public API exports
└── demo.ts          # Integration demo

tests/               # Vitest test files (*.test.ts)
docs/                # Language specification, examples, EBNF grammar
examples/            # Runnable .rill example scripts
```

## Key Design Principles
1. **Pipes over assignment**: Data flows through `->` chains, no `=` operator
2. **No null/undefined**: Empty values are valid, but "no value" cannot be represented
3. **Value-based**: No references, all copies are deep, all comparisons by value
4. **Immutable types**: Variables lock to their initial type on first assignment
5. **Singular control flow**: No exceptions, no try/catch
