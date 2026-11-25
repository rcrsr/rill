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
| Who decides findings during chapter slices? | Nobody. A chapter slice captures each disputed or under-specified case in [INCONSISTENCIES.md](INCONSISTENCIES.md) and keeps working; a new rule states only behavior consistent with every equivalent form. Slice 20 decides every row. |
| When are defects filed? | After the last chapter slice. Each slice adds its defects to [Findings](#findings) as `Collected`, with the probe evidence. Slice 19 groups them by root cause and files one issue per group. A defect that blocks a slice is filed at once. |

## Per-file checklist

A file is done when all four columns are ticked in the Files tables below.

1. **Correct.** Probe every rule against `packages/core/dist`, per [CLAUDE.md](CLAUDE.md) "Probing
   the runtime", edges included: empty input, wrong kind, extra and missing arguments, nesting,
   and `guard`. Verify each Catchable cell by running the source inside `guard`. A rule the runtime
   breaks is a defect: add it to Findings as `Collected`. Never edit the rule to match.
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

| Sweep | Compares | Feeds | Result at a897cfc3 |
|-------|----------|-------|--------------------|
| Error ids | Every id in `packages/core/src/error-registry.ts` against every Errors table | Complete | 121 ids, 79 in no concept file |
| Grammar | Every production in `docs/ref-grammar.ebnf` against every `grammar:` frontmatter list | Complete, `lexical` | 118 productions, 77 in no list |
| Test files | Every file in `packages/core/tests/language/` against every `tests:` frontmatter list | Cited | 126 files, 25 in no list |
| Built-ins | Every built-in method and function the runtime registers against the reference | `builtins` | 151 built-ins, 92 with no rule, 12 partial |
| Limits | Every ceiling, depth limit, and timeout the runtime enforces against the reference | `limits` | 29 limits, 15 unstated, 3 partial |
| Docs topics | Every behavior claim in `docs/llm/` against the reference | Complete | 52 claims no rule states, outside `builtins`; 8 conflicts |

Every result is routed to a chapter under [Backlog](#backlog). Conflicts where the runtime may be
right went to [INCONSISTENCIES.md](INCONSISTENCIES.md). Defects and wrong docs are under
[Findings](#findings).

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
- [INCONSISTENCIES.md](INCONSISTENCIES.md) has no rows, and no Findings row is `Collected`.
- The README "Test citation is incomplete during the pilot" sentence and the matching line in
  [CLAUDE.md](CLAUDE.md) "Tests" are removed.
- `pnpm ref lint`, `pnpm ref check`, `pnpm ref check --issues`, `pnpm test:examples`, and `pnpm check`
  pass on `main`.

## Progress

One row per PR. Tick a row when its PR merges.

| # | Slice | Files | Rules | Uncited | PR |
|---|-------|-------|-------|---------|----|
| 1 | Setup and sweeps | 68 | 837 | 606 | #676 |
| 2 | `conventions` | 2 | 15 | 1 | #676 |
| 3 | `lexical` (write) | 5 | 23 | 0 | #676 |
| 4 | `program` | 3 | 32 | 0 | #676 |
| 5 | `values` | 3 | 30 | 0 | #676 |
| 6 | `types/constructors` | 9 | 160 | 0 | #676 |
| 7 | `types/model` | 6 | 69 | 0 | #676 |
| 8 | `types/scalars` | 7 | 124 | 0 | #676 |
| 9 | `types/typing` | 8 | 122 | 0 | #676 |
| 10 | `variables` | 3 | 27 | 0 | #676 |
| 11 | `expressions` | 13 | 137 | 2 | #676 |
| 12 | `callables` | 3 | 37 | 0 | #676 |
| 13 | `control-flow` | 5 | 52 | 4 | #676 |
| 14 | `collections` | 7 | 56 | 0 | #676 |
| 15 | `errors` | 5 | 41 | 0 | #676 |
| 16 | `limits` (write) | 5 | 14 | 0 | #676 |
| 17 | `host-boundary` | 1 | 16 | 3 | #676 |
| 18 | `builtins` (write) | 111 | 204 | 0 | #676 |
| 19 | Group and file defects | | | | |
| 20 | Decide the inconsistencies | | | | |
| 21 | Close the audit | | | | |

At the start, on `main` at 3e0f88f7: 68 files, 837 rules, 606 uncited.

## Files

Tick a column with `x` when the file meets that check. A file added by a PR gets a row.

### `conventions`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `conventions/halt.md` | 9 | 1 | x | x | x | |
| `conventions/notation.md` | 6 | 0 | x | x | x | x |

### `lexical`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `lexical/identifier.md` | 3 | 0 | x | x | x | x |
| `lexical/keyword.md` | 4 | 0 | x | x | x | x |
| `lexical/source-text.md` | 5 | 0 | x | x | x | x |
| `lexical/token.md` | 4 | 0 | x | x | x | x |
| `lexical/whitespace.md` | 7 | 0 | x | x | x | x |

### `program`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `program/annotation.md` | 14 | 0 | x | x | x | x |
| `program/frontmatter.md` | 6 | 0 | x | x | x | x |
| `program/statement.md` | 12 | 0 | x | x | x | x |

### `values`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `values/equality.md` | 16 | 0 | x | x | x | x |
| `values/vacancy.md` | 6 | 0 | x | x | x | x |
| `values/value.md` | 8 | 0 | x | x | x | x |

### `types/constructors`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `types/constructors/dict.md` | 18 | 0 | x | x | x | x |
| `types/constructors/dict-literal.md` | 2 | 0 | x | x | x | x |
| `types/constructors/fn.md` | 30 | 0 | x | x | x | x |
| `types/constructors/list.md` | 15 | 0 | x | x | x | x |
| `types/constructors/map.md` | 37 | 0 | x | x | x | x |
| `types/constructors/ordered.md` | 10 | 0 | x | x | x | x |
| `types/constructors/stream.md` | 13 | 0 | x | x | x | x |
| `types/constructors/tuple.md` | 17 | 0 | x | x | x | x |
| `types/constructors/union.md` | 18 | 0 | x | x | x | x |

### `types/model`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `types/model/any.md` | 6 | 0 | x | x | x | x |
| `types/model/introspection.md` | 23 | 0 | x | x | x | x |
| `types/model/structural-typing.md` | 19 | 0 | x | x | x | x |
| `types/model/type-form.md` | 5 | 0 | x | x | x | x |
| `types/model/type-position.md` | 6 | 0 | x | x | x | x |
| `types/model/type-value.md` | 10 | 0 | x | x | x | x |

### `types/scalars`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `types/scalars/atom.md` | 14 | 0 | x | x | x | x |
| `types/scalars/bool.md` | 13 | 0 | x | x | x | x |
| `types/scalars/datetime.md` | 21 | 0 | x | x | x | x |
| `types/scalars/duration.md` | 22 | 0 | x | x | x | x |
| `types/scalars/error-code.md` | 13 | 0 | x | x | x | x |
| `types/scalars/number.md` | 18 | 0 | x | x | x | x |
| `types/scalars/string.md` | 23 | 0 | x | x | x | x |

### `types/typing`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `types/typing/assertion.md` | 17 | 0 | x | x | x | x |
| `types/typing/carried-type.md` | 15 | 0 | x | x | x | x |
| `types/typing/conversion.md` | 20 | 0 | x | x | x | x |
| `types/typing/declaration.md` | 13 | 0 | x | x | x | x |
| `types/typing/defaults.md` | 18 | 0 | x | x | x | x |
| `types/typing/inference.md` | 15 | 0 | x | x | x | x |
| `types/typing/strict-mode.md` | 10 | 0 | x | x | x | x |
| `types/typing/type-lock.md` | 14 | 0 | x | x | x | x |

### `variables`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `variables/capture.md` | 7 | 0 | x | x | x | x |
| `variables/scope.md` | 12 | 0 | x | x | x | x |
| `variables/variable.md` | 8 | 0 | x | x | x | x |

### `expressions`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `expressions/access.md` | 5 | 0 | x | x | x | x |
| `expressions/arithmetic.md` | 4 | 0 | x | x | x | x |
| `expressions/destruct.md` | 12 | 0 | x | x | x | x |
| `expressions/dispatch.md` | 14 | 0 | x | x | x | x |
| `expressions/existence.md` | 11 | 0 | x | x | x | x |
| `expressions/interpolation.md` | 8 | 0 | x | x | x | x |
| `expressions/logical.md` | 6 | 0 | x | x | x | x |
| `expressions/operator.md` | 6 | 0 | x | x | x | x |
| `expressions/pipe.md` | 17 | 0 | x | x | x | x |
| `expressions/pipe-target.md` | 4 | 0 | x | x | x | x |
| `expressions/selection.md` | 28 | 0 | x | x | x | x |
| `expressions/slice.md` | 10 | 0 | x | x | x | x |
| `expressions/spread.md` | 12 | 2 | x | x | x | |

### `callables`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `callables/annotation-access.md` | 8 | 0 | x | x | x | x |
| `callables/code-block.md` | 21 | 0 | x | x | x | x |
| `callables/invocation.md` | 8 | 0 | x | x | x | x |

### `control-flow`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `control-flow/break.md` | 8 | 2 | x | x | x | |
| `control-flow/conditional.md` | 8 | 0 | x | x | x | x |
| `control-flow/construct-options.md` | 16 | 0 | x | x | x | x |
| `control-flow/loop.md` | 14 | 1 | x | x | x | |
| `control-flow/pass.md` | 6 | 1 | x | x | x | |

### `collections`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `collections/acc.md` | 2 | 0 | x | x | x | x |
| `collections/fan.md` | 7 | 0 | x | x | x | x |
| `collections/filter.md` | 5 | 0 | x | x | x | x |
| `collections/fold.md` | 6 | 0 | x | x | x | x |
| `collections/iteration.md` | 20 | 0 | x | x | x | x |
| `collections/seq.md` | 4 | 0 | x | x | x | x |
| `collections/sort.md` | 12 | 0 | x | x | x | x |

### `errors`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `errors/assert.md` | 5 | 0 | x | x | x | x |
| `errors/error.md` | 6 | 0 | x | x | x | x |
| `errors/guard.md` | 11 | 0 | x | x | x | x |
| `errors/invalid-value.md` | 12 | 0 | x | x | x | x |
| `errors/retry.md` | 7 | 0 | x | x | x | x |

### `limits`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `limits/call-depth.md` | 3 | 0 | x | x | x | x |
| `limits/host-timeout.md` | 4 | 0 | x | x | x | x |
| `limits/nesting-depth.md` | 2 | 0 | x | x | x | x |
| `limits/slicing-limit.md` | 3 | 0 | x | x | x | x |
| `limits/value-size.md` | 2 | 0 | x | x | x | x |

### `host-boundary`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `host-boundary/use.md` | 16 | 3 | x | x | x | |

### `builtins`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `builtins/method.md` | 6 | 0 | x | x | x | x |
| `builtins/regex.md` | 3 | 0 | x | x | x | x |

### `builtins/string`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `builtins/string/string.contains.md` | 1 | 0 | x | x | x | x |
| `builtins/string/string.ends_with.md` | 1 | 0 | x | x | x | x |
| `builtins/string/string.first.md` | 1 | 0 | x | x | x | x |
| `builtins/string/string.ge.md` | 1 | 0 | x | x | x | x |
| `builtins/string/string.gt.md` | 1 | 0 | x | x | x | x |
| `builtins/string/string.head.md` | 2 | 0 | x | x | x | x |
| `builtins/string/string.index_of.md` | 2 | 0 | x | x | x | x |
| `builtins/string/string.is_match.md` | 1 | 0 | x | x | x | x |
| `builtins/string/string.le.md` | 1 | 0 | x | x | x | x |
| `builtins/string/string.len.md` | 1 | 0 | x | x | x | x |
| `builtins/string/string.lines.md` | 1 | 0 | x | x | x | x |
| `builtins/string/string.lower.md` | 1 | 0 | x | x | x | x |
| `builtins/string/string.lt.md` | 1 | 0 | x | x | x | x |
| `builtins/string/string.match.md` | 3 | 0 | x | x | x | x |
| `builtins/string/string.pad_end.md` | 3 | 0 | x | x | x | x |
| `builtins/string/string.pad_start.md` | 3 | 0 | x | x | x | x |
| `builtins/string/string.repeat.md` | 2 | 0 | x | x | x | x |
| `builtins/string/string.replace.md` | 2 | 0 | x | x | x | x |
| `builtins/string/string.replace_all.md` | 2 | 0 | x | x | x | x |
| `builtins/string/string.split.md` | 4 | 0 | x | x | x | x |
| `builtins/string/string.starts_with.md` | 1 | 0 | x | x | x | x |
| `builtins/string/string.tail.md` | 2 | 0 | x | x | x | x |
| `builtins/string/string.trim.md` | 1 | 0 | x | x | x | x |
| `builtins/string/string.upper.md` | 1 | 0 | x | x | x | x |

### `builtins/list`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `builtins/list/list.first.md` | 1 | 0 | x | x | x | x |
| `builtins/list/list.head.md` | 2 | 0 | x | x | x | x |
| `builtins/list/list.join.md` | 3 | 0 | x | x | x | x |
| `builtins/list/list.len.md` | 1 | 0 | x | x | x | x |
| `builtins/list/list.reverse.md` | 1 | 0 | x | x | x | x |
| `builtins/list/list.tail.md` | 2 | 0 | x | x | x | x |

### `builtins/dict`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `builtins/dict/dict.entries.md` | 1 | 0 | x | x | x | x |
| `builtins/dict/dict.first.md` | 1 | 0 | x | x | x | x |
| `builtins/dict/dict.keys.md` | 1 | 0 | x | x | x | x |
| `builtins/dict/dict.len.md` | 1 | 0 | x | x | x | x |
| `builtins/dict/dict.values.md` | 1 | 0 | x | x | x | x |

### `builtins/ordered`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `builtins/ordered/ordered.entries.md` | 1 | 0 | x | x | x | x |
| `builtins/ordered/ordered.keys.md` | 1 | 0 | x | x | x | x |
| `builtins/ordered/ordered.len.md` | 1 | 0 | x | x | x | x |
| `builtins/ordered/ordered.values.md` | 1 | 0 | x | x | x | x |

### `builtins/number`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `builtins/number/number.ge.md` | 1 | 0 | x | x | x | x |
| `builtins/number/number.gt.md` | 1 | 0 | x | x | x | x |
| `builtins/number/number.le.md` | 1 | 0 | x | x | x | x |
| `builtins/number/number.lt.md` | 1 | 0 | x | x | x | x |

### `builtins/datetime`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `builtins/datetime/datetime-calendar.md` | 4 | 0 | x | x | x | x |
| `builtins/datetime/datetime.add.md` | 3 | 0 | x | x | x | x |
| `builtins/datetime/datetime.date.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.day.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.diff.md` | 2 | 0 | x | x | x | x |
| `builtins/datetime/datetime.ge.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.gt.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.hour.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.iso.md` | 4 | 0 | x | x | x | x |
| `builtins/datetime/datetime.le.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.local_date.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.local_iso.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.local_offset.md` | 2 | 0 | x | x | x | x |
| `builtins/datetime/datetime.local_time.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.lt.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.minute.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.month.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.ms.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.second.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.time.md` | 2 | 0 | x | x | x | x |
| `builtins/datetime/datetime.unix.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.weekday.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.year.md` | 1 | 0 | x | x | x | x |
| `builtins/datetime/datetime.zero.md` | 1 | 0 | x | x | x | x |

### `builtins/duration`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `builtins/duration/duration-split.md` | 2 | 0 | x | x | x | x |
| `builtins/duration/duration.add.md` | 2 | 0 | x | x | x | x |
| `builtins/duration/duration.days.md` | 1 | 0 | x | x | x | x |
| `builtins/duration/duration.display.md` | 1 | 0 | x | x | x | x |
| `builtins/duration/duration.hours.md` | 1 | 0 | x | x | x | x |
| `builtins/duration/duration.minutes.md` | 1 | 0 | x | x | x | x |
| `builtins/duration/duration.months.md` | 1 | 0 | x | x | x | x |
| `builtins/duration/duration.ms.md` | 1 | 0 | x | x | x | x |
| `builtins/duration/duration.multiply.md` | 4 | 0 | x | x | x | x |
| `builtins/duration/duration.seconds.md` | 1 | 0 | x | x | x | x |
| `builtins/duration/duration.subtract.md` | 3 | 0 | x | x | x | x |
| `builtins/duration/duration.total_ms.md` | 2 | 0 | x | x | x | x |
| `builtins/duration/duration.zero.md` | 1 | 0 | x | x | x | x |

### `builtins/vector`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `builtins/vector/vector-operand.md` | 3 | 0 | x | x | x | x |
| `builtins/vector/vector.dimensions.md` | 1 | 0 | x | x | x | x |
| `builtins/vector/vector.distance.md` | 1 | 0 | x | x | x | x |
| `builtins/vector/vector.dot.md` | 1 | 0 | x | x | x | x |
| `builtins/vector/vector.model.md` | 1 | 0 | x | x | x | x |
| `builtins/vector/vector.norm.md` | 1 | 0 | x | x | x | x |
| `builtins/vector/vector.normalize.md` | 2 | 0 | x | x | x | x |
| `builtins/vector/vector.similarity.md` | 2 | 0 | x | x | x | x |

### `builtins/functions`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `builtins/functions/batch.md` | 6 | 0 | x | x | x | x |
| `builtins/functions/chain.md` | 3 | 0 | x | x | x | x |
| `builtins/functions/cycle.md` | 2 | 0 | x | x | x | x |
| `builtins/functions/debounce.md` | 2 | 0 | x | x | x | x |
| `builtins/functions/enumerate.md` | 2 | 0 | x | x | x | x |
| `builtins/functions/identity.md` | 1 | 0 | x | x | x | x |
| `builtins/functions/iterate.md` | 2 | 0 | x | x | x | x |
| `builtins/functions/json.md` | 7 | 0 | x | x | x | x |
| `builtins/functions/log.md` | 3 | 0 | x | x | x | x |
| `builtins/functions/now.md` | 2 | 0 | x | x | x | x |
| `builtins/functions/range.md` | 5 | 0 | x | x | x | x |
| `builtins/functions/repeat.md` | 3 | 0 | x | x | x | x |
| `builtins/functions/sample.md` | 1 | 0 | x | x | x | x |
| `builtins/functions/skip.md` | 3 | 0 | x | x | x | x |
| `builtins/functions/slicing.md` | 5 | 0 | x | x | x | x |
| `builtins/functions/start-when.md` | 3 | 0 | x | x | x | x |
| `builtins/functions/stop-when.md` | 3 | 0 | x | x | x | x |
| `builtins/functions/take.md` | 3 | 0 | x | x | x | x |
| `builtins/functions/throttle.md` | 2 | 0 | x | x | x | x |
| `builtins/functions/time-domain.md` | 3 | 0 | x | x | x | x |
| `builtins/functions/window.md` | 4 | 0 | x | x | x | x |

## Backlog

What the sweeps found that no rule states yet, routed to the slice that owns it. Every chapter backlog is settled. A slice works its
backlog in the Complete and Cited columns: probe each item, then write a rule or record why none is
needed. Strike nothing here; the slice PR deletes the items it settles.

### Out of scope

Not language surface, so no rule is owed. Each slice confirms its share is never raised by a
script.

- Retired, never raised: RILL-P008, RILL-R013, RILL-R014, RILL-R039, RILL-R041, RILL-R042,
  RILL-R064 to RILL-R067.
- CLI and config: RILL-C001 to RILL-C004.
- Extension packages: RILL-R017 to RILL-R035.
- Host registration and policy: RILL-R059, RILL-R061, RILL-R068 to RILL-R073, RILL-R075,
  RILL-R077, RILL-R086 to RILL-R089, RILL-R091. RILL-R011 rejects an `autoExceptions` pattern in `createRuntimeContext`. RILL-R074 is raised by the host API `createVector`; a script sees it only through a host function (INCONSISTENCIES.md, Built-ins). A script parameter default of the wrong type halts
  `#TYPE_MISMATCH` instead (`defaults.type-match`). RILL-R091 fires in `createRuntimeContext`,
  before any script runs.
- Built-in resolver failures: RILL-R050 to RILL-R053, RILL-R062, RILL-R063. Under `use<>` each
  surfaces as RILL-R056 (`use.resolver-failure`). RILL-R076 is raised only by the test context
  in `runtime/ext`.
- Host API: `toNative` converts a value for the host and is never called from a script.
- Test files: `ref-llms-full-assertions.test.ts` checks `docs/`, not the language.
  `parser-recovery.test.ts` and `parser-spans.test.ts` test the `parseWithRecovery` host API and
  AST spans.

## Findings

Defects and decisions found during the audit. An omission or inconsistency fixed in a PR needs no
row; the PR names it. A defect stays `Collected` until slice 19 files it, then its Outcome names
the issue. Each row carries enough evidence to file without probing again. Rows below were probed
at a897cfc3 unless they say otherwise.

A `Collected` row has a `D-nn` id. Its `Upstream` cell names the rows in
[INCONSISTENCIES.md](INCONSISTENCIES.md) that must be decided before the defect can be filed,
because the decision changes the expected result; `None` means it can be filed now. `Then`, `Group`,
and `See` follow "Ids and edges" in that file, and `Group` names rows that share a root cause.

| Id | File | Finding | Upstream | Outcome |
|----|------|---------|----------|---------|
| D-01 | `expressions/selection.md`, `builtins` | RILL-R003 catchability differs by site: `list[1] -> .keys` halts RILL-R003 and escapes `guard`; `$l.a` halts RILL-R003 and `guard` catches it | I-98. Group: D-16, D-22. See: D-23, I-12. | Collected |
| D-02 | `limits` | The 2147483647 ms timer ceiling applies to `timeout(...)` only. `range(0, 2) -> debounce(duration(...dict[ms: 2147483648]))` returns; `throttle`, `sample`, and `batch(idle_flush:)` also skip the check. At 93e55c14, the host `timeout` option skips it too: at 2147483648, 0, or -5, `sleep(10)` halts RILL-R012 within 1 ms, and Node.js warns TimeoutOverflowWarning | I-89 (the time-domain part only; the host `timeout` option part has none). See: D-11, I-75. | Collected |
| D-03 | `limits/value-size.md`, `types/scalars/datetime.md` | `value-size.datetime`: a unix count outside the range must halt `#INVALID_INPUT`. `datetime(...dict[unix: 8640000000000001])` builds and returns `.unix`; interpolating it halts `#INVALID_INPUT`. At 93e55c14 its `.year` is `NaN` and `.iso` is `+000NaN-NaN-NaNTNaN:NaN:NaNZ`, while components, ISO strings, and `.add` past the bound halt | None. See: I-38, I-85. | Collected |
| D-04 | `limits/nesting-depth.md`, `error-registry.ts` RILL-P015 | `MAX_NESTING` is 150 and the registry example nests 151 parentheses, but RILL-P015 fires at 75 nested parentheses, `list[`, `dict[a: `, or blocks; 74 parse. Probed at 93e55c14 | None. | Collected |
| D-05 | `docs/llm/cheatsheet.txt:55` | Says failures are "uncatchable"; `guard { 1 == "1" }` catches `#TYPE_MISMATCH` (`halt.catchable`) | I-98. | Collected |
| D-06 | `docs/llm/cheatsheet.txt:92`, `anti-patterns.txt:400` | Say a space after `#` is required; `1 #1` and `1 #!x` run as comments (`atom.comment`) | None. | Collected |
| D-07 | `docs/llm/errors.txt:141` | Lists `0` and `false` as vacant; `0 ?? 5` is `0` (`vacancy.zero-false`) | None. | Collected |
| D-08 | `docs/llm/stdlib.txt:260,266`, `control-flow.txt:157-176` | Show `start_when` on a list returning a stream; it returns a list | None. | Collected |
| D-09 | `docs/llm/anti-patterns.txt:290` | Says `.len` is not a method call; `list[1, 2] -> .len()` returns 2 | None. | Collected |
| D-10 | `docs/llm/anti-patterns.txt:235` | `$l -> list(number)[0]` halts RILL-R009 because `$l` acts as a dispatch path, not for the reason given | None. See: I-41. | Collected |
| D-11 | `error-registry.ts` RILL-R012 | Recommends a `^(timeout: ms)` annotation; `^(timeout: 10) slow()` on a 200 ms host function returns | None. See: D-02, I-75. | Collected |
| D-12 | `error-registry.ts` RILL-R010 | Says to raise the iteration limit "via RuntimeOptions"; no such option exists | None. See: I-07, I-69. | Collected |
| | `collections/iteration.md` | RILL-R010 from `take` and `skip` is catchable; the Errors row says No  | | Collected in INCONSISTENCIES.md |
| | `expressions/interpolation.md` | A datetime interpolates, but its string conversion halts RILL-R036  | | Collected in INCONSISTENCIES.md |
| | `callables/code-block.md` | A suffix on a construct body checks the construct's result, not each run  | | Collected in INCONSISTENCIES.md |
| | `collections/iteration.md` | `start_when`, `stop_when`, and `chain` halt RILL-R040, not `#TYPE_MISMATCH`  | | Moved to D-28 |
| | `collections/filter.md` | An invalid predicate result halts RILL-R001, not `#TYPE_MISMATCH`  | | Collected in INCONSISTENCIES.md |
| | `expressions/selection.md` | `.name` on a literal receiver halts RILL-R007, and a locked test pins it; `selection.no-name` says RILL-R003  | | Collected in INCONSISTENCIES.md |
| | `conventions/halt.md` | `#TYPE_MISMATCH` and `#DISPOSED` halts carry no error id; `halt.error-id` says every halt does  | | Collected in INCONSISTENCIES.md |
| | `conventions/notation.md` | `notation.code` and `notation.result` cannot be proven by any check  | | Demoted to definitions |
| | `lexical/token.md` | An unclosed `{` or bare `(` halts RILL-P001; an unclosed `(1 + 2` or `list[` halts RILL-P005  | | Collected in INCONSISTENCIES.md |
| | `lexical/source-text.md` | A lone carriage return is a space outside strings but ends a one-line string with RILL-L001  | | Collected in INCONSISTENCIES.md |
| | `host-boundary/use.md`, `expressions/destruct.md`, `expressions/slice.md` | `destruct <` and `slice <` halt RILL-P001; `use <` halts RILL-P007  | | Moved to D-29 |
| | `program/statement.md` | A leading `.name`, `:type`, `.?`, or `.!`, and a trailing `.`, `.?`, or `??`, continue a line after some receivers and not others  | | Collected in INCONSISTENCIES.md |
| | `program/statement.md` | A leading binary operator halts RILL-P001 at statement level and RILL-P005 inside brackets  | | Collected in INCONSISTENCIES.md |
| | `program/annotation.md` | A spread stores the reserved keys; a later string sets `description`; `^(limit: N)` halts in every expression position; type arguments take annotations unevenly  | | Collected in INCONSISTENCIES.md |
| | `program/annotation.md`, `program/frontmatter.md` | The `annotation-arg` and `yaml-char` productions disagree with the runtime and the rules  | | Collected in INCONSISTENCIES.md |
| | `program/frontmatter.md` | Text after a delimiter on its line is accepted: frontmatter text on the opening line, a statement on the closing line  | | Collected in INCONSISTENCIES.md |
| D-13 | `values/equality.md` | `equality.methods`: the methods compare as `==` does, including its halts. With `$s` a host stream, `$s == $s` and `$s != 1` halt RILL-R002, but `$s -> .eq($s)` and `list[$s] -> .has($s)` yield `true`. With `range(0, 3) => $i`, `$i == $i` halts RILL-R002, but `$i -> .eq($i)` and `list[$i] -> .has($i)` yield `true`. Probed at c611430c | None. See: I-96. | Collected |
| | `values/equality.md` | `equality.kind` names an `any` operand, but no probed operand carries `any`  | | Collected in INCONSISTENCIES.md |
| | `values/value.md`, `values/vacancy.md` | `value.kinds` omits iterators and vectors; an iterator or stream that yields nothing is not vacant; `value.no-alias` and `scope.late-binding` disagree  | | Collected in INCONSISTENCIES.md |
| D-14 | `types/constructors/stream.md` | `stream.accepts`: a stream type accepts when its chunk and resolution types accept the stream's. The runtime compares them by equality. With `fn(x):stream(string):number { $x -> yield` then `1 } => $f` and `$f("a") => $s`, `$s -> :?stream(union(string, number))` and `$s -> :?stream(string):union(number, string)` yield `false`. A `stream(dict(a: number))` value fails `:?stream(dict)`, and a `stream(list(number))` value fails `:?stream(list)`. A `stream()` value passes `:?stream(number)`. `list["a"] -> :?list(union(string, number))` yields `true`. Probed at 289206aa | None. See: I-30. | Collected |
| D-15 | `scripts/reference/check.ts` | `grammar-syntax` drops the first production after a `text` fence. `parseProductions` splits the joined Syntax fences on `;` and keeps a statement only when it starts with `name =`. A `text` fence has no `;`, so its text joins the first production of the next `ebnf` fence. With the `text` fence first, `map.md`, `ordered.md`, and `tuple.md` failed for `map`, `ordered`, and `tuple`, while `map-entry` and `map-key` passed. Putting the `ebnf` fence first clears it. Probed at 289206aa | None. | Collected |
| | `types/constructors` | Dict method names as keys; dict duplicates through multi-key and computed keys; `.entries` on mixed values; the halt for unordered operands; extra stream arguments; a stream's printed form  | | Collected in INCONSISTENCIES.md |
| | `types/model` | RILL-P014 from a non-type expression that starts with a type name; `number()` and `any(number)` differ by position; RILL-P001 for an outer on a scalar in a type position; `??` after an early missing read; the type a literal operand carries in an overlap check. Probed at 6cc38b29  | | Collected in INCONSISTENCIES.md |
| | `types/scalars` | The ISO 8601 subset `datetime` accepts; a fractional unix count truncates; a unix count drops time components; a string piped into `datetime` halts RILL-R036 while `duration` parses it. Probed at c7ef8720  | | Collected in INCONSISTENCIES.md |
| | `types/typing` | A bracket after a postfix bare-kind assertion; dict iteration under a carried type; the carried type of a `??` right operand; union defaults in conversion against a call. Probed at c2fdd19f  | | Collected in INCONSISTENCIES.md |
| | `variables/scope.md` | A capture into a parameter inside its own body halts RILL-R001 as an outer rebinding; no rule says which scope a function body's parent is. Probed at 9b5a9c67  | | Collected in INCONSISTENCIES.md |
| D-16 | `expressions/selection.md` | `selection.at`: `.at` on a dict or an ordered halts RILL-R003, and the Errors row says Yes. `dict[a: 1].at(0)` and `ordered[a: 1].at(0)` halt RILL-R003 "Cannot call .at() on object" and escape `guard`. Shares the root cause of the `.keys` row above. Probed at 21eecdfb | I-98. Group: D-01, D-22. | Collected |
| | `expressions` | A tuple or ordered literal is not a dispatch target, while a list or dict literal is; `spread.list-uniform` contradicts `inference.literal-union`; `spread.arg-positional` does not say whether positional arguments may precede the spread. Probed at 21eecdfb  | | Collected in INCONSISTENCIES.md |
| D-17 | `control-flow/loop.md`, `control-flow/pass.md`, `control-flow/conditional.md` | A construct with no `$` bound reads a missing value instead of halting RILL-R005, which `loop.seed` requires, and which bare `pass` and `false ? "y"` raise. At the top level, `while (false) do { 1 } => $x` then `$x` prints `type(null)`, and its `.^type.name` is `"string"`. `do { 1 } while (false)` yields 1. `pass { 1 }` and `pass(ignore_halts: true) { 1 / 0 }` yield an empty printout. `? 1 ! 2` halts RILL-R002 "Piped conditional requires boolean, got string". Probed at 23491968 | None. Then: I-55. | Collected |
| | `callables` | An empty `fn` body parses and halts RILL-R043 on call while every other empty block halts RILL-P004; `$d.a()` on a non-function field halts RILL-R007 while `$n()` halts RILL-R002; a call suffix after a method in a pipe target starts a new statement; `annotation-existence` omits the `&T` suffix the runtime accepts. Probed at 97c5b292  | | Collected in INCONSISTENCIES.md |
| | `collections` | `seq` and `acc` read an iterator lazily, so `break` beats the limit `iteration.sequential-limit` states for every kind; `fold` reads it eagerly while `acc` does not; `sort` key calls overlap with no `concurrency` option. Probed at 5d3bb63f  | | Collected in INCONSISTENCIES.md |
| | `control-flow` | Which body `return` ends; `break` inside a called function; a bare `break` with no `$`; a halt in an async `pass` body; an empty `pass` body; `timeout` with no parentheses. Probed at 23491968  | | Collected in INCONSISTENCIES.md |
| D-18 | `errors/invalid-value.md` | `invalid-value.access`: an operator on an invalid value raises the halt it holds. An invalid value used directly as a bool operand halts RILL-R002 "requires boolean, got dict" instead. With `guard { 1 == "a" } => $r`, `!$r`, `$r && true`, `$r \|\| true`, `$r ? 1 ! 2`, `assert $r`, and `while ($r) do { 1 }` halt RILL-R002, while `$r -> ($ ? 1 ! 2)` and `$r == 1` raise `#TYPE_MISMATCH`. Probed at e7d4d0cd See: I-98. | None. Then: I-11. See: I-98. | Collected |
| | `errors` | Text after `assert cond` starts a new statement while `error` rejects it; `.!foo` yields `""`; no rule lists the core error set; trace origin frames have no named vocabulary. Probed at e7d4d0cd  | | Collected in INCONSISTENCIES.md |
| D-19 | `limits/slicing-limit.md`, `values/value.md` | `value.immutable`: a value never changes. A stored `iterate` iterator counts its function calls across reads. `iterate(0, { $ + 1 }) => $it`, then `$it -> take(6000)` twice: the second read halts RILL-R010 "iterate: iteration exceeded 10000 limit", uncatchable. `range(0, 20000) => $it` read the same way yields 6000 both times. Probed at 93e55c14 | None. See: I-07, I-76. | Collected |
| D-20 | `host-boundary/use.md` | `use.source`: a source module runs in a scope of its own, and the caller's variables are not visible to it. `use.source-dollar`: with no piped value, a module that reads `$` halts RILL-R005. The module runs in a child scope of the use site instead. With `"o" => $outer`, a module `$outer` yields `"o"`, and a module `fn { $outer }` called later yields the caller's current value. With `"o" => $outer`, a module `2 => $outer` halts RILL-R001 "Cannot reassign outer variable", uncatchable. `5 -> {`, `log($)`, `use<m:x>`, `}` with a module `$` yields 5. Probed at da098e5d | None. See: I-25, I-45. | Collected |
| | `host-boundary` | `use.static-id` names RILL-P022 where the runtime raises RILL-P020, RILL-P021, and RILL-P001; a computed identifier passes a resource the static form rejects; a throwing host function yields an invalid value `#R999` while a throwing resolver halts; RILL-R084 depends on a core error set no rule lists. Probed at da098e5d  | | Collected in INCONSISTENCIES.md |
| D-21 | `limits/value-size.md`, `conventions/halt.md` | `halt.error-code`: a runtime halt carries an error code. A string past the maximum length raises a bare "Invalid string length" with no code or id, and `guard` cannot catch it: `"a" -> .repeat(300000000) => $s` then `"{$s}{$s}"` or `list[$s, $s] -> .join("")`, and `"a" -> .pad_start(536870889, "x")` and `.pad_end(536870889, "x")`. `.pad_start(600000000, "x")` halts `#INVALID_INPUT`, catchable, and `.repeat(536870889)` halts `#INVALID_INPUT`. Probed at 93e55c14 See: I-98. | None. See: I-17, I-98. | Collected |
| D-22 | `builtins/method.md`, `builtins` | `method.wrong-kind`: a method the receiver's kind lacks halts RILL-R003, catchable. For most methods registered on one or two kinds, the halt escapes `guard`: `dict[a: 1] -> .head`, `tuple[1, 2].head`, `ordered[b: 1].first`, `range(0, 3) -> .head`; `5 -> .year`, `.iso`, `.add`, `.diff`, `.weekday`, `.local_iso`, `duration("1h") -> .unix`, `5 -> .zero`; `"x".total_ms`, `5.days`, `list[1].multiply(2)`; `"s".dimensions`, `list[1].norm`, `5.similarity($v)`. `5 -> .trim`, `list[1] -> .upper`, and a field-style miss on a vector halt RILL-R003 that `guard` catches. Shares the root cause of the `.keys` and `.at` rows. Probed at 36149582 | I-98. Group: D-01, D-16. See: D-23, I-12, I-80. | Collected |
| D-23 | `builtins/datetime/datetime.local_offset.md` | `method.wrong-kind`: `.local_offset` checks no receiver. `5 -> .local_offset` and `"x" -> .local_offset` yield 0, or 2 with host `timezone: 2`. Probed at 36149582 | None. See: D-01, D-22, I-80. | Collected |
| D-24 | `error-registry.ts` duration range message | `duration.range` allows a fractional millisecond count (`duration("1s0.5ms")`), but the out-of-range halt from `.add` and `.multiply` says "each component must be a non-negative integer no larger than 9007199254740991": `duration(...dict[ms: 9007199254740991]).add(duration("1ms"))`. Probed at 36149582 | I-38, I-86. | Collected |
| D-25 | `builtins/functions/batch.md` | An `ordered` options argument halts `#INVALID_INPUT` "batch: unknown option '__rill_ordered'", exposing an internal key; a list, string, or number halts `#TYPE_MISMATCH` "options must be a dict" (`batch.options-kind`). `list[1, 2, 3] -> batch(2, ordered[drop_partial: true])`. Probed at 36149582 | None. See: I-04, D-38, I-92. | Collected |
| D-26 | `builtins/functions/now.md`, `expressions/spread.md` | `spread.arg-dict`, `spread.arg-tuple`: a spread passes each field or element as an argument. `now(...dict[])` and `now(...tuple[])` halt RILL-R001 "Spread not supported for zero-parameter function 'fn'", catchable, while `fn() { 1 } => $f` then `$f(...dict[])` yields 1. Probed at 36149582 | None. See: I-48. | Collected |
| D-27 | `scripts/test-examples-mock-host.ts` | The examples mock host reads the `embed` model argument wrongly: `$app.embed("b", "other").model` returns `"[object Object]"`. Not language surface. Probed at 36149582 | None. | Collected |
| | `builtins` | No concept owns the iterator protocol (`.value`, `.done`, `.next`); `string.first`, `list.first`, `range`, and `repeat` read it. `"ab" -> .first -> .next -> .value` halts RILL-R003 "Method .value not available on callable". Probed at 36149582  | | Collected in INCONSISTENCIES.md |
| D-28 | `collections/iteration.md` | A non-function operator argument halts under three identities. `list[1] -> seq(5)` halts `#TYPE_MISMATCH` (`iteration.callable`); `start_when(5)`, `stop_when(5)`, and `chain(5)` halt RILL-R040, catchable, pinned by `collection-operators.test.ts` and `chain.test.ts`. Decision: one identity, RILL-R001 as `invocation.type` states, reached by declaring the parameter types on the built-ins; `seq`, `fold`, and `filter` move with them, `iteration.callable` cites `invocation.type`, and RILL-R040 retires. Decided 2026-11-25. Probed at ab69d734 | I-97, I-98. Group: D-37, D-38. | Collected |
| D-29 | `host-boundary/use.md`, `expressions/destruct.md`, `expressions/slice.md` | The RILL-P007 registry entry names `use<`, `destruct<`, and `slice<`. `use <ext:app>` halts RILL-P007, but `list[1, 2] -> destruct <$a, $b>` and `slice <0:1>` halt RILL-P001 "Unexpected token: <". Decision: all three halt RILL-P007. Decided 2026-11-25. Probed at ab69d734 | None. | Collected |
| D-30 | `program/annotation.md` | `annotation.reserved`: the keys `type` and `effective` are rejected. `^(type: 1) fn(x) { $x }` halts RILL-P001, but `dict[type: 1, effective: 2] => $o` then `^(...$o) fn(x) { $x } => $f` stores both, and `$f.?^type` is `true`. Decision: a spread that carries a reserved key halts `#INVALID_INPUT` at runtime. Decided 2026-11-25. Probed at ab69d734 | None. See: D-31, I-20. | Collected |
| D-31 | `program/annotation.md` | `annotation.shorthand` and the `annotation-args` production: only a leading string is the description. `^(k: 1, "d") fn(x) { $x }` sets `description` to `"d"`, and `^("a", "b")` sets it to `"b"`, dropping `"a"`. Decision: a string after the first argument is rejected at parse. Decided 2026-11-25. Probed at ab69d734 | None. See: D-30, I-20. | Collected |
| D-32 | `types/constructors/dict.md`, `types/constructors/ordered.md` | `dict.key-duplicate`: a literal that spells one key twice halts RILL-P027, as `dict[a: 1, a: 2]` does. `dict[["a", "b"]: 1, a: 2]` yields `dict[a: 2, b: 1]`, and `"k" => $k` then `dict[$k: 1, k: 2]` yields `dict[k: 2]`; `ordered` behaves the same. Decision: dict and ordered match the map: a literal element of a multi-key list halts at parse (`map.duplicate-parse`), and a computed duplicate halts `#INVALID_INPUT` (`map.duplicate-run`). Decided 2026-11-25. Probed at ab69d734 | None. | Collected |
| D-33 | `types/model/type-form.md` | The `type-form` Errors table: an outer on a type that takes none raises RILL-P006, as `5 -> :list(number):string` does. `5 -> :number:string` and `5 => $x:number:string` halt RILL-P001 "Unexpected token: :". Decision: the scalar form halts RILL-P006 too. Decided 2026-11-25. Probed at ab69d734 | None. See: I-32. | Collected |
| D-34 | `types/scalars/datetime.md` | `datetime.one-form`: a unix count with `year`, `month`, or `day` halts `#INVALID_INPUT`. `datetime(...dict[unix: 0, ms: 1])` yields `1970-01-01T00:00:00.000Z`, dropping `ms`; `hour`, `minute`, and `second` are dropped the same way. Decision: any component beside `unix` halts `#INVALID_INPUT`. Decided 2026-11-25. Probed at ab69d734 | None. | Collected |
| D-35 | `program/annotation.md` | `annotation.positions`: an annotation before a type argument is rejected, and `list(^(k: 1) number)` halts RILL-P001. `stream(^(k: 1) number)` returns `stream(number)`, and `dict(a: list(^(k: 1) number))` returns `dict(a: list(number))`: the annotation is accepted and dropped. Decision: both halt RILL-P001. Decided 2026-11-25. Probed at ab69d734 | None. | Collected |
| D-36 | `program/frontmatter.md` | The `frontmatter` production: each delimiter is `---` then a line ending, and a closing `----` halts RILL-P023 (`frontmatter.extra-dash`). An opening `----` or `--- x` is accepted, and `-` or `x` becomes frontmatter text. A closing `--- 2` is accepted, and `2` runs as a statement. Decision: a delimiter line that is not `---` alone halts RILL-P023. Decided 2026-11-25. Probed at ab69d734 | None. See: I-21. | Collected |
| D-37 | `builtins/functions/iterate.md` | `iterate(0, 5)` and `iterate(0, "x")` halt RILL-R006 "iterate: body must be a function", catchable; RILL-R006 otherwise means an unknown function. Decision: RILL-R001, with D-28. Decided 2026-11-25. Probed at ab69d734 | I-97, I-98. Group: D-28, D-38. | Collected |
| D-38 | `builtins/functions/window.md` | `invocation.type`: an argument that fails its parameter type halts RILL-R001, as `window("2")` does for `n`. `list[1, 2, 3] -> window(2, "1")` halts `#INVALID_INPUT` "window: step must be an integer, got string", catchable. Decision: `step` halts RILL-R001 through a declared parameter type, with D-28. Decided 2026-11-25. Probed at ab69d734 | I-97, I-98. Group: D-28, D-37. See: D-25. | Collected |
| D-39 | `builtins/functions/json.md`, `callables/code-block.md` | `code-block.non-selecting`: conversion reaching a held block halts `#TYPE_MISMATCH`, and `dict[a: { $ + 1 }] -> .values` halts "values: entry 'a' holds a code block". `json(dict[a: { $ + 1 }])` halts `#INVALID_INPUT` "functions are not JSON-serializable"; the locked suite pins that message only for a function (`pipe-targets.test.ts`). Decision: `json` halts `#TYPE_MISMATCH` naming the entry. Decided 2026-11-25. Probed at ab69d734 | None. See: I-02, I-92, I-93. | Collected |
