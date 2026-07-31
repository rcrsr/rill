# dev

Shared development assets for the rill ecosystem. Every repository derives its
CI, lint, and process setup from what is here.

| Asset | What it is |
|-------|------------|
| [`REPO-STANDARDS.md`](REPO-STANDARDS.md) | The conformance index. 84 elements, each with a stable ID and a verification command. |
| [`lint-rules/`](lint-rules/) | Custom oxlint rules, loaded through oxlint's `jsPlugins` field. |
| [`bootstrap.sh`](bootstrap.sh) | Brings a fresh clone to build-ready, failing with the fix when the toolchain cannot support it. |
| [`check-standards.sh`](check-standards.sh) | Enforces the conformance index mechanically. Reports unchecked elements rather than passing them. |
| `apply.sh` | Copies the above into a target repository, and checks a copy for drift. |

## Nothing here is published

These assets are not an npm package and are not installable. A repository holds
a plain copy, and `apply.sh` is how that copy is made and kept honest.

That is a deliberate choice. Publishing internal lint rules to a public registry
adds a release cycle, a version to track, and a name to defend, all to move four
files between repositories that share one maintainer. Copying is the smaller
mechanism, and a drift check in CI removes the only real objection to it.

## Applying to a repository

From a `rill` checkout:

```bash
dev/apply.sh ../rill-ext          # copy in, overwriting existing copies
dev/apply.sh --check ../rill-ext  # report drift, change nothing
```

`--check` exits 1 when the target has diverged, so it works directly as a CI
step. It compares by checksum, not timestamp, and reports files the target has
that the source has dropped.

After the first copy, in the target repository:

1. Point `.oxlintrc.json` at the plugin. The path is relative to the config, and
   no dependency is added:

   ```json
   { "jsPlugins": ["./dev/lint-rules/index.js"] }
   ```

2. Enable the rules that apply. They are opt-in; loading the plugin only
   registers them:

   ```json
   {
     "overrides": [
       {
         "files": ["packages/*/src/**/*.{ts,tsx}"],
         "rules": { "rill/no-spec-id-reference": "error" }
       }
     ]
   }
   ```

   `no-spec-id-reference` applies to every repository with a `conduct/`
   directory. `no-duplicate-error-id` is keyed to `RuntimeError` construction,
   so in practice it applies to `rill` alone.

3. Wire up `bootstrap.sh` in the root `package.json`. The command is identical
   in every repository, which is the point: a contributor never has to ask which
   repository needs what.

   ```json
   { "scripts": { "bootstrap": "bash dev/bootstrap.sh" } }
   ```

   It reads `engines.node` and `engines.pnpm` from the root manifest rather than
   hardcoding versions, so the copy stays byte-identical across repositories and
   does not go stale when a floor moves. It installs with `--frozen-lockfile`
   and runs `build` if one is defined. It never installs git hooks: `prepare`
   already does that on install.

4. Wire up `check-standards.sh` and call it from the root `check` script:

   ```json
   { "scripts": { "check:standards": "bash dev/check-standards.sh" } }
   ```

   Expect failures on the first run. That is the point: it reports which
   elements of `REPO-STANDARDS.md` the repository does not yet meet, by ID. Pass
   `--remote` in CI to add the branch-protection and repository-settings
   elements, which cannot be read from a checkout.

   Read the summary line, not just the exit code. Elements the script cannot
   decide are reported as `--` and counted separately; they still apply.

5. Add the drift check to CI, so a stale copy fails a build instead of rotting
   quietly. It needs a `rill` checkout alongside:

   ```yaml
   - name: Check dev assets are current
     run: |
       git clone --depth 1 https://github.com/rcrsr/rill ../rill-upstream
       ../rill-upstream/dev/apply.sh --check .
   ```

## Changing an asset

Edit it here, then re-apply to each repository that holds a copy. `rill` is the
only source; editing a copy in place is what the drift check exists to catch.

`REPO-STANDARDS.md` names no version numbers, by design, so a dependency bump
never makes it stale. Adding an element to it is a change to what every
repository must satisfy; the bar for that is stated at the bottom of the file.
