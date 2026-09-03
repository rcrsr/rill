# Release SOP

Authoritative procedure for releasing from this repository. `/conduct:cut-release`
follows this file; a human maintainer follows the same steps by hand. Where this
file is more specific than the skill's defaults, this file wins.

This repository has **two independent release tracks**, keyed to two tag
namespaces. `.github/workflows/release.yml` serves both and derives the publish
set from the tag. A tag glob anchors at the start, so `v*` does not match
`dev-v*`.

| Track | Trigger tag | Publishes | Qualifier |
|-------|-------------|-----------|-----------|
| Language | `vX.Y.Z` | `@rcrsr/rill`, `@rcrsr/rill-language-service` | none (default) |
| Dev tooling | `dev-vX.Y.Z` | `@rcrsr/rill-dev` | `dev` |

`/conduct:cut-release X.Y.Z` cuts a language release.
`/conduct:cut-release X.Y.Z dev` cuts a dev-tooling release.

---

## Track 1 — Language release (`vX.Y.Z`, no qualifier)

### Manifests to bump

Set **root `package.json`** and **`packages/core/package.json`** to the release
version, then run the sync command. The tag must equal the **root** version.

- **Bump:** `package.json` (root), `packages/core/package.json`
- **Sync command:** `pnpm fix:versions` — syncs `packages/service` to
  `packages/core` exactly (character-for-character), and reconciles core's
  major.minor to root. Run it after editing the two manifests above; it owns
  `packages/service/package.json`, so never hand-edit that file.
- **Do NOT bump:** `packages/dev` (its own `dev-v*` track), `packages/fiddle`,
  `packages/web` (private, pinned at `0.1.0`).

Root increments on every release; core increments only when core changes, so a
release carrying no core change may legitimately leave core a patch behind (as
at `v0.18.1`: root `0.18.1`, core `0.18.0`). The `v*` gate reads **root**, not
core — do not "fix" core to match root when core did not change. `service` is
always held exactly equal to core.

### Verify

```bash
pnpm check:versions
```

Confirms core shares root's major.minor and service exactly equals core.

### Changelog to stamp

- **Stamp:** root `CHANGELOG.md` only.
- Pending heading is bracketless `## Unreleased`. Rename to `## X.Y.Z - YYYY-MM-DD`
  (bracketless, matching the file's existing dated headings). Insert a fresh
  empty `## Unreleased` above the new dated heading.
- The file uses **inline links** with no bottom reference-definition block —
  do **not** add or update any `[Unreleased]: ...` / `[X.Y.Z]: ...` lines.

### Branch, commit, PR

- **Branch:** `release/X.Y.Z`
- **Commit subject:** `chore: release vX.Y.Z`
- **PR title:** `Release vX.Y.Z`
- **Squash-merge subject:** `chore: release vX.Y.Z (#N)`

Squash is the only merge path (merge and rebase are disabled in repo settings).

### Tag and publish

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

**Do NOT create the GitHub Release manually.** Pushing `vX.Y.Z` triggers
`release.yml`, which publishes both packages **and** creates the GitHub Release
with `--generate-notes`. Creating it by hand collides with the workflow. After
pushing the tag, report that `release.yml` will publish and cut the release.

---

## Track 2 — Dev tooling release (`dev-vX.Y.Z`, qualifier `dev`)

Independent of the language release. `@rcrsr/rill-dev` ships the standards
checker, custom oxlint rules, and `REPO-STANDARDS.md` — development assets, not
language surface — so it versions on its own cadence. Do **not** bump root,
core, or service; nothing outside `packages/dev` participates.

### Manifest to bump

- **Bump:** `packages/dev/package.json` only.
- **Sync command:** none. `pnpm fix:versions` and `pnpm check:versions`
  deliberately exclude `packages/dev`; do not run them for this track.
- **Do NOT bump:** every other manifest.

The `dev-v*` gate in `release.yml` reads `packages/dev/package.json`, so the tag
must equal that manifest's version.

### Changelog to stamp

- **Stamp:** `packages/dev/CHANGELOG.md` only.
- Follow that file's existing heading and link style (Keep a Changelog). Rename
  its pending section to the dated release heading and insert a fresh pending
  section above it.

### Branch, commit, PR

- **Branch:** `release/dev-X.Y.Z`
- **Commit subject:** `chore(release): rill-dev X.Y.Z`
- **PR title:** `Release @rcrsr/rill-dev X.Y.Z`
- **Squash-merge subject:** `chore(release): rill-dev X.Y.Z (#N)`

### Tag and publish

```bash
git tag -a dev-vX.Y.Z -m "Release @rcrsr/rill-dev X.Y.Z"
git push origin dev-vX.Y.Z
```

**Do NOT create the GitHub Release manually.** Pushing `dev-vX.Y.Z` triggers
`release.yml`, which publishes `@rcrsr/rill-dev` and creates the GitHub Release
with `--latest=false` (keeping the repository's "Latest release" badge on the
language) and notes pointing at `packages/dev/CHANGELOG.md`. After pushing the
tag, report that `release.yml` will publish and cut the release.

---

## Both tracks

- **Tag pushes are not cheap metadata.** Pushing either tag fires `release.yml`,
  which publishes to npm with provenance and cuts a GitHub Release. Confirm
  before pushing.
- **PR and commit wording.** Write concrete descriptions of the code and API
  changes. Never cite `conduct/...` paths, conduct document names, or
  workflow-artifact IDs (`AC-*`, `EC-*`, `IR-*`, `FR-*`, etc.) in release
  commits or PR descriptions on `main`. rill's own error codes (`RILL-R010`,
  `#TYPE_MISMATCH`) are published surface and stay.
- **Release notes.** `release.yml` generates the GitHub Release notes for both
  tracks. The release skill's own narrative-summary step still heads the PR body
  for reviewers, but does not become the GitHub Release notes — the workflow
  owns those.
