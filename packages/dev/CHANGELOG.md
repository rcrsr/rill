# Changelog

All notable changes to `@rcrsr/rill-dev` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This package versions independently of `@rcrsr/rill`. It ships development
tooling, not language surface, so its version numbers carry no relationship to
the language version. Language changes are recorded in the
[root changelog](https://github.com/rcrsr/rill/blob/main/CHANGELOG.md).

## Unreleased

### Added

- **`STD-REL-8`: every published package's manifest declares `repository`, so provenance has a source to bind to.** Renumbered off the check that previously double-claimed `STD-REL-3` alongside the canonical publishes-with-provenance element, which meant only one of the two `check-standards.sh` calls for that ID was ever visible in a run's output. `STD-REL-3` continues to mean "publishes with provenance"; the repository-declaration check now reports under its own ID. A `packages/dev/REPO-STANDARDS.md` row documents it, N/A under the same "repository publishes nothing" condition as the rest of §7. `STD-REL-8` also now reports `--` (skip), never `ok`, when a repository has zero publishable manifests — the loop that decides it previously never ran its body in that case, so "nothing to check" and "checked, nothing failed" read identically as a vacuous `ok`.

### Fixed

- **`STD-HOOK-4` now checks the `pre-push` block's contents, not just the key's presence.** A `lefthook.yml` carrying an empty or partial `pre-push:` block (for example, a typecheck step with no test step) previously passed on the key alone. The check now slices the block from `pre-push:` to the next top-level key and requires both a typecheck and a test invocation inside it, naming whichever is missing in the failure detail.
- **`STD-CI-4`, `STD-REL-1`, `STD-REL-3`, `STD-REL-4`, `STD-REL-5`, `STD-REL-6`, and `STD-REL-7` no longer match their token inside a `#` comment.** Each ran a raw `grep -q` over the workflow file, so a removed step or a stale example left behind in a comment (`# frozen-lockfile`, `# EPUBLISHCONFLICT`) read as the real thing and reported `ok` for a workflow that no longer does what the comment describes. All seven now route through a new shared `grep_noncomment` helper that joins backslash continuations and drops full comment lines before matching, the same shape already used for the `STD-PROC-7` label-sync read.

## 0.2.4 - 2026-08-27

### Added

- **`STD-HOOK-5`: no pre-commit `glob` may reduce to a set the invoked formatter or linter fully ignores.** A hook glob (`lefthook.yml`) and a tool's own `ignorePatterns` (`.oxfmtrc.json`, `.oxlintrc.json`) are declared in two different files and were checked against each other by nothing. When every staged file a glob selects is also in the tool's own ignore list, the tool receives an all-ignored input and commonly exits non-zero instead of no-op, halting the rest of a `piped: true` pre-commit chain (`STD-HOOK-3`) over a commit that touches nothing the tool cares about — a lockfile-only commit is the common trigger. This is a new hard-failure element: a consumer whose `lefthook.yml` `oxfmt`/`oxlint` glob matches a file also covered by that tool's `ignorePatterns` newly reports `bad` on upgrade. Fix it by adding an `exclude:` entry under the affected `lefthook.yml` command for each such file or directory (this repository added `pnpm-lock.yaml` and `packages/web/**` under the `oxfmt` command), narrowing the `glob` itself, or moving the ignore into the glob — not by dropping `piped: true` or reordering format-before-lint. ([#245](https://github.com/rcrsr/rill/pull/245))
- **`rill/no-spec-id-reference` accepts an `{ ignore: string[] }` option.** An exact-match whitelist for incidental matches that are not workflow-artifact references — a date written `DD-MM-YYYY`, a work-item-shaped constant like `LOG-LEVEL`. Each entry is compared against the full matched id verbatim (case-sensitive, no wildcards) and does not affect the underlying `\b`-bounded scan. ([#245](https://github.com/rcrsr/rill/pull/245))
- **`STD-SUP-8`: conformance element requiring `.github/dependabot.yml` ecosystem blocks to set `open-pull-requests-limit` to `0`.** Version-update PRs are disabled while security PRs continue. ([#248](https://github.com/rcrsr/rill/pull/248))

### Changed

- **`no-duplicate-error-id.cjs`'s own comments no longer cite internal requirement-tracking identifiers.** The comments now state the behavior directly.

### Fixed

- **`STD-CI-8` no longer misreads a quoted `uses:` pin as unpinned.** This repository never quotes a `uses:` value, but a consumer workflow spelling `uses: "org/action@sha"` had the trailing quote captured as part of the SHA, so the `@[0-9a-f]{40}$` match failed and every quoted pin read as unpinned. The extracted value is now stripped of a leading/trailing quote before the check runs. ([#245](https://github.com/rcrsr/rill/pull/245))
- **`STD-CI-8`'s missing-version-comment failure now names the offending `file:line:`.** `grep -h` drops the filename prefix whenever exactly one workflow file is passed, so a single-workflow repository saw a bare `line:` with no file. Switched to `grep -H`, which forces the prefix unconditionally. ([#245](https://github.com/rcrsr/rill/pull/245))
- **`--list` now prints every `ok` result, not just `bad` and `skip`.** `--list` promises "every element this script covers"; `ok()` previously stayed silent under `--list`, so a passing element was missing from its own catalogue. `ok()` now prints unconditionally, matching `bad()` and `skip()`. ([#245](https://github.com/rcrsr/rill/pull/245))
- **Workflow discovery now globs `.yml` and `.yaml`.** `WORKFLOWS` matched only `.github/workflows/*.yml`, so a repository spelling its workflow files `.yaml` had every `STD-CI-*` element in that section read the tree as holding no workflows at all. The glob now covers both extensions and prunes to files that actually exist. ([#245](https://github.com/rcrsr/rill/pull/245))

## 0.2.3 - 2026-08-27

Published from a tag pushed before the release PR merged, then superseded by
0.2.4. 0.2.4 ships identical tooling; prefer it. The changes are documented
under 0.2.4 above.

## 0.2.2 - 2026-08-26

### Changed

- **Baseline refreshed to the current shared-tooling pins:** `baseline.json` now records `knip ^6.32.2`, `oxfmt ^0.65.0`, `oxlint ^1.80.0`, and `vitest ^4.1.11`, matching rill's tree after a dev-dependency sweep. Consumers reading `@rcrsr/rill-dev/baseline.json` resolve `STD-DEP-1` and `STD-PM-2` against the same ranges rill pins today. No checker logic changed.

## 0.2.1 - 2026-08-08

### Changed

- **Baseline refreshed to the current shared-tooling pins:** `baseline.json` now records `@types/node ^26.2.0`, `knip ^6.32.0`, `oxfmt ^0.62.0`, and `oxlint ^1.77.0`, matching rill's tree after a dev-dependency sweep. Consumers reading `@rcrsr/rill-dev/baseline.json` resolve `STD-DEP-1` and `STD-PM-2` against the same ranges rill pins today; the published 0.2.0 baseline lagged them. No checker logic changed. ([#166](https://github.com/rcrsr/rill/pull/166))

## 0.2.0 - 2026-08-03

### Added

- **Cross-repository baseline (`baseline.json`):** Ships rill's canonical tooling pins as a published, versioned file so a consuming repository — which holds neither rill's root `package.json` nor `pnpm-workspace.yaml` — can check the elements that used to report unchecked against them. `STD-LINT-1`, `STD-LINT-5`, `STD-LINT-9`, `STD-PM-2`, `STD-DEP-1`, `STD-DEP-2`, and `STD-DEP-5` now resolve in consumers. Generated by `rill-gen-baseline` (`pnpm fix:baseline`), shipped in the tarball, and exported at `@rcrsr/rill-dev/baseline.json`. When the checker runs against rill's own tree it regenerates the baseline in memory and fails on a stale committed copy, so a pin bump that forgot `pnpm fix:baseline` is caught before it ships. ([#157](https://github.com/rcrsr/rill/pull/157))
- **`STD-PM-6`, `STD-SUP-2`, and `STD-PROC-7` decided from the tree:** `STD-PM-6` reads the pinned pnpm major to know which `allowBuilds` location is load-bearing; `STD-SUP-2` settles on `STD-REL-3`'s recorded result rather than skipping; `STD-PROC-7` confirms every `gh label create` in `sync-labels.sh` carries `--force`, joining line continuations and dropping comments before counting. ([#157](https://github.com/rcrsr/rill/pull/157))
- **`STD-DEP-3` decided from the tree:** Reads `pnpm.overrides` in `package.json` and the `overrides:` block in `pnpm-workspace.yaml`, and requires every override key to be scoped with pnpm's `>` nested-override syntax rather than a whole-workspace downgrade. No override anywhere is this element's own N/A: nothing conflicts with the pinned compiler major. Moves `STD-DEP-3` out of the blanket `skip "STD-DEP-1..5"` this release, alongside the baseline-derived siblings above. ([#157](https://github.com/rcrsr/rill/pull/157))
- **`STD-DEP-4` decided from the tree:** The element is a binary presence check — the test runner declared in every workspace package or in none, relying on root resolution — not "consistent wherever declared". The predicate checks binary presence across every package and names the outliers on a mixed result, and separately checks for version drift when every package declares it. ([#157](https://github.com/rcrsr/rill/pull/157))

rill's checked-element count rises from 56 to 66 across the elements above.

### Changed

- **`STD-LINT-3` reads the override glob, not just the rule's severity:** A small JSONC reader (`jsonc.cjs`) walks `overrides[]` and requires the entry that sets `rill/no-spec-id-reference` to `error` to list a `files` glob covering `src`. A rule enabled at `error` under a glob scoped elsewhere now reads as non-conformant, closing the known hole documented in 0.1.1. ([#157](https://github.com/rcrsr/rill/pull/157))
- **The summary line carries the checker's own version:** Two repositories on different `@rcrsr/rill-dev` versions produce different element counts against the same standard; stamping the version keeps a count difference from reading as a conformance gap when it is version skew. ([#157](https://github.com/rcrsr/rill/pull/157))

## 0.1.1 - 2026-08-02

### Fixed

- **`STD-LINT-3` is now checked, and no longer admits an N/A condition.** The checker had no predicate for it and reported it unchecked; the element's N/A condition — no private planning directory, so nothing to leak — cannot be decided from a checkout, because that directory is gitignored wherever it exists. A repository with nothing to leak now enables the rule, reports zero findings, and is conformant. Tree-only count goes from 55 to 56. **Before upgrading**, add `"rill/no-spec-id-reference": "error"` to the `src/` override in `.oxlintrc.json` — see [Wiring it up](README.md#wiring-it-up) — or `check:standards` fails on the first run after the bump. ([#154](https://github.com/rcrsr/rill/pull/154))
- **The README overstated what `--remote` cannot decide.** Every STD-GATE element does report unchecked under `GITHUB_TOKEN`, but STD-SET-2 and STD-SUP-6's host half resolve. Dropping `--remote` from CI moves those two to the maintainer run rather than costing nothing. ([#154](https://github.com/rcrsr/rill/pull/154))
- **The release workflow did not parse, so no `dev-v*` tag could publish.** A bash comment in the tag-resolution step spelled GitHub's expression delimiters literally; the templater scans the whole `run` block, does not know `#` comments, and rejected the file. No tag was pushed while it was broken. ([#154](https://github.com/rcrsr/rill/pull/154))

## 0.1.0 - 2026-08-01

### Added

- **Package debut:** The ecosystem's shared development assets ship as an installable package. They were previously a `dev/` directory copied into each repository by `dev/apply.sh` with a CI drift check. Consuming repositories now upgrade by version, so a shared-asset fix no longer requires a sweep across every repository. ([#152](https://github.com/rcrsr/rill/pull/152))
- **`rill-check-standards` binary:** Enforces `REPO-STANDARDS.md` mechanically, deciding 55 elements from the tree and 6 more from the GitHub API under `--remote`. Elements needing human judgement are reported as unchecked and counted separately, so a green run never reads as full conformance. It resolves the repository from the working directory, not from its own location. ([#152](https://github.com/rcrsr/rill/pull/152))
- **`rill-test-rules` binary:** Runs the lint rules' own unit tests, 41 assertions across both rules. ([#152](https://github.com/rcrsr/rill/pull/152))
- **`@rcrsr/rill-dev/lint-rules` export:** The custom oxlint rules `rill/no-duplicate-error-id` and `rill/no-spec-id-reference`, loaded through oxlint's `jsPlugins` field. Both are opt-in: loading the plugin registers them without enabling them. ([#152](https://github.com/rcrsr/rill/pull/152))
- **`REPO-STANDARDS.md`:** The conformance index itself, exported at `@rcrsr/rill-dev/REPO-STANDARDS.md`. It names no version numbers by design, so a dependency bump never makes it stale. ([#152](https://github.com/rcrsr/rill/pull/152))
- **Its own release track:** This package publishes from a `dev-vx.y.z` tag, separate from the language's `vx.y.z`, so revving the tooling never mints a language version. A `dev-v*` release is created with `--latest=false` to leave the "Latest release" badge on the language. The tag must equal the version in `packages/dev/package.json`, or the job fails before publishing. ([#152](https://github.com/rcrsr/rill/pull/152))
