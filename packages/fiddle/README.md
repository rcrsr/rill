# @rcrsr/rill-fiddle

Browser-based interactive editor for the [rill](https://rill.run) scripting language. Built with React and CodeMirror 6.

## Purpose

The fiddle package provides a web UI for writing and executing rill scripts in the browser. It demonstrates rill's runtime API integration and offers an interactive playground for learning the language.

## Editor Features

The CodeMirror 6 editor includes:

- **Dark-only theme** - Brand neon spectrum on void background with WCAG AA contrast ratios
- **2-space indentation** - Configured via `indentUnit.of('  ')` extension
- **Tab key binding** - Tab inserts 2 spaces (per rill conventions), Shift+Tab dedents
- **JetBrains Mono font with ligatures** - Renders `->` as single arrow glyph via `font-variant-ligatures: normal`
- **rill-native syntax highlighting** - Real-time tokenization using `@rcrsr/rill` tokenize function and `TOKEN_HIGHLIGHT_MAP`

## Highlight Map Usage

The editor uses `TOKEN_HIGHLIGHT_MAP` from `@rcrsr/rill` to map token types to highlight categories. This design enables future LSP integration where the map can be extended with semantic tokens:

```typescript
import { tokenize, TOKEN_HIGHLIGHT_MAP } from '@rcrsr/rill';

// Current: Tokenize source for syntax highlighting
const tokens = tokenize(source);

// Future LSP integration: Map semantic tokens to highlight categories
for (const token of tokens) {
  const category = TOKEN_HIGHLIGHT_MAP.get(token.type);
  // Apply category-based styling via @lezer/highlight tags
}
```

The `TOKEN_HIGHLIGHT_MAP` provides a stable interface between the rill parser and editor styling. LSP servers can emit semantic tokens with the same categories for consistent highlighting across tools.

## Development Commands

```bash
# Start development server (http://localhost:5173)
pnpm dev

# Build for production (outputs to dist/)
pnpm build

# Run tests
pnpm test

# Run full validation (build + test + lint)
pnpm run check
```

All commands should be run from the `packages/fiddle` directory or via workspace filter from repository root:

```bash
pnpm --filter @rcrsr/rill-fiddle dev
```

## Architecture

The package follows strict layer boundaries:

| Layer | Location | Imports From | Purpose |
|-------|----------|--------------|---------|
| Orchestrator | `src/App.tsx` | `src/components/`, `src/lib/` | State management and component wiring |
| UI Components | `src/components/*.tsx` | `src/lib/` (types only via `import type`) | React components with props interfaces |
| Logic Modules | `src/lib/*.ts` | `@rcrsr/rill`, standard JS APIs | Framework-agnostic execution and persistence logic |

See `CLAUDE.md` in the repository root for detailed architectural policies (§FDL sections).

## Testing

Tests use Vitest with `@testing-library/react` for component tests and `happy-dom` for DOM simulation:

- Component tests: `src/components/__tests__/*.test.tsx`
- Lib tests: `src/lib/__tests__/*.test.ts`

Run specific test suites:

```bash
pnpm test -- Editor.test.tsx
pnpm test -- execution-success.test.ts
```
