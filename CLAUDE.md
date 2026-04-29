## PR and Commit Policy

The `conduct/` directory and its initiatives, specifications, plans, and requirements are internal workflow artifacts. They are not published and not referenced by consumers. Never cite `conduct/initiatives/...` paths or conduct document names in:

- PR titles or descriptions
- Commit messages on `main` or release branches
- CHANGELOG.md entries
- Any user-facing documentation under `docs/` or `packages/web/`

Write PR and commit summaries as concrete descriptions of the code and API changes. Refer to source files, exported APIs, and doc pages that ship in the package instead.

## Monorepo Structure

rill uses pnpm workspaces with the following package organization:

| Package | NPM Name | Purpose |
|---------|----------|---------|
| `packages/core` | `@rcrsr/rill` | Core language runtime and parser |
| `packages/fiddle` | `@rcrsr/rill-fiddle` (private) | Browser-based rill playground |
| `packages/web` | `@rcrsr/rill-web` (private) | Documentation website |

Extensions live in [rcrsr/rill-ext](https://github.com/rcrsr/rill-ext). Agent framework lives in [rcrsr/rill-agent](https://github.com/rcrsr/rill-agent). CLI tools live in [rcrsr/rill-cli](https://github.com/rcrsr/rill-cli). Config library lives in [rcrsr/rill-config](https://github.com/rcrsr/rill-config).

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
pnpm --filter @rcrsr/rill build        # Build core package only
pnpm --filter @rcrsr/rill test         # Test core package only
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

## Versioning

Only `@rcrsr/rill` (packages/core) is published from this monorepo. Private packages (fiddle, web) track the same version but are not published.

| Scope | Rule |
|-------|------|
| Root `package.json` | Increments patch on every release |
| `packages/core` | Increments patch when core changes |

- `pnpm sync-versions` — Syncs major.minor from root to packages/core
- `pnpm check-versions` — Verifies packages/core shares root major.minor
- CHANGELOG entries use the root version

## Release Process

rill uses a manual release process via `scripts/release.sh`. The script:

1. Verifies clean working directory and main branch
2. Builds all packages (`pnpm run -r build`)
3. Runs all tests (`pnpm run -r test`)
4. Creates a git tag (`v0.18.x`) from root version
5. Pushes tag to trigger CI (CI publishes `@rcrsr/rill`)

### Release Checklist

Before running `./scripts/release.sh`:

- [ ] Bump patch in root `package.json`
- [ ] Bump patch in `packages/core/package.json`
- [ ] Run `pnpm check-versions` to verify alignment
- [ ] Update CHANGELOG.md with release notes under root version
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

## GitHub CLI Workaround

`gh pr edit` fails silently due to a Projects Classic deprecation error. Use the REST API instead:

```bash
gh api repos/rcrsr/rill/pulls/<NUMBER> --method PATCH -f body="new body"
```

## Architecture

```
Source Text → Lexer → Tokens → Parser → AST → Runtime → Result
```

## Design Principles

1. **Pipes over assignment** — No `=` operator. Data flows via `->`.
2. **Type-safe** — No implicit coercion. `"5" + 1` errors, not `"51"` or `6`.
3. **No null/undefined** — Empty values valid, "no value" cannot exist.
4. **Value-based** — Immutable values, value comparison. No mutation after creation.
5. **Immutable types** — Variables lock type on first assignment.
6. **Singular control flow** — No exceptions. Errors halt execution.
7. **No truthiness** — No boolean coercion. Conditions require explicit bool values.
8. **Vanilla language** — Host provides all domain functions.

## Documentation

Start at @docs/index.md for full navigation.

For writing rill code, load @docs/ref-llms.txt — a progressive LLM-optimized index that points to topic fragments under `docs/llm/` (cheatsheet, anti-patterns, control-flow, errors, types, callables, stdlib, style). Pull fragments on demand instead of reading the full reference.

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

**Auto-skipped patterns:**
- `# Error:` — Expected error demonstrations
- `# ...` — Continuation markers
