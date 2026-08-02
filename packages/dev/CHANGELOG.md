# Changelog

All notable changes to `@rcrsr/rill-dev` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This package versions independently of `@rcrsr/rill`. It ships development
tooling, not language surface, so its version numbers carry no relationship to
the language version. Language changes are recorded in the
[root changelog](https://github.com/rcrsr/rill/blob/main/CHANGELOG.md).

## Unreleased

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
