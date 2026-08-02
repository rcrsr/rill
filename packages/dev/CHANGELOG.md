# Changelog

All notable changes to `@rcrsr/rill-dev` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This package versions independently of `@rcrsr/rill`. It ships development
tooling, not language surface, so its version numbers carry no relationship to
the language version. Language changes are recorded in the
[root changelog](https://github.com/rcrsr/rill/blob/main/CHANGELOG.md).

## Unreleased

### Fixed

- **`STD-LINT-3` is now checked instead of skipped.** The element requires the custom rule plugin loaded and `rill/no-spec-id-reference` enabled for `src/`; the checker had no predicate for it and reported it unchecked, citing a dependency on a private planning directory. The cost was invisible: enabling the rule in a consuming repository cleared 708 references across 86 files and the checker's summary line was byte-identical before and after — the largest conformance change in that repository's adoption pass moved nothing. The predicate is two greps against the lint config the script already reads for three neighbouring elements, and takes the tree-only count from 55 to 56. Before upgrading, add `"rill/no-spec-id-reference": "error"` to the `src/` override in `.oxlintrc.json` — see [Wiring it up](README.md#wiring-it-up). A repository that has not enabled it fails `check:standards` on the first run after the bump, with no source change of its own. ([#154](https://github.com/rcrsr/rill/pull/154))
- **`STD-LINT-3` no longer admits an N/A condition.** It previously allowed one — no private planning directory, so nothing to leak — and that condition cannot be decided from a checkout. The directory is gitignored wherever it exists, which is its purpose, so a probe answers *applicable* on a contributor's machine and *N/A* in CI for the same commit with nothing to distinguish the two runs. Requiring the rule unconditionally costs a repository with nothing to leak exactly nothing: it reports zero findings and is conformant, which is the rule STD-LINT-5 already states one row down. A known limitation is recorded with the element: the greps confirm the rule is set to `error` but not that the override's glob covers `src/`, because these configs carry comments and so are not `JSON.parse`-able. ([#154](https://github.com/rcrsr/rill/pull/154))

## 0.1.0 - 2026-08-01

### Added

- **Package debut:** The ecosystem's shared development assets ship as an installable package for the first time. Previously they were a `dev/` directory copied byte-identical into each repository by `dev/apply.sh`, held together by a CI drift check. Consuming repositories now add a devDependency and upgrade by version, so a shared-asset fix no longer requires a sweep across every repository and no repository is forced to take unrelated changes alongside the one it wants. ([#152](https://github.com/rcrsr/rill/pull/152))
- **`rill-check-standards` binary:** Enforces `REPO-STANDARDS.md` mechanically, deciding 55 elements from the repository and 6 more from the GitHub API under `--remote`. Elements needing human judgement are reported as unchecked and counted separately rather than passed silently, so a green run never reads as full conformance. It resolves the repository from the working directory via `git rev-parse --show-toplevel`, never from its own location, and exits 2 rather than reporting on a directory holding no manifest. ([#152](https://github.com/rcrsr/rill/pull/152))
- **`rill-test-rules` binary:** Runs the lint rules' own unit tests, 41 assertions across both rules. ([#152](https://github.com/rcrsr/rill/pull/152))
- **`@rcrsr/rill-dev/lint-rules` export:** The custom oxlint rules `rill/no-duplicate-error-id` and `rill/no-spec-id-reference`, loaded through oxlint's `jsPlugins` field and resolved through `node_modules`. Both are opt-in: loading the plugin registers them without enabling them. ([#152](https://github.com/rcrsr/rill/pull/152))
- **`REPO-STANDARDS.md`:** The conformance index itself, exported at `@rcrsr/rill-dev/REPO-STANDARDS.md`. It names no version numbers by design, so a dependency bump never makes it stale. ([#152](https://github.com/rcrsr/rill/pull/152))
- **Its own release track:** This package publishes from a `dev-vx.y.z` tag, separate from the language's `vx.y.z`. A shared namespace would have forced a language version carrying no language change every time the tooling was revved, and that release would have taken the repository's "Latest release" badge — so a `dev-v*` release is created with `--latest=false`, and its notes link this file rather than generating notes across the intervening language commits. The tag must equal the version in `packages/dev/package.json`, or the job fails before publishing. ([#152](https://github.com/rcrsr/rill/pull/152))
