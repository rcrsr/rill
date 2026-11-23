# Reference audit

*The plan and checklist for auditing every concept file before 0.24.0.*

[#670](https://github.com/rcrsr/rill/issues/670) tracks this audit, and 0.24.0 does not ship until
it closes. This file records the method, the order, and the state of every file. Update it in the
same PR as the work it records. `pnpm ref lint` and `pnpm ref check` do not treat this file as a
concept.

## Scope

- Every concept file under `reference/`, reviewed for omissions, inconsistencies, and correctness.
- Every built rule cited by a locked test in `packages/core/tests/language/`.
- The three unwritten chapters, `lexical`, `limits`, and `builtins`, written in full.
- Every row in [INCONSISTENCIES.md](INCONSISTENCIES.md) decided.

## Decisions

| Question | Decision |
|----------|----------|
| Do the unwritten chapters gate 0.24.0? | Yes, all three. |
| Where do citations go? | In the locked suite. A `rule(...)` citation on an existing test, or a new test for an untested rule, is an allowed lock change. One lock update per PR, with `bash scripts/check-test-lock.sh --update`. Never change an existing test's body to make a rule pass. |
| How does the work land? | One PR per slice in the Progress table, in that order. |

## Per-file checklist

A file is done when all four columns are ticked in the Files tables below.

1. **Correct.** Probe every rule against `packages/core/dist`, per [CLAUDE.md](CLAUDE.md) "Probing
   the runtime", edges included: empty input, wrong kind, extra and missing arguments, nesting,
   and `guard`. Verify each Catchable cell by running the source inside `guard`. A rule the runtime
   breaks is a defect: file it and list it under Findings. Never edit the rule to match.
2. **Consistent.** Compare each rule with its own examples and Notes, with the concepts it cites,
   and with every equivalent form elsewhere (the "Consistency over scope" rule in the root
   `CLAUDE.md`). Remove a fact stated by two owners from the one it does not belong to. Record
   an undecided disagreement in [INCONSISTENCIES.md](INCONSISTENCIES.md).
3. **Complete.** Add a rule for built behavior no rule states. The sweeps below seed this column.
   Probe before writing; never write a rule from `docs/` or a source comment.
4. **Cited.** Every built rule in the file has a citing locked test. First cite an existing test
   that already proves the rule. Write a new test only when none does. The file's `pnpm ref check`
   `uncited-rule` count is 0.

Each PR runs the four gates from [CLAUDE.md](CLAUDE.md), then `pnpm ref lock` and the test lock
update, then `pnpm check`.

## Sweeps

Mechanical checks run once in the first PR. Each finding goes to the Files row it belongs to, or to
an unwritten chapter's backlog.

| Sweep | Compares | Feeds |
|-------|----------|-------|
| Error ids | Every id in `packages/core/src/error-registry.ts` against every Errors table | Complete |
| Grammar | Every production in `docs/ref-grammar.ebnf` against every `grammar:` frontmatter list | Complete, `lexical` |
| Test files | Every file in `packages/core/tests/language/` against every `tests:` frontmatter list | Cited |
| Built-ins | Every built-in method and function the runtime registers against the reference | `builtins` |
| Limits | Every ceiling, depth limit, and timeout the runtime enforces against the reference | `limits` |
| Docs topics | Every behavior claim in `docs/llm/` against the reference | Complete |

## Writing a chapter

`lexical`, `limits`, and `builtins` follow "Adding a concept" in [CLAUDE.md](CLAUDE.md). Each
chapter PR:

1. Splits the chapter into concepts from its sweep backlog, and lists them in its Files table.
2. Probes every behavior, writes each concept per [FORMAT.md](FORMAT.md), and cites a locked test
   for every rule. A new concept is born cited.
3. Links the chapter from the README Chapters table and removes "(not yet written)".

`builtins` is the largest slice. It may land as several PRs, one per receiver kind, under the one
Progress row.

## Closing the audit

The last row in Progress:

- `pnpm ref check` reports 0 `uncited-rule`. `uncited-rule` becomes an error, so a new uncited rule
  fails CI.
- [INCONSISTENCIES.md](INCONSISTENCIES.md) has no rows.
- The README "Test citation is incomplete during the pilot" sentence and the matching line in
  [CLAUDE.md](CLAUDE.md) "Tests" are removed.
- `pnpm ref lint`, `pnpm ref check`, `pnpm ref check --issues`, `pnpm test:examples`, and `pnpm check`
  pass on `main`.

## Progress

One row per PR. Tick a row when its PR merges.

| # | Slice | Files | Rules | Uncited | PR |
|---|-------|-------|-------|---------|----|
| 1 | Setup and sweeps | | | | |
| 2 | `conventions` | 2 | 17 | 17 | |
| 3 | `lexical` (write) | 0 | 0 | 0 | |
| 4 | `program` | 2 | 17 | 17 | |
| 5 | `values` | 3 | 29 | 27 | |
| 6 | `types/constructors` | 8 | 149 | 61 | |
| 7 | `types/model` | 6 | 70 | 54 | |
| 8 | `types/scalars` | 7 | 123 | 113 | |
| 9 | `types/typing` | 8 | 121 | 68 | |
| 10 | `variables` | 3 | 24 | 24 | |
| 11 | `expressions` | 8 | 111 | 89 | |
| 12 | `callables` | 3 | 33 | 15 | |
| 13 | `control-flow` | 5 | 43 | 31 | |
| 14 | `collections` | 7 | 53 | 47 | |
| 15 | `errors` | 5 | 33 | 32 | |
| 16 | `limits` (write) | 0 | 0 | 0 | |
| 17 | `host-boundary` | 1 | 14 | 11 | |
| 18 | `builtins` (write) | 0 | 0 | 0 | |
| 19 | Decide the inconsistencies | | | | |
| 20 | Close the audit | | | | |

At the start, on `main` at 3e0f88f7: 68 files, 837 rules, 606 uncited.

## Files

Tick a column with `x` when the file meets that check. A file added by a PR gets a row.

### `conventions`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `conventions/halt.md` | 9 | 9 | | | | |
| `conventions/notation.md` | 8 | 8 | | | | |

### `program`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `program/annotation.md` | 10 | 10 | | | | |
| `program/statement.md` | 7 | 7 | | | | |

### `values`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `values/equality.md` | 15 | 13 | | | | |
| `values/vacancy.md` | 6 | 6 | | | | |
| `values/value.md` | 8 | 8 | | | | |

### `types/constructors`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `types/constructors/dict.md` | 17 | 10 | | | | |
| `types/constructors/fn.md` | 27 | 0 | | | | |
| `types/constructors/list.md` | 14 | 8 | | | | |
| `types/constructors/map.md` | 36 | 0 | | | | |
| `types/constructors/ordered.md` | 9 | 7 | | | | |
| `types/constructors/stream.md` | 12 | 9 | | | | |
| `types/constructors/tuple.md` | 16 | 10 | | | | |
| `types/constructors/union.md` | 18 | 17 | | | | |

### `types/model`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `types/model/any.md` | 6 | 6 | | | | |
| `types/model/introspection.md` | 22 | 15 | | | | |
| `types/model/structural-typing.md` | 21 | 14 | | | | |
| `types/model/type-form.md` | 5 | 3 | | | | |
| `types/model/type-position.md` | 6 | 6 | | | | |
| `types/model/type-value.md` | 10 | 10 | | | | |

### `types/scalars`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `types/scalars/atom.md` | 16 | 16 | | | | |
| `types/scalars/bool.md` | 13 | 13 | | | | |
| `types/scalars/datetime.md` | 19 | 19 | | | | |
| `types/scalars/duration.md` | 20 | 13 | | | | |
| `types/scalars/error-code.md` | 13 | 12 | | | | |
| `types/scalars/number.md` | 19 | 18 | | | | |
| `types/scalars/string.md` | 23 | 22 | | | | |

### `types/typing`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `types/typing/assertion.md` | 17 | 14 | | | | |
| `types/typing/carried-type.md` | 13 | 9 | | | | |
| `types/typing/conversion.md` | 20 | 19 | | | | |
| `types/typing/declaration.md` | 13 | 3 | | | | |
| `types/typing/defaults.md` | 19 | 11 | | | | |
| `types/typing/inference.md` | 15 | 8 | | | | |
| `types/typing/strict-mode.md` | 10 | 0 | | | | |
| `types/typing/type-lock.md` | 14 | 4 | | | | |

### `variables`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `variables/capture.md` | 6 | 6 | | | | |
| `variables/scope.md` | 10 | 10 | | | | |
| `variables/variable.md` | 8 | 8 | | | | |

### `expressions`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `expressions/destruct.md` | 12 | 12 | | | | |
| `expressions/dispatch.md` | 13 | 9 | | | | |
| `expressions/existence.md` | 11 | 7 | | | | |
| `expressions/interpolation.md` | 8 | 8 | | | | |
| `expressions/pipe.md` | 17 | 16 | | | | |
| `expressions/selection.md` | 28 | 15 | | | | |
| `expressions/slice.md` | 10 | 10 | | | | |
| `expressions/spread.md` | 12 | 12 | | | | |

### `callables`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `callables/annotation-access.md` | 7 | 6 | | | | |
| `callables/code-block.md` | 20 | 4 | | | | |
| `callables/invocation.md` | 6 | 5 | | | | |

### `control-flow`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `control-flow/break.md` | 7 | 7 | | | | |
| `control-flow/conditional.md` | 7 | 7 | | | | |
| `control-flow/construct-options.md` | 13 | 1 | | | | |
| `control-flow/loop.md` | 10 | 10 | | | | |
| `control-flow/pass.md` | 6 | 6 | | | | |

### `collections`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `collections/acc.md` | 2 | 2 | | | | |
| `collections/fan.md` | 7 | 7 | | | | |
| `collections/filter.md` | 5 | 4 | | | | |
| `collections/fold.md` | 6 | 5 | | | | |
| `collections/iteration.md` | 18 | 15 | | | | |
| `collections/seq.md` | 4 | 4 | | | | |
| `collections/sort.md` | 11 | 10 | | | | |

### `errors`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `errors/assert.md` | 5 | 5 | | | | |
| `errors/error.md` | 4 | 4 | | | | |
| `errors/guard.md` | 10 | 10 | | | | |
| `errors/invalid-value.md` | 9 | 8 | | | | |
| `errors/retry.md` | 5 | 5 | | | | |

### `host-boundary`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `host-boundary/use.md` | 14 | 11 | | | | |

### Unwritten chapters

Each gets a table when its PR splits it into concepts.

| Chapter | Covers |
|---------|--------|
| `lexical` | Source text, tokens, comments, literals |
| `limits` | Iteration, concurrency, call depth, timeouts |
| `builtins` | Built-in methods and functions |

## Findings

Defects filed and decisions made during the audit. An omission or inconsistency fixed in a PR needs
no row; the PR names it.

| File | Finding | Outcome |
|------|---------|---------|
