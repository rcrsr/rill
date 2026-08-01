# @rcrsr/rill-dev

Shared development assets for the rill ecosystem: the repository standards
checker and the custom oxlint rules. Every repository in the ecosystem derives
its lint and conformance setup from what is here.

| Asset | What it is |
|-------|------------|
| [`REPO-STANDARDS.md`](REPO-STANDARDS.md) | The conformance index. Every element carries a stable ID and a verification command. |
| [`lint-rules/`](lint-rules/) | Custom oxlint rules, loaded through oxlint's `jsPlugins` field. |
| [`check-standards.sh`](check-standards.sh) | Enforces the conformance index mechanically. Reports unchecked elements rather than passing them. |

## Why this is a package

It used to be a `dev/` directory copied into each repository by an `apply.sh`
script, with a CI drift check to keep the copies honest. That worked, but it
made every change to a shared asset a manual sweep across four repositories, and
it forced lockstep: a repository could not adopt a fix without taking every
other change alongside it.

As a dependency, each repository pins a version in its lockfile and upgrades on
its own schedule. Dependabot proposes the bump; nothing has to be copied,
synced, or checked for drift.

## Install

```bash
pnpm add -D @rcrsr/rill-dev
```

## Wiring it up

1. **Point `.oxlintrc.json` at the plugin.** Loading it only registers the
   rules; they are opt-in.

   ```json
   {
     "jsPlugins": ["@rcrsr/rill-dev/lint-rules"],
     "overrides": [
       {
         "files": ["packages/*/src/**/*.{ts,tsx}"],
         "rules": { "rill/no-spec-id-reference": "error" }
       }
     ]
   }
   ```

   `no-spec-id-reference` applies to every repository carrying internal planning
   documents. `no-duplicate-error-id` is keyed to `RuntimeError` construction, so
   in practice it applies to `rill` alone.

2. **Wire up the two binaries** in the root `package.json`, and call
   `check:standards` from the root `check` script:

   ```json
   {
     "scripts": {
       "check:standards": "rill-check-standards",
       "test:rules": "rill-test-rules"
     }
   }
   ```

Expect `check:standards` to fail on the first run. That is the point: it reports
which elements of `REPO-STANDARDS.md` the repository does not yet meet, by ID.
Pass `--remote` in CI to add the branch-protection and repository-settings
elements, which cannot be read from a checkout.

Read the summary line, not just the exit code. Elements the script cannot decide
are reported as `--` and counted separately; they still apply. A green run means
the checked subset holds, not that the repository is conformant.

## The checker resolves the repository from the working directory

`rill-check-standards` checks the repository containing the current directory,
found via `git rev-parse --show-toplevel`, never the directory the script itself
lives in. That matters here: the script sits in `node_modules`, so resolving
relative to its own path would check `node_modules/@rcrsr` instead of the
repository. It exits 2 rather than reporting on a directory holding no manifest.

## Changing an asset

`rill` is the only source. Edit here, publish, and consuming repositories pick
the change up on their next dependency bump.

`REPO-STANDARDS.md` names no version numbers, by design, so a dependency bump
never makes it stale. Adding an element to it is a change to what every
repository must satisfy; the bar for that is stated at the bottom of the file.

## License

MIT
