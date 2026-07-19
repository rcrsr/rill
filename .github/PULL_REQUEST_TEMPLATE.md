<!--
Keep the sections that carry weight for this change and delete the rest.
Summary and Verification are the two that always earn their place.

Prose beats bullet fragments here. Name files, symbols, and line numbers, and
show the command output you are claiming. A reviewer should be able to re-run
what you ran.
-->

## Summary

<!-- What the code does now, in a few sentences. Lead with the change, not the
file count. -->

## Why

<!-- The defect or gap this closes, and what a consumer gains. If an issue
already argues this, link it and keep this short. -->

## Approach

<!-- The judgement calls, not a file-by-file walkthrough. Cover anything a
reviewer would otherwise have to reconstruct: why this interception point, why
this data shape, what you rejected and what it cost.

If an issue settled a design, say where this follows it and where it departs.
An unflagged deviation costs a review cycle. -->

## Verification

<!-- Concrete commands and their real output. Numbers, not adjectives.

  pnpm check                        exits 0
  pnpm --filter @rcrsr/rill test    <N> passed

State what you did NOT verify as plainly as what you did. If a change has no
runtime surface to exercise, say so and say why. -->

## Risk

<!-- Behaviour that changes for existing consumers, new failure modes, anything
loud that used to be quiet. Delete if genuinely none. -->

## Follow-up

<!-- Work this deliberately leaves out, and why it is out of scope here. Delete
if none. -->

---

Closes #

<!--
Before requesting review:

- `pnpm check` passes locally. CI repeats it across the Node matrix, plus
  knip, formatting, and the language arbiter lock.
- Tests execute and the count is what you expect. A suite that fails to import
  reports as a file-level failure, not as failing tests, so a broken import can
  read as "no failures" at a glance.
- New tests fail when the change is reverted. A test that passes without your
  implementation is measuring something else.
- For anything that gates, filters, or validates: the adversarial cases are
  covered, not only the happy path. See CONTRIBUTING.md.
- New public API is exported from `packages/core/src/index.ts`. Sibling repos
  cannot reach deep paths.
- New errors are registered in `src/error-registry.ts` and thrown as
  `RuntimeError`, not bare `Error`.
- `packages/core/tests/language/` is unchanged, or the lock was regenerated
  deliberately and this PR says why.
- Version bumps are not needed. Maintainers handle releases.
-->
