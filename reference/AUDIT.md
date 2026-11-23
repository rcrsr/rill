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
| 15 | `errors` | 5 | 41 | 0 | |
| 16 | `limits` (write) | 0 | 0 | 0 | |
| 17 | `host-boundary` | 1 | 14 | 11 | |
| 18 | `builtins` (write) | 0 | 0 | 0 | |
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

### `host-boundary`

| File | Rules | Uncited | Correct | Consistent | Complete | Cited |
|------|-------|---------|---------|------------|----------|-------|
| `host-boundary/use.md` | 14 | 11 | | | | |

### Unwritten chapters

Each gets a table when its PR splits it into concepts.

| Chapter | Covers |
|---------|--------|
| `limits` | Iteration, concurrency, call depth, timeouts |
| `builtins` | Built-in methods and functions |

## Backlog

What the sweeps found that no rule states yet, routed to the slice that owns it. A slice works its
backlog in the Complete and Cited columns: probe each item, then write a rule or record why none is
needed. Strike nothing here; the slice PR deletes the items it settles.

### `host-boundary`

- Errors: RILL-P020, RILL-P021, RILL-R050 to RILL-R053, RILL-R057, RILL-R062, RILL-R063,
  RILL-R076, RILL-R084 (a host invalidation code outside the core error set), RILL-R091.
- `use`: a `guard` around `use<>` catches RILL-R057; `app::fetch()` halts RILL-P012.
- Hosts cannot add error codes; `toNative` reports the own type; a default in a host signature
  string halts RILL-R091.

### `limits` (write)

- Unstated: the output cap of `take`, `batch`, `window`, `start_when`, and `stop_when`; the
  `take` and `skip` step walk; call depth (`maxCallDepth`, 1000); calls in flight; the host
  `timeout` option (RILL-R012); parser nesting (RILL-P015); `.repeat` and `.pad_*` result size;
  the datetime range; the `use<>` branding cap (RILL-R090).
- Partial: `timeout` expiry names no error id; the `iterate` step cap is only implied by
  `iteration.expansion`.
- Which RILL-R010 sites are catchable, which `halt.non-catchable` leaves unnamed.
- Host-only, likely Notes: `maxCallStackDepth` trims the trace and never halts; `dispose()`
  waits 5000 ms.

### `builtins` (write)

- No rule: `identity`, `log`, `json`, `enumerate`, `range`, `repeat`, `now`, `take`, `skip`,
  `cycle`, `window`.
- Partial: `chain`, `batch`, `start_when`, `stop_when`, `iterate`, `debounce`, `throttle`,
  `sample`; `dict` and `ordered` `.values` and `.entries`.
- `string`, 24 with no rule: `len`, `trim`, `head`, `tail`, `first`, `split`, `lines`,
  `starts_with`, `ends_with`, `lower`, `upper`, `replace`, `replace_all`, `contains`, `match`,
  `is_match`, `index_of`, `repeat`, `pad_start`, `pad_end`, `lt`, `gt`, `le`, `ge`.
- `list`: `len`, `head`, `tail`, `first`, `join`, `reverse`. `dict`: `len`, `first`, `keys`.
  `ordered`: `len`, `keys`. `number`: `lt`, `gt`, `le`, `ge`.
- `datetime`, 23 with no rule: the component readers, `unix`, `weekday`, `zero`, the `iso`,
  `date`, `time`, and `local_*` formatters, `add`, `diff`, `lt`, `gt`, `le`, `ge`.
- `duration`, 12 with no rule: the component readers, `total_ms`, `display`, `zero`, `add`,
  `subtract`, `multiply`. `vector`, 7 with no rule: `dimensions`, `model`, `similarity`, `dot`,
  `distance`, `norm`, `normalize`.
- Errors: RILL-R007 (undefined method), RILL-R011 (regex), RILL-R040, RILL-R074 (vector).
- Tests: `methods.test.ts`, `variable-method-calls.test.ts`, `chain.test.ts`,
  `collection-slicing.test.ts`, `iterate.test.ts`.
- `datetime.md` and `duration.md` point forward to this chapter; repoint them when it lands.

### Out of scope

Not language surface, so no rule is owed. Each slice confirms its share is never raised by a
script.

- Retired, never raised: RILL-P008, RILL-R013, RILL-R014, RILL-R039, RILL-R041, RILL-R042,
  RILL-R064 to RILL-R067.
- CLI and config: RILL-C001 to RILL-C004.
- Extension packages: RILL-R017 to RILL-R035.
- Host registration and policy: RILL-R059, RILL-R061, RILL-R068 to RILL-R073, RILL-R075,
  RILL-R077, RILL-R086 to RILL-R089. A script parameter default of the wrong type halts
  `#TYPE_MISMATCH` instead (`defaults.type-match`).
- Test files: `ref-llms-full-assertions.test.ts` checks `docs/`, not the language.
  `parser-recovery.test.ts` and `parser-spans.test.ts` test the `parseWithRecovery` host API and
  AST spans.

## Findings

Defects and decisions found during the audit. An omission or inconsistency fixed in a PR needs no
row; the PR names it. A defect stays `Collected` until slice 19 files it, then its Outcome names
the issue. Each row carries enough evidence to file without probing again. Rows below were probed
at a897cfc3 unless they say otherwise.

| File | Finding | Outcome |
|------|---------|---------|
| `expressions/selection.md`, `builtins` | RILL-R003 catchability differs by site: `list[1] -> .keys` halts RILL-R003 and escapes `guard`; `$l.a` halts RILL-R003 and `guard` catches it | Collected |
| `limits` | The 2147483647 ms timer ceiling applies to `timeout(...)` only. `range(0, 2) -> debounce(duration(...dict[ms: 2147483648]))` returns; `throttle`, `sample`, and `batch(idle_flush:)` also skip the check | Collected |
| `limits`, `types/scalars/datetime.md` | The datetime range is checked only on print: `datetime(...dict[unix: 8640000000000001])` builds and returns `.unix`; interpolating it halts `#INVALID_INPUT` | Collected |
| `limits` | RILL-P015 `MAX_NESTING` is 150, but it fires at 75 nested parentheses or `list[`, and 76 nested blocks | Collected |
| `docs/llm/cheatsheet.txt:55` | Says failures are "uncatchable"; `guard { 1 == "1" }` catches `#TYPE_MISMATCH` (`halt.catchable`) | Collected |
| `docs/llm/cheatsheet.txt:92`, `anti-patterns.txt:400` | Say a space after `#` is required; `1 #1` and `1 #!x` run as comments (`atom.comment`) | Collected |
| `docs/llm/errors.txt:141` | Lists `0` and `false` as vacant; `0 ?? 5` is `0` (`vacancy.zero-false`) | Collected |
| `docs/llm/stdlib.txt:260,266`, `control-flow.txt:157-176` | Show `start_when` on a list returning a stream; it returns a list | Collected |
| `docs/llm/anti-patterns.txt:290` | Says `.len` is not a method call; `list[1, 2] -> .len()` returns 2 | Collected |
| `docs/llm/anti-patterns.txt:235` | `$l -> list(number)[0]` halts RILL-R009 because `$l` acts as a dispatch path, not for the reason given | Collected |
| `error-registry.ts` RILL-R012 | Recommends a `^(timeout: ms)` annotation; `^(timeout: 10) slow()` on a 200 ms host function returns | Collected |
| `error-registry.ts` RILL-R010 | Says to raise the iteration limit "via RuntimeOptions"; no such option exists | Collected |
| `collections/iteration.md` | RILL-R010 from `take` and `skip` is catchable; the Errors row says No | Collected in INCONSISTENCIES.md |
| `expressions/interpolation.md` | A datetime interpolates, but its string conversion halts RILL-R036 | Collected in INCONSISTENCIES.md |
| `callables/code-block.md` | A suffix on a construct body checks the construct's result, not each run | Collected in INCONSISTENCIES.md |
| `collections/iteration.md` | `start_when`, `stop_when`, and `chain` halt RILL-R040, not `#TYPE_MISMATCH` | Collected in INCONSISTENCIES.md |
| `collections/filter.md` | An invalid predicate result halts RILL-R001, not `#TYPE_MISMATCH` | Collected in INCONSISTENCIES.md |
| `expressions/selection.md` | `.name` on a literal receiver halts RILL-R007, and a locked test pins it; `selection.no-name` says RILL-R003 | Collected in INCONSISTENCIES.md |
| `conventions/halt.md` | `#TYPE_MISMATCH` and `#DISPOSED` halts carry no error id; `halt.error-id` says every halt does | Collected in INCONSISTENCIES.md |
| `conventions/notation.md` | `notation.code` and `notation.result` cannot be proven by any check | Demoted to definitions |
| `lexical/token.md` | An unclosed `{` or bare `(` halts RILL-P001; an unclosed `(1 + 2` or `list[` halts RILL-P005 | Collected in INCONSISTENCIES.md |
| `lexical/source-text.md` | A lone carriage return is a space outside strings but ends a one-line string with RILL-L001 | Collected in INCONSISTENCIES.md |
| `host-boundary/use.md`, `expressions/destruct.md`, `expressions/slice.md` | `destruct <` and `slice <` halt RILL-P001; `use <` halts RILL-P007 | Collected in INCONSISTENCIES.md |
| `program/statement.md` | A leading `.name`, `:type`, `.?`, or `.!`, and a trailing `.`, `.?`, or `??`, continue a line after some receivers and not others | Collected in INCONSISTENCIES.md |
| `program/statement.md` | A leading binary operator halts RILL-P001 at statement level and RILL-P005 inside brackets | Collected in INCONSISTENCIES.md |
| `program/annotation.md` | A spread stores the reserved keys; a later string sets `description`; `^(limit: N)` halts in every expression position; type arguments take annotations unevenly | Collected in INCONSISTENCIES.md |
| `program/annotation.md`, `program/frontmatter.md` | The `annotation-arg` and `yaml-char` productions disagree with the runtime and the rules | Collected in INCONSISTENCIES.md |
| `program/frontmatter.md` | Text after a delimiter on its line is accepted: frontmatter text on the opening line, a statement on the closing line | Collected in INCONSISTENCIES.md |
| `values/equality.md` | `equality.methods`: the methods compare as `==` does, including its halts. With `$s` a host stream, `$s == $s` and `$s != 1` halt RILL-R002, but `$s -> .eq($s)` and `list[$s] -> .has($s)` yield `true`. With `range(0, 3) => $i`, `$i == $i` halts RILL-R002, but `$i -> .eq($i)` and `list[$i] -> .has($i)` yield `true`. Probed at c611430c | Collected |
| `values/equality.md` | `equality.kind` names an `any` operand, but no probed operand carries `any` | Collected in INCONSISTENCIES.md |
| `values/value.md`, `values/vacancy.md` | `value.kinds` omits iterators and vectors; an iterator or stream that yields nothing is not vacant; `value.no-alias` and `scope.late-binding` disagree | Collected in INCONSISTENCIES.md |
| `types/constructors/stream.md` | `stream.accepts`: a stream type accepts when its chunk and resolution types accept the stream's. The runtime compares them by equality. With `fn(x):stream(string):number { $x -> yield` then `1 } => $f` and `$f("a") => $s`, `$s -> :?stream(union(string, number))` and `$s -> :?stream(string):union(number, string)` yield `false`. A `stream(dict(a: number))` value fails `:?stream(dict)`, and a `stream(list(number))` value fails `:?stream(list)`. A `stream()` value passes `:?stream(number)`. `list["a"] -> :?list(union(string, number))` yields `true`. Probed at 289206aa | Collected |
| `scripts/reference/check.ts` | `grammar-syntax` drops the first production after a `text` fence. `parseProductions` splits the joined Syntax fences on `;` and keeps a statement only when it starts with `name =`. A `text` fence has no `;`, so its text joins the first production of the next `ebnf` fence. With the `text` fence first, `map.md`, `ordered.md`, and `tuple.md` failed for `map`, `ordered`, and `tuple`, while `map-entry` and `map-key` passed. Putting the `ebnf` fence first clears it. Probed at 289206aa | Collected |
| `types/constructors` | Dict method names as keys; dict duplicates through multi-key and computed keys; `.entries` on mixed values; the halt for unordered operands; extra stream arguments; a stream's printed form | Collected in INCONSISTENCIES.md |
| `types/model` | RILL-P014 from a non-type expression that starts with a type name; `number()` and `any(number)` differ by position; RILL-P001 for an outer on a scalar in a type position; `??` after an early missing read; the type a literal operand carries in an overlap check. Probed at 6cc38b29 | Collected in INCONSISTENCIES.md |
| `types/scalars` | The ISO 8601 subset `datetime` accepts; a fractional unix count truncates; a unix count drops time components; a string piped into `datetime` halts RILL-R036 while `duration` parses it. Probed at c7ef8720 | Collected in INCONSISTENCIES.md |
| `types/typing` | A bracket after a postfix bare-kind assertion; dict iteration under a carried type; the carried type of a `??` right operand; union defaults in conversion against a call. Probed at c2fdd19f | Collected in INCONSISTENCIES.md |
| `variables/scope.md` | A capture into a parameter inside its own body halts RILL-R001 as an outer rebinding; no rule says which scope a function body's parent is. Probed at 9b5a9c67 | Collected in INCONSISTENCIES.md |
| `expressions/selection.md` | `selection.at`: `.at` on a dict or an ordered halts RILL-R003, and the Errors row says Yes. `dict[a: 1].at(0)` and `ordered[a: 1].at(0)` halt RILL-R003 "Cannot call .at() on object" and escape `guard`. Shares the root cause of the `.keys` row above. Probed at 21eecdfb | Collected |
| `expressions` | A tuple or ordered literal is not a dispatch target, while a list or dict literal is; `spread.list-uniform` contradicts `inference.literal-union`; `spread.arg-positional` does not say whether positional arguments may precede the spread. Probed at 21eecdfb | Collected in INCONSISTENCIES.md |
| `control-flow/loop.md`, `control-flow/pass.md`, `control-flow/conditional.md` | A construct with no `$` bound reads a missing value instead of halting RILL-R005, which `loop.seed` requires, and which bare `pass` and `false ? "y"` raise. At the top level, `while (false) do { 1 } => $x` then `$x` prints `type(null)`, and its `.^type.name` is `"string"`. `do { 1 } while (false)` yields 1. `pass { 1 }` and `pass(ignore_halts: true) { 1 / 0 }` yield an empty printout. `? 1 ! 2` halts RILL-R002 "Piped conditional requires boolean, got string". Probed at 23491968 | Collected |
| `callables` | An empty `fn` body parses and halts RILL-R043 on call while every other empty block halts RILL-P004; `$d.a()` on a non-function field halts RILL-R007 while `$n()` halts RILL-R002; a call suffix after a method in a pipe target starts a new statement; `annotation-existence` omits the `&T` suffix the runtime accepts. Probed at 97c5b292 | Collected in INCONSISTENCIES.md |
| `collections` | `seq` and `acc` read an iterator lazily, so `break` beats the limit `iteration.sequential-limit` states for every kind; `fold` reads it eagerly while `acc` does not; `sort` key calls overlap with no `concurrency` option. Probed at 5d3bb63f | Collected in INCONSISTENCIES.md |
| `control-flow` | Which body `return` ends; `break` inside a called function; a bare `break` with no `$`; a halt in an async `pass` body; an empty `pass` body; `timeout` with no parentheses. Probed at 23491968 | Collected in INCONSISTENCIES.md |
| `errors/invalid-value.md` | `invalid-value.access`: an operator on an invalid value raises the halt it holds. An invalid value used directly as a bool operand halts RILL-R002 "requires boolean, got dict" instead. With `guard { 1 == "a" } => $r`, `!$r`, `$r && true`, `$r \|\| true`, `$r ? 1 ! 2`, `assert $r`, and `while ($r) do { 1 }` halt RILL-R002, while `$r -> ($ ? 1 ! 2)` and `$r == 1` raise `#TYPE_MISMATCH`. Probed at e7d4d0cd | Collected |
| `errors` | Text after `assert cond` starts a new statement while `error` rejects it; `.!foo` yields `""`; no rule lists the core error set; trace origin frames have no named vocabulary. Probed at e7d4d0cd | Collected in INCONSISTENCIES.md |
