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

- **Package debut:** The ecosystem's shared development assets ship as an installable package for the first time. Previously they were a `dev/` directory copied byte-identical into each repository by `dev/apply.sh`, held together by a CI drift check. Consuming repositories now add a devDependency and upgrade by version, so a shared-asset fix no longer requires a sweep across every repository and no repository is forced to take unrelated changes alongside the one it wants. ([#152](https://github.com/rcrsr/rill/pull/152))
- **`rill-check-standards` binary:** Enforces `REPO-STANDARDS.md` mechanically, deciding 55 elements from the repository and 6 more from the GitHub API under `--remote`. Elements needing human judgement are reported as unchecked and counted separately rather than passed silently, so a green run never reads as full conformance. It resolves the repository from the working directory via `git rev-parse --show-toplevel`, never from its own location, and exits 2 rather than reporting on a directory holding no manifest. ([#152](https://github.com/rcrsr/rill/pull/152))
- **`rill-test-rules` binary:** Runs the lint rules' own unit tests, 41 assertions across both rules. ([#152](https://github.com/rcrsr/rill/pull/152))
- **`@rcrsr/rill-dev/lint-rules` export:** The custom oxlint rules `rill/no-duplicate-error-id` and `rill/no-spec-id-reference`, loaded through oxlint's `jsPlugins` field and resolved through `node_modules`. Both are opt-in: loading the plugin registers them without enabling them. ([#152](https://github.com/rcrsr/rill/pull/152))
- **`REPO-STANDARDS.md`:** The conformance index itself, exported at `@rcrsr/rill-dev/REPO-STANDARDS.md`. It names no version numbers by design, so a dependency bump never makes it stale. ([#152](https://github.com/rcrsr/rill/pull/152))
