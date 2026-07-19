# Contributing to rill

Thanks for your interest in rill. This guide covers setup, the change process, and the standards a pull request must meet before review.

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Security reports follow the [Security Policy](SECURITY.md) instead of the process below.

## Before you write code

**Open an issue first for anything non-trivial.** Bug fixes and typo corrections can go straight to a pull request. Everything else starts as an issue so the design gets settled before you invest in an implementation.

Use the templates under `.github/ISSUE_TEMPLATE/`. Pick the one that matches: bug, feature, chore, security, or idea.

For a feature that touches core, expect a design discussion in the issue. That discussion produces an agreed contract: where the code hooks in, what the public surface looks like, and how the work splits across pull requests. Wait for that agreement before writing the implementation.

**Follow the agreed design.** If you find a reason to depart from it while implementing, say so in the issue or the pull request description. An unflagged deviation costs a review cycle and sometimes a rewrite. A flagged one usually just updates the plan.

**Security work follows the [Security Policy](SECURITY.md).** rill executes machine-generated scripts, so sandbox scope, resolver access, host API surface, and resource exhaustion are first-class concerns rather than a subcategory of bugs.

Report a vulnerability in a published release privately through the [Security tab](https://github.com/rcrsr/rill/security/advisories/new), not as a public issue. Hardening work on unreleased code uses the Security issue template. The policy has the threat model and the scope boundaries.

## Setup

rill uses Node and pnpm. The required versions live in the root `package.json`, under `engines.node` and `packageManager`. Corepack reads the latter and installs the right pnpm for you, so do not install pnpm globally.

```bash
corepack enable
git clone https://github.com/rcrsr/rill.git
cd rill
pnpm install
pnpm -r run build
```

If `pnpm install` rejects your Node version, the `engines` field says what it wants.

`pnpm install` runs `lefthook install`, which registers the git hooks described below.

## Repository layout

| Package | NPM name | Purpose |
|---------|----------|---------|
| `packages/core` | `@rcrsr/rill` | Language runtime and parser |
| `packages/service` | `@rcrsr/rill-language-service` | Language service: outline, tokens, formatting, checker |
| `packages/fiddle` | private | Browser playground |
| `packages/web` | private | Documentation site |

Extensions, the agent framework, CLI tools, and the config library live in separate repositories under the same organization. See the README for links.

## Commands

Run from the repository root:

```bash
pnpm test              # All tests, all packages
pnpm check             # Full validation: build, test, examples, lint rules, lint
pnpm check:types       # Type validation only
pnpm check:lint        # Lint only
pnpm check:format      # Formatting check
pnpm check:deps        # Unused dependencies and exports
pnpm fix:lint          # Auto-fix lint
pnpm fix:format        # Auto-format
```

Scope to one package with `--filter`:

```bash
pnpm --filter @rcrsr/rill test
pnpm --filter @rcrsr/rill test -- tests/runtime
```

## The bar for a pull request

**`pnpm check` must pass locally before you request review.** This is the single most common reason a pull request stalls. Do not rely on CI to find a broken build for you.

Two failure modes worth calling out, because neither is obvious:

1. **`tsconfig.json` limits `include` to `src/**/*`.** Type errors in test files do not surface in `pnpm check:types`. Run the tests as well as the typechecker.
2. **A test file that fails to import reports as a file-level failure, not as failing tests.** A suite that never collects can read as "no failures" at a glance. Confirm your tests actually execute and that the count is what you expect.

Other expectations:

- **Wire the feature end to end.** Code that nothing calls is not a reviewable increment. If a change spans several pull requests, the first one still needs a working path through it, even if narrow.
- **Export new public API from `packages/core/src/index.ts`.** Consumers cannot reach deep paths like `runtime/core/policy/*.js`, and separate repositories in the ecosystem depend on the published surface.
- **Throw structured errors.** Register the error id in `src/error-registry.ts` and throw `RuntimeError`, or route through a halt builder. A bare `Error` carries no error id and no help URL, so hosts cannot distinguish it from an unrelated failure.
- **Let the formatter handle style.** `oxfmt` runs on commit. Do not hand-format, and do not fight it.

## Tests

### The language arbiter is locked

`packages/core/tests/language/` is the specification of what rill does. `scripts/check-test-lock.sh` records a checksum of every file there and runs on every commit and in CI.

Changing those tests requires regenerating the lock with `scripts/check-test-lock.sh --update`, which lands in the diff as an explicit line. That is deliberate. The lock is a tripwire, not access control: anyone can update it, but doing so is loud and must be justified in the pull request.

Change the arbiter only for a genuine language specification change. Never change it to make an implementation change pass.

The same script rejects `.skip`, `.todo`, and `.only` anywhere under `packages/core/tests/`. A skipped test turns red green without deleting anything, which a checksum alone cannot catch.

`packages/core/tests/runtime/` covers the runtime API and implementation. Normal test maintenance applies there.

### Write tests that could fail

A test that passes before your implementation exists is measuring something else. Before opening a pull request, check that each new test fails for the right reason when the change is reverted.

This matters most for tests of the happy path. "The allowed call succeeds" often passes against untouched default behaviour and demonstrates nothing.

### Test the adversarial case

For anything that gates, filters, validates, or enforces, cover the bypass rather than only the intended use:

- **Every input form reaches the same rule.** If a feature can be invoked through several syntaxes or code paths, test all of them. A path that skips enforcement is a bypass, not an edge case.
- **Identity does not depend on names the caller chooses.** Renaming a variable or a binding must not change which rules apply. Script authors control those names, and in generated scripts the author is untrusted.
- **Defaults fail closed.** Test what happens with no matching rule, no configuration, and unrecognised input. An unhandled shape must not silently pass through.
- **Privileged state resists tampering.** Extension code receives the runtime context. Test that it cannot reach in and disable the mechanism mid-run.
- **All return shapes are covered.** rill methods return streams, iterators, and container types, not only scalars. Handle them or reject them explicitly.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) with a package or area scope:

```
feat(core): add walkAst and nodeAtPosition AST traversal exports
fix(service): correct SPACING_CLOSURE detection
docs: surface rill-make and rill-cli as primary quickstart paths
build(lint): load import, vitest, and promise plugins
chore: release vX.Y.Z
```

Write the subject as a description of the change. State what the code does now, not how many files you touched.

`lefthook` runs formatting, lint with auto-fix, and the language lock before each commit. It runs typecheck and the full test suite before each push. Skip with `LEFTHOOK=0` only when you have a specific reason.

## Pull requests

1. Branch from `main`. Name it for the work, for example `fix/parser-recovery` or `docs/contributing-guide`.
2. Keep it scoped to one concern. A large feature splits into a sequence of pull requests, agreed in the issue.
3. Describe the change in terms of source files, exported APIs, and behaviour. Link the issue it implements.
4. Area labels apply automatically from the paths you touched, via `.github/labeler.yml`.
5. CI runs the full check across every Node version in the matrix in `.github/workflows/ci.yml`, plus unused-dependency, formatting, and language-lock jobs. All must pass.

Expect review comments to cite specific lines and to include the command or grep that verifies the claim. Reply in the same register. If you disagree with a finding, say why and show the evidence.

## Documentation

`docs/` is the source of truth. `packages/web/content/docs/` is generated, so never edit it directly. After changing `docs/`, run `pnpm sync-docs` from `packages/web/`.

Code fences in documentation are executed as tests. Use ` ```rill ` for code that should run, and ` ```text ` for syntax demonstrations and pseudo-code. `pnpm test:examples` runs them.

Adding a page means creating `docs/my-topic.md`, then registering it in `FILE_MAP` and `LINK_MAP` in `packages/web/scripts/sync-docs.sh`.

## Releases

Maintainers publish `@rcrsr/rill` and `@rcrsr/rill-language-service` by tagging a release commit on `main`. `packages/core` shares the root major.minor, and `packages/service` matches `packages/core` exactly. Run `pnpm fix:versions` to sync and `pnpm check:versions` to verify.

Contributors do not need to bump versions in a pull request.

## License

rill is MIT licensed. By contributing, you agree that your contributions are licensed under the same terms. See [LICENSE](LICENSE).
