# Repository Standards

*The authoritative index of what a repository must satisfy to be conformant.*

This document defines the engineering baseline for every repository in the rill
ecosystem. It is the single source of truth.

**Every element is required.** A repository is conformant when it satisfies all
of them. There is no optional tier and no "recommended" grade to defer behind.

`rill` is the reference implementation. Where an element names a file, that file
exists in `rill` and is the copy source.

## Scope

Governs every repository that ships TypeScript to npm or supports a repository
that does: `rill`, `rill-agent`, `rill-cli`, `rill-config`, `rill-ext`.

Out of scope: Claude Code plugin marketplaces and other non-TypeScript
repositories. They have a different shape and need their own baseline.

## How to read this

Each element carries a stable ID and an **N/A only when** condition.

| Column | Meaning |
|---|---|
| ID | Stable identifier. Cite it when recording non-applicability. |
| Element | The requirement. Always required unless the N/A condition holds. |
| N/A only when | The **only** structural circumstance under which the element does not apply. `—` means it always applies, with no exception. |

An element marked N/A is not a deferral. It is an assertion that the element is
structurally meaningless for that repository, for example workspace globs in a
repository with no workspace. Record every N/A in that repository's `CLAUDE.md`,
naming the element ID and which stated condition it meets.

If an element is not satisfied and no N/A condition holds, the repository is
non-conformant. "Not yet" is non-conformant, tracked as work, not recorded as a
deviation.

Every element states how to verify it. No element names a version number. Tool
versions are pinned by §10 and read from `rill`'s manifests, so this document
does not go stale when a dependency is bumped.

## Checking conformance

`dev/check-standards.sh` enforces mechanically every element with a
deterministic answer readable from the repository. It is propagated by
`dev/apply.sh` alongside this document, so the same checker runs everywhere.

```bash
dev/check-standards.sh            # elements readable from the tree
dev/check-standards.sh --remote   # also §1 and §13, which live on the host
```

Wire it up as `check:standards` and call it from the root `check` script, so a
regression surfaces locally rather than at review.

**A green run is not a conformance claim.** The checker reports three states,
and the third is the important one:

| State | Meaning |
|---|---|
| `ok` | The element was checked and holds. |
| `FAIL` | The element was checked and does not hold. |
| `--` | The element was **not** checked. It still applies. |

Elements needing judgement, and every cross-repository comparison, land in the
third state. The script prints their count in the summary rather than omitting
them, because a checker that silently passes what it cannot decide is worse than
no checker: it converts an unknown into a false assurance. An unreachable API
degrades to `--` as well, never to `FAIL`.

Adding an element to this document does not automatically make it enforced. If
it can be decided from the tree, add it to the script in the same change.

---

## 1. Merge gates

| ID | Element | N/A only when |
|---|---|---|
| STD-GATE-1 | `main` is protected. Force pushes disabled, admins included. | — |
| STD-GATE-2 | Required status checks list **every** node-matrix leg of the CI check job, by exact context name. | — |
| STD-GATE-3 | A required context must be a job that actually runs the test suite. A path-filter or gating job must never be the required context. | — |
| STD-GATE-4 | `strict` is on, so branches must be current with `main` before merge. | — |
| STD-GATE-5 | Linear history enforced, and merge-commit / rebase-merge disabled in repository settings to match. | — |
| STD-GATE-6 | `delete_branch_on_merge` enabled. | — |

**Why STD-GATE-3 exists.** A CI job gated by an `if:` condition reports as
*skipped*, not *success*, so it can never be a required context. Making the
gating job required instead produces a green check that proves nothing.

Trigger-level `paths-ignore` is not the fix. It fails the same requirement from
the other side: the workflow never runs, the required context is never reported,
and the pull request blocks permanently. See STD-CI-7.

**STD-GATE-5 disables rebase-merge for a different reason than merge-commit.**
Merge-commit genuinely conflicts: the button offers a merge that the
linear-history rule then rejects, so the setting and the protection rule
disagree. Rebase-merge produces linear history and does not conflict. It is
disabled anyway, to leave exactly one merge path across the ecosystem, so a
repository's history shape is a property of the standard rather than of whichever
button someone reached for. Squash is that path. Read the element as one
decision with two causes, not as a claim that both strategies break linear
history.

These are host settings rather than files, so nothing in a checkout enforces
them and nothing in a diff reveals a change. Record the intent in `CLAUDE.md`
with the command that re-checks it. See also STD-SET-1, which requires the same
strategy across repositories.

**Verify**

```bash
gh api repos/<owner>/<repo>/branches/main/protection \
  --jq '.required_status_checks | {strict, contexts}'
```

## 2. CI workflow

| ID | Element | N/A only when |
|---|---|---|
| STD-CI-1 | `.github/workflows/ci.yml` triggers on push to `main` and on pull request. | — |
| STD-CI-2 | Node version matrix covers every supported major. The same matrix in every repository. | — |
| STD-CI-3 | Corepack is enabled **before** `actions/setup-node`, and `setup-node` sets `cache: 'pnpm'`. | — |
| STD-CI-4 | Install uses `--frozen-lockfile`. | — |
| STD-CI-5 | Every workflow declares a top-level `permissions:` block scoped to least privilege. | — |
| STD-CI-6 | Every workflow declares a `concurrency:` group. Cancellation is scoped, not blanket: see the note below for where cancelling is wrong. | — |
| STD-CI-7 | No path filtering of any kind on a workflow that supplies a required status check. Neither trigger-level `paths-ignore` nor job-level `if:` gating. See the note below. | — |
| STD-CI-8 | **Every** action pinned to a full commit SHA, with the release it belongs to in a trailing comment. Applies to first-party `actions/*` and `github/*` too. | — |
| STD-CI-9 | A scheduled compatibility workflow builds and tests against the latest published version of the ecosystem packages the repository consumes. | The repository consumes no ecosystem package, i.e. it is the upstream root. |

**Why STD-CI-7 forbids path filtering outright.** Both mechanisms deadlock
against required status checks, in opposite directions:

- **`paths-ignore`** stops the run from being created. The required context is
  never reported, so the PR sits at "Expected — waiting for status to be
  reported" and can never merge. A docs-only PR is unmergeable.
- **Job-level `if:`** does create the run, but the job reports *skipped*.
  Skipped is not success, so a required context is never satisfied.

The second failure is the one that produced the `changes`-as-required-context
workaround: requiring the filter job, which always passes, in place of the check
job. That leaves the branch nominally protected and actually ungated.

Neither is fixable by choosing the other. The conformant answer is to run the
full matrix on every pull request. If a repository genuinely cannot afford that,
the escape is a second workflow declaring a same-named job with the inverse
filter, so the context always reports — not a filter on the real one.

Note also that filtering `**/*.md` is unsafe wherever documentation carries
executable examples: it skips exactly the checks that validate them.

**Why STD-CI-6 does not say "cancel superseded runs".** Cancelling is right for
a pull-request run and wrong in two places:

- **On `main`.** A push to `main` must leave a completed status behind. Cancel
  it and the required contexts for that commit never report, which is the same
  deadlock STD-CI-7 describes arriving from a different direction. Gate on the
  ref: `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`.
- **On a release workflow.** A publish interrupted between two packages leaves
  the registry holding half a release, and the pre-publish existence check then
  reads the published half as already-done on the retry. Release workflows
  serialize on a fixed group with `cancel-in-progress: false`.

Include `github.workflow` in the group. A bare ref collides across workflows
that key on the same ref, so one workflow cancels another's run.

**Why STD-CI-8 is not limited to third-party actions.** A major tag is mutable
regardless of who owns it: `actions/checkout@v5` can be retargeted, and the next
run executes different code with no diff in the repository. First-party is a
statement about trust, not about immutability.

Two mechanics the pin depends on:

- **The trailing comment is load-bearing.** Dependabot reads it to know which
  release the SHA represents and to offer the next one. A bare SHA with no
  comment is pinned and unmaintainable. Update the comment whenever the SHA
  changes.
- **Annotated tags need dereferencing.** Some repositories publish their major
  as an annotated tag, so the ref API returns a tag object rather than a commit.
  The tag object SHA is not a valid `uses:` target; resolve through to the
  commit.

**Verify**

```bash
grep -L '^permissions:' .github/workflows/*.yml   # lists non-conformant files

# any path filter on a workflow supplying a required context is non-conformant
grep -n 'paths-ignore\|^\s*paths:' .github/workflows/ci.yml
```

## 3. Check coverage

The CI check job must exercise all of the following. A repository is
non-conformant if any is reachable only by running a script no workflow calls.

| ID | Element | N/A only when |
|---|---|---|
| STD-CHK-1 | Build | — |
| STD-CHK-2 | Tests | — |
| STD-CHK-3 | Lint | — |
| STD-CHK-4 | Format check | — |
| STD-CHK-5 | Typecheck **of every package**, including packages whose bundler does not typecheck | — |
| STD-CHK-6 | Unused dependency and export check | — |
| STD-CHK-7 | Version-consistency gate, run before publish | The repository publishes exactly one package and has no root-versus-package version split to reconcile. |

**Three traps this section exists to catch.**

*Root-script skip.* `pnpm -r run <script>` does **not** include the workspace
root. Any check defined only as a root script never runs under `-r`. Either
invoke it directly in a dedicated job or use `--include-workspace-root`.

*Bundler typecheck gap.* `tsc --build` typechecks; esbuild-based bundlers and
Vite do not. A package built by one of those needs an explicit `tsc --noEmit`
step. Confirm per package rather than assuming the build covers it.

*Typecheck scope gap.* A package can have a reachable `typecheck` script that
still reads none of its tests. `tsconfig.json` usually scopes `include` to
`src/**/*`, and `tsc --noEmit` honours it, so type errors in test files go
undetected even where STD-LINT-4 has lint covering the same directory. Check
what `include` actually resolves to rather than trusting the script's presence.
This is currently a known hole in `rill` rather than a satisfied element; it is
recorded here so it is not rediscovered, and closing it is tracked work.

**Verify**

```bash
# every package with a typecheck script must have it reachable from CI
grep -l '"typecheck"' packages/*/package.json packages/*/*/package.json
```

## 4. Script vocabulary

Script names are an interface. CI workflows, git hooks, and contributor muscle
memory all call them by name, so a repository that spells a task differently
cannot share a workflow template or a runbook.

| ID | Element | N/A only when |
|---|---|---|
| STD-SCRIPT-1 | The root package exposes the canonical vocabulary: `build`, `test`, `check`, `check:types`, `check:lint`, `check:format`, `check:deps`, `check:standards`, `fix:lint`, `fix:format`. | — |
| STD-SCRIPT-2 | Root `check` runs the complete check set. Where a check exists only as a root script, `check` must not delegate solely to a recursive run. | — |
| STD-SCRIPT-3 | `check:versions` and `fix:versions` present. | The same condition as STD-CHK-7. |
| STD-SCRIPT-4 | `prepare` installs the git hooks, so clone plus install wires them with no extra step. | — |
| STD-SCRIPT-5 | `bootstrap` present, idempotent, and identically named in every repository. It verifies toolchain preconditions and leaves the repository build-ready. | — |
| STD-SCRIPT-6 | No two script names invoke the same command. One name per task. | — |
| STD-SCRIPT-7 | Every workspace package exposes `build`, `typecheck`, `lint`, `check`, and `test` where the package has tests. | The repository is a single package, or the package ships no TypeScript. The second condition exempts only `typecheck`, `lint`, and `check`; `build` still applies. |
| STD-SCRIPT-8 | Canonical names carry only their canonical meaning and are never reused. Root aggregators use `<verb>:<target>` with verbs `build`, `test`, `check`, `fix`; packages use the bare atomic names in STD-SCRIPT-7. A task with no canonical verb may take a bare descriptive name. | — |

**Why STD-SCRIPT-2 is separate from §3.** §3 says which checks must run. This
says the aggregate entry point must actually reach them. A root `check` that
delegates only to a recursive run silently skips every root-level script, which
is the same trap §3 documents, arriving through the script layer instead of the
workflow layer.

**Root and package vocabularies differ, deliberately.** Root scripts aggregate,
so they need the `check:*` / `fix:*` namespace to say which dimension they
aggregate. Package scripts are atomic, so they take the bare verb: `typecheck`,
not `check:types`. A package exposing `check:types` or a root exposing bare
`typecheck` is non-conformant in either direction. STD-SCRIPT-1 fixes the root
set; STD-SCRIPT-7 fixes the package set.

**Why STD-SCRIPT-6 exists.** Two names for one command drift apart. One gets
updated, the other keeps working against stale behaviour, and CI and the hooks
end up invoking different things. Delete the alias rather than keeping both.

**Why it is `bootstrap` and not `setup`.** `pnpm setup` is a builtin that
configures the global binary directory. A script named `setup` is shadowed by
it, so `pnpm setup` would silently do something unrelated and only
`pnpm run setup` would reach the script. `bootstrap` is not a builtin, so
`pnpm bootstrap` resolves to the script with no ambiguity.

**Why it is not namespaced.** `dev` is a target, not a verb: it appears that way
in `build:dev`, and bare `dev` already means "run the dev server". A
`dev:`-prefixed name would contradict both readings. Bootstrapping is a
top-level action on the repository, the same shape as `build` and `check`, so it
takes a bare name.

**What `bootstrap` is for.** `prepare` already runs on install and covers hook
wiring, so `bootstrap` must not duplicate it. Its job is the part install cannot
do: assert the toolchain preconditions and fail loudly with the fix when they
are unmet, then leave the tree build-ready. It must be safe to run repeatedly,
and it must be the same command in every repository, because its whole value is
that a contributor never has to ask which repository needs what.

**How it stays identical across repositories.** Read the floors it enforces from
the root manifest's `engines` rather than hardcoding them. That is what lets the
copy be byte-identical everywhere and stops it going stale when a floor moves,
which is the difference between "the same command" and "the same file". Install
with a frozen lockfile so bootstrap never rewrites one, and run `build` where a
`build` script exists, because "build-ready" means usable rather than merely
installed: packages that consume each other's emitted declarations need it
before typecheck or tests will run at all. The reference implementation is
`dev/bootstrap.sh`, propagated by `dev/apply.sh`.

## 5. Lint configuration

| ID | Element | N/A only when |
|---|---|---|
| STD-LINT-1 | Shared linter and formatter across all repositories. No repository runs a different pair. | — |
| STD-LINT-2 | The `correctness` rule category is set to `error`. | — |
| STD-LINT-3 | The custom rule plugin is loaded, and the rule banning internal workflow-artifact identifiers in shipped source is enabled for `src/`. | The repository has no private planning directory and therefore no identifiers to leak. |
| STD-LINT-4 | Lint scope covers `src/` **and** `tests/`. | — |
| STD-LINT-5 | The same plugin set as `rill`. A plugin reporting zero findings is enabled, not omitted. | — |
| STD-LINT-6 | Every disabled rule carries a comment stating why, with a measured finding count. A rule category evaluated and declined is recorded the same way, per rule. | — |
| STD-LINT-7 | Config files declare `$schema`. | — |
| STD-LINT-9 | Rules shared with the reference config carry the same severity. A rule set to `warn` in one repository and `error` in another is non-conformant. | — |
| STD-LINT-8 | Plugin enablement is explicit. Naming a `plugins` array replaces the tool's defaults, so a default-on plugin is silently disabled unless relisted. | — |

**Why STD-LINT-3 matters.** Internal planning identifiers are unresolvable for
anyone reading the published package, including future maintainers and external
contributors. Any repository with a private planning directory can leak them
into shipped source. Keep the fact a comment states and drop the reference.

**Measure STD-LINT-5 and STD-LINT-6 only after STD-LINT-4 holds.** A plugin or
category measured while `tests/` sits outside the lint scope reads artificially
clean, and the decision recorded from that measurement is wrong for a reason
nothing in the config reveals. Close STD-LINT-4 first, then measure.

**On STD-LINT-8.** The failure is silent in both directions. Naming a `plugins`
array replaces the tool's defaults, so a default-on plugin is off with no
warning and no finding to notice. Enabling it later may still report nothing,
because most of its rules sit in categories the config does not enable, which
means a zero count is not evidence that listing it was pointless. List every
plugin the repository wants, including the ones reporting zero.

**Verify**

```bash
<linter> --config <config> src/ tests/     # must exit 0
```

## 6. Git hooks

| ID | Element | N/A only when |
|---|---|---|
| STD-HOOK-1 | A hook manager is installed via a `prepare` script. | — |
| STD-HOOK-2 | Pre-commit formats then lints staged files, in that order, and restages fixes. | — |
| STD-HOOK-3 | Pre-commit runs piped so a failing step halts the rest. | — |
| STD-HOOK-4 | Pre-push runs typecheck and tests in parallel. | — |

Format before lint. The reverse order lets the formatter undo a lint fix.

## 7. Release workflow

Every element in this section is N/A when the repository publishes nothing to a
registry. Record that once against the section rather than element by element.

| ID | Element | N/A only when |
|---|---|---|
| STD-REL-1 | Triggered by a version tag push. | Repository publishes nothing. |
| STD-REL-2 | Verifies version consistency before publishing anything. | Repository publishes nothing. |
| STD-REL-3 | Publishes with provenance, so each published version is cryptographically bound to its source commit and build. | Repository publishes nothing. |
| STD-REL-4 | Grants `id-token: write`, which provenance requires. | Repository publishes nothing. |
| STD-REL-5 | Publish is idempotent: skips versions already on the registry, and tolerates a registry-side conflict rather than failing the job. | Repository publishes nothing. |
| STD-REL-6 | Publish scripts set `set -o pipefail` when piping publish output. | Repository publishes nothing. |
| STD-REL-7 | Creates a GitHub Release, skipping if one already exists. | Repository publishes nothing. |

**On STD-REL-5.** A pre-publish existence check alone races against a
concurrent publish. Handle the registry's conflict response as success, not
failure.

**STD-REL-5 and STD-REL-6 must land together, in that pairing.** Reading the
registry's response means capturing the publish output, which means a pipe, and
a pipe without `pipefail` reports the exit status of the last command in it
rather than the publish. A repository that has STD-REL-5 and not STD-REL-6 is in
a worse state than one with neither: a failed publish reports success, and the
job goes on to cut a release for a package that never shipped. This is not
hypothetical. Verify it by running the publish step against a stubbed package
manager that exits non-zero; without `pipefail` the step prints its success
message and exits 0.

That is also why STD-REL-6's "when piping" is not a real escape. Satisfying
STD-REL-5 introduces the pipe, so STD-REL-6 is active in every conformant
repository.

**On STD-REL-3.** Provenance requires a package manager version that supports it
and a CI provider it can detect. Confirm support in the pinned package manager
before relying on the flag; some majors accept it and silently ignore it. A
package manager's `publish --help` may not advertise the flag even where it
works, so read the bundled publish library rather than the help text.

Provenance also requires each published package to declare `repository` in its
manifest, with `directory` set in a monorepo. Without it the attestation has no
source to bind to and the publish fails at the point of no return, after the
version gate has passed.

## 8. Package manager

| ID | Element | N/A only when |
|---|---|---|
| STD-PM-1 | `packageManager` pinned with its integrity hash. Set it with the corepack `use` command, never by hand. | — |
| STD-PM-2 | The **same** package manager major and version string in every repository. | — |
| STD-PM-3 | `engines.node` declares the minimum supported Node version, identically across repositories. | — |
| STD-PM-4 | `engines` also constrains the package manager major, so a local install under the wrong major fails loudly. | — |
| STD-PM-5 | `.nvmrc` and `.node-version` present and in agreement. | — |
| STD-PM-6 | Build-script allowlist declared in the location the pinned major expects. This location moved between majors; confirm against the pinned version. | No dependency requires a build script. |
| STD-PM-7 | Workspace globs all match at least one directory. | The repository is a single package with no workspace file. |

**Why STD-PM-2 is not cosmetic.** Package manager majors differ in which
settings files they read and which publish features they support. Version skew
across repositories means the same config produces different behaviour, and a
feature available in one repository is silently inert in another.

**Verify**

```bash
node -p "require('./package.json').packageManager"
```

## 9. Supply chain

| ID | Element | N/A only when |
|---|---|---|
| STD-SUP-1 | `.github/dependabot.yml` present, covering the package ecosystem and GitHub Actions. | — |
| STD-SUP-2 | Published packages carry provenance. See STD-REL-3. | Repository publishes nothing. |
| STD-SUP-3 | A minimum release age is set **explicitly**, so freshly published dependency versions are not installed inside the cooling-off window. Inheriting a package-manager default does not satisfy this. | — |
| STD-SUP-4 | Any exclusion from that window is expressed so it does not need a hand edit every release. | The repository declares no exclusions. |
| STD-SUP-5 | Dependency trust evidence is verified on install, failing when a dependency's trust level is downgraded. | — |
| STD-SUP-6 | Static analysis workflow and dependency review enabled, **and the host features they depend on turned on**. A committed workflow file is not sufficient. | — |
| STD-SUP-7 | `CODEOWNERS` present, paired with required review on high-blast-radius paths such as workflow files. | — |

**On STD-SUP-3 and STD-SUP-4.** A minimum-release-age exclusion pinned to an
exact version silently stops applying at the next release. Express exclusions by
name where the tooling allows it.

**Why STD-SUP-3 says explicitly.** This setting's default moved between package
manager majors: off in one, a full day in the next. A repository relying on the
default therefore enforces a different policy depending on which major it pins,
which is the STD-PM-2 failure mode reaching the supply chain. An explicit value
makes the policy the same everywhere and survives the next default change. Match
the value to the dependency-update cadence in STD-SUP-1; a window longer than
that interval defers every bump by a full extra cycle without covering a
materially different threat.

**Why STD-SUP-6 names the host feature.** Dependency review needs the
repository's dependency graph enabled. That is a host setting, not something the
workflow file can turn on, and it is off on some repositories even when public.
Commit the workflow without it and the job runs on every pull request and fails
every time with "Dependency review is not supported on this repository", which
is a permanently red check that proves nothing about the dependencies.

The failure mode this catches is broader than one feature: an element satisfied
by a file in the tree can still be unsatisfied in effect. Verify the workflow
can actually do its job, not merely that it exists.

```bash
gh api repos/<owner>/<repo>/dependency-graph/sbom --jq '.sbom.name'
```

**A setting can silently disable both STD-SUP-3 and STD-SUP-5.** Package
managers offer a switch that treats an existing lockfile as already trusted and
skips re-applying these policies to its entries. It reads like a caching
optimisation and it turns both elements off. Leave it at its default, and check
its value rather than assuming, because a repository can satisfy both elements
on paper while verifying nothing on install.

## 10. Dependency versions

| ID | Element | N/A only when |
|---|---|---|
| STD-DEP-1 | Shared build and test tooling pinned to the same range in every repository. | — |
| STD-DEP-2 | One compiler major across the ecosystem. A repository consuming another's emitted declarations must not read them with an older compiler major. | — |
| STD-DEP-3 | A tool incompatible with the current compiler major is handled by a **scoped nested override**, never by downgrading the whole workspace. | No tool conflicts with the current compiler major. |
| STD-DEP-4 | Test runner declared consistently: either in every package or in none, relying on root resolution. | The repository is a single package. |
| STD-DEP-5 | Cross-repository peer ranges track the current published version. | The repository has no cross-repository peer dependency. |

This document deliberately names no versions. The canonical pins are `rill`'s
root `package.json` and `pnpm-workspace.yaml`. Dependabot (STD-SUP-1) keeps them
current; this section defines only that they agree.

## 11. Issue and PR process

| ID | Element | N/A only when |
|---|---|---|
| STD-PROC-1 | An `area:*` label taxonomy reflecting the repository's own structure. Stock GitHub labels alone are non-conformant. | — |
| STD-PROC-2 | `.github/labeler.yml` mapping paths to `area:*` labels, doubling as the taxonomy reference. | — |
| STD-PROC-3 | A PR workflow applying area labels from changed paths, additive only, gated to same-repository PRs. | — |
| STD-PROC-4 | An issue taxonomy workflow flagging under-labelled issues. It must read issue state **fresh at execution time**, never from the webhook payload. | Issues are disabled on the repository. |
| STD-PROC-5 | `.github/ISSUE_TEMPLATE/` forms plus `config.yml`. | Issues are disabled on the repository. |
| STD-PROC-6 | `.github/PULL_REQUEST_TEMPLATE.md`. | — |
| STD-PROC-7 | An idempotent label-sync script so the taxonomy is reproducible. | — |

**Why STD-PROC-4 specifies a fresh read.** Webhook payloads are a snapshot from
when the event fired. A single issue-creation command emits several events
within seconds, so a run can act on a payload that predates part of the
taxonomy, flag a conforming issue, and leave the flag stuck. Read current state
at execution time and the last run to execute always converges correctly.

## 12. Community health files

| ID | Element | N/A only when |
|---|---|---|
| STD-DOC-1 | `SECURITY.md`. Any public repository publishing to a registry needs a disclosure channel. | — |
| STD-DOC-2 | `README.md`, `LICENSE`, `CHANGELOG.md`. | — |
| STD-DOC-3 | `CLAUDE.md` recording repository-specific rules and every recorded N/A. | — |
| STD-DOC-4 | `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`. | — |
| STD-DOC-5 | `.gitignore` a superset of the shared baseline. | — |

## 13. Repository settings

| ID | Element | N/A only when |
|---|---|---|
| STD-SET-1 | Merge strategy identical across repositories. | — |
| STD-SET-2 | Wiki disabled unless actually used. | — |
| STD-SET-3 | Issues enabled. | The repository is a downstream mirror that files issues elsewhere. |

**Verify**

```bash
gh api repos/<owner>/<repo> \
  --jq '{squash: .allow_squash_merge, merge: .allow_merge_commit,
         rebase: .allow_rebase_merge, wiki: .has_wiki,
         delete_branch: .delete_branch_on_merge}'
```

---

## Conformance summary

| Section | Elements | Can ever be N/A |
|---|---|---|
| 1 Merge gates | 6 | 0 |
| 2 CI workflow | 9 | 1 |
| 3 Check coverage | 7 | 1 |
| 4 Script vocabulary | 8 | 2 |
| 5 Lint configuration | 9 | 1 |
| 6 Git hooks | 4 | 0 |
| 7 Release workflow | 7 | 7 |
| 8 Package manager | 7 | 2 |
| 9 Supply chain | 7 | 2 |
| 10 Dependency versions | 5 | 3 |
| 11 Issue and PR process | 7 | 2 |
| 12 Community health | 5 | 0 |
| 13 Repository settings | 3 | 1 |
| **Total** | **84** | **22** |

62 of 84 elements admit no exception at all. Of the 22 that can be N/A, 7 are
the entire release section, which collapses to a single assertion for a
repository that publishes nothing.

## Referencing this document

Other repositories hold a copy of this file, placed there by `dev/apply.sh`,
and should link here rather than restating the rules:

```
https://github.com/rcrsr/rill/blob/main/dev/REPO-STANDARDS.md
```

Record every N/A in the repository's own `CLAUDE.md`, naming the element ID and
the stated condition it meets. An N/A claimed without a matching condition is a
defect, not a decision.

## Changing this document

Elements are added when a class of defect is found in more than one repository,
or when a single defect was severe enough that recurrence is unacceptable. State
the failure mode an element prevents, not just the rule. Every element here
traces to an observed problem.

Adding an N/A condition is a change to the standard and needs the same bar. Do
not widen a condition to accommodate a repository that has simply not done the
work yet.
