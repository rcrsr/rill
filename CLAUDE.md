## PR and Commit Policy

The `conduct/` directory and its initiatives, specifications, plans, and requirements are internal workflow artifacts. They are not published and not referenced by consumers. Never cite `conduct/initiatives/...` paths or conduct document names in:

- PR titles or descriptions
- Commit messages on `main` or release branches
- Any user-facing documentation under `docs/` or `packages/web/`, or root-level published files such as `CHANGELOG.md`
- Source comments and strings under `packages/*/src/`

Write PR and commit summaries as concrete descriptions of the code and API changes. Refer to source files, exported APIs, and doc pages that ship in the package instead.

The same rule covers workflow-artifact identifiers (`AC-*`, `EC-*`, `IR-*`, `FR-*`, and the other prefixes listed in `dev/lint-rules/README.md`). The `rill/no-spec-id-reference` lint rule enforces this across `packages/*/src/`. Keep the fact a comment states and drop the reference: `Negative n halts with #INVALID_INPUT (EC-1).` becomes `Negative n halts with #INVALID_INPUT.` rill's own error codes (`RILL-R010`, `#TYPE_MISMATCH`) are part of the published error surface and stay. `packages/core/tests/` is out of scope, because most occurrences sit in the locked language arbiter.

## Repository Standards Conformance

This repository is the source of `dev/REPO-STANDARDS.md`, the ecosystem
conformance index. Recorded non-applicabilities, per the rule that every N/A
names an element ID and the stated condition it meets:

| Element | Condition met |
|---------|---------------|
| STD-CI-9 (scheduled compatibility workflow) | This repository is the upstream root. It publishes `@rcrsr/rill` and consumes no ecosystem package, so there is no upstream version to drift against. |
| STD-SCRIPT-7 (`typecheck`, `lint`, `check` in `packages/web`) | `packages/web` ships no TypeScript. Its tracked sources are CSS, Hugo templates, two bash scripts, and static assets. `knip.json` already lists it under `ignoreWorkspaces` for the same reason. The exception covers only the three TypeScript-dependent scripts; `build` is present. |

The condition is per package, so it lapses the moment `packages/web` gains a
`.ts` or `.tsx` file. Add the three scripts then rather than widening the row.

`no path filtering` in `ci.yml` is a deliberate ecosystem-wide decision, not an
omission. See STD-CI-7.

Every `uses:` in `.github/workflows/` pins a commit SHA with the release it
belongs to in a trailing comment, per STD-CI-8. When a SHA changes, update the
comment with it.

**Squash is the only merge path.** Merge commits and rebase merges are disabled
in repository settings so they cannot disagree with the required-linear-history
protection rule, per STD-GATE-5. These are GitHub settings, not files, so
nothing in the tree enforces them. Re-check with:

```bash
gh api repos/rcrsr/rill --jq '{allow_merge_commit, allow_rebase_merge, allow_squash_merge, delete_branch_on_merge}'
```

`pnpm bootstrap` is the entry point for a fresh clone: it asserts the node and
pnpm floors from `engines`, installs against the committed lockfile, and builds.
`pnpm check` runs the complete check set, including the root-only checks that
`pnpm -r run check` cannot reach. See STD-SCRIPT-2 and STD-SCRIPT-5.

Shared dev assets live in `dev/`. They are not published and not installable;
`dev/apply.sh` copies them into a target repository. See `dev/README.md`.

## Monorepo Structure

rill uses pnpm workspaces with the following package organization:

| Package | NPM Name | Purpose |
|---------|----------|---------|
| `packages/core` | `@rcrsr/rill` | Core language runtime and parser |
| `packages/service` | `@rcrsr/rill-language-service` | Published language service |
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

`@rcrsr/rill` (packages/core) and `@rcrsr/rill-language-service` (packages/service) are published from this monorepo. Private packages (fiddle, web) are not published and hold a fixed placeholder version of 0.1.0.

| Scope | Rule |
|-------|------|
| Root `package.json` | Increments patch on every release |
| `packages/core` | Increments patch when core changes |
| `packages/service` | Held exactly equal to `packages/core` version, character-for-character |

- `pnpm fix:versions` — Syncs major.minor from root to packages/core, then syncs packages/service to packages/core's full version
- `pnpm check:versions` — Verifies packages/core shares root major.minor and packages/service exactly equals packages/core's version

## Release Process

rill is released by tagging a release commit on `main`. When a `v*` tag is pushed, `.github/workflows/release.yml` iterates over `packages/core` and `packages/service` and publishes each non-private package whose current version is not yet on npm. The job skips any package already published at that version, so `@rcrsr/rill` and `@rcrsr/rill-language-service` publish together only when both carry a new version.

Before publishing, CI enforces a version-consistency gate: `./scripts/check-versions.sh` verifies `packages/core` shares the root major.minor and `packages/service` exactly equals `packages/core`'s version.

### Release Checklist

1. On a release branch, bump the patch in root `package.json` and `packages/core/package.json` (run `pnpm fix:versions` to sync `packages/service` to `packages/core`)
2. Run `pnpm check:versions` to verify alignment
3. Commit with `chore: release vx.y.z`, open a PR, merge to `main`
4. From a clean `main` at the merge commit:

   ```bash
   git tag -a vx.y.z -m "Release vx.y.z"
   git push origin vx.y.z
   ```

CI takes over from the tag push, publishes each package with a new version, and creates a GitHub Release for the tag.

### Dry Run Testing

Test publish without releasing:

```bash
cd packages/core     # or packages/service
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

Before writing any rill code, also load @docs/llm/anti-patterns.txt — Wrong/Right pairs that catch TypeScript and Python reflexes (assignment, truthiness, loops, try/catch, null, string concatenation, array methods).

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
