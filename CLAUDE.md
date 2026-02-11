## Monorepo Structure

rill uses pnpm workspaces with the following package organization:

| Package | NPM Name | Purpose |
|---------|----------|---------|
| `packages/core` | `@rcrsr/rill` | Core language runtime and parser |
| `packages/cli` | `@rcrsr/rill-cli` | CLI tools (`rill-exec`, `rill-eval`, `rill-check`) |
| `packages/ext/claude-code` | `@rcrsr/rill-ext-claude-code` | Claude Code integration extension |

## Commands

### Workspace-Level Commands

Run from repository root for all packages:

```bash
pnpm install             # Install dependencies for all packages
pnpm run -r build        # Build all packages in dependency order
pnpm run -r test         # Run tests across all packages
pnpm run -r typecheck    # Type validation for all packages
pnpm run -r lint         # Check lint errors across all packages
pnpm run -r check        # Complete validation (build, test, lint)
```

### Package-Specific Commands

Run from repository root for a single package:

```bash
pnpm --filter @rcrsr/rill build         # Build core package only
pnpm --filter @rcrsr/rill-cli test      # Test CLI package only
pnpm --filter @rcrsr/rill-ext-example typecheck  # Typecheck example extension
```

Or navigate to a package directory and run directly:

```bash
cd packages/core
pnpm build          # Compile TypeScript to dist/
pnpm test           # Run all tests
pnpm typecheck      # Type validation only
pnpm lint           # Check lint errors
pnpm check          # Complete validation (build, test, lint)
```

## Test Organization

| Directory | Purpose | Policy |
|-----------|---------|--------|
| `packages/core/tests/language/` | Language behavior specification | **Protected.** Only modify for language spec changes. |
| `packages/core/tests/runtime/` | Runtime API and implementation | Normal test maintenance applies. |

Run subsets: `pnpm test -- tests/language` or `pnpm test -- tests/runtime`

## Release Process

rill uses a manual release process via `scripts/release.sh`. The script:

1. Verifies clean working directory and main branch
2. Builds all packages (`pnpm run -r build`)
3. Runs all tests (`pnpm run -r test`)
4. Publishes to npm with `--access public`
5. Creates git tags (`@rcrsr/rill@x.y.z`, `@rcrsr/rill-cli@x.y.z`, etc.)
6. Pushes tags to remote

### Release Checklist

Before running `./scripts/release.sh`:

- [ ] Update version in all package.json files
- [ ] Update CHANGELOG.md with release notes
- [ ] Commit version changes: `git commit -m "chore: release vx.y.z"`
- [ ] Ensure working directory is clean
- [ ] Ensure on main branch
- [ ] Run `./scripts/release.sh` and follow prompts

### Dry Run Testing

Test publish without releasing:

```bash
cd packages/core
pnpm publish --dry-run --access public
```

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

Start at @docs/index.md for full navigation.

### Web Docs (packages/web)

The `docs/` directory is the source of truth. `packages/web/content/docs/` pages are generated.

**Never edit generated files directly.** Edit `docs/*.md`, then run `pnpm sync-docs` from `packages/web/`.

`packages/web/content/docs/` is fully generated — never edit it directly.

`packages/web/scripts/sync-docs.sh` transforms source docs into Hugo content:
- SECTION_MAP defines section `_index.md` frontmatter (title, description, weight)
- FILE_MAP controls source-to-section routing and sidebar weight
- LINK_MAP rewrites `(filename.md)` links to Hugo paths
- The docs hub `_index.md` (with cards shortcode) is a heredoc in the script

To add a new doc page:
1. Create `docs/my-topic.md` with H1 title on line 1, italic subtitle on line 3
2. Add entries to FILE_MAP and LINK_MAP in `sync-docs.sh`
3. Run `pnpm sync-docs` from `packages/web/` to verify

To add a new section:
1. Add an entry to SECTION_MAP in `sync-docs.sh`
2. Route source files to the section via FILE_MAP in `sync-docs.sh`
3. Run `pnpm sync-docs` from `packages/web/` to verify

## Documentation Examples

**Fence types:**
- ` ```rill ` — Executable code (tested)
- ` ```text ` — Pseudo-code, syntax demos (skipped)

**Function namespacing:**
- `app::prompt()`, `app::fetch()` — Host-provided functions use `app::` prefix
- `log`, `range`, `json` — Built-ins need no prefix
- `$module.func()` — Module imports via `use:` frontmatter

**Auto-skipped patterns:**
- `# Error:` — Expected error demonstrations
- `# ...` — Continuation markers
