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
- [INCONSISTENCIES.md](INCONSISTENCIES.md) has no rows.
- The README "Test citation is incomplete during the pilot" sentence and the matching line in
  [CLAUDE.md](CLAUDE.md) "Tests" are removed.
- `pnpm ref lint`, `pnpm ref check`, `pnpm ref check --issues`, `pnpm test:examples`, and `pnpm check`
  pass on `main`.

## Progress

One row per PR. Tick a row when its PR merges.

| # | Slice | Files | Rules | Uncited | PR |
|---|-------|-------|-------|---------|----|
| 1 | Setup and sweeps | 68 | 837 | 606 | #675 |
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

## Backlog

What the sweeps found that no rule states yet, routed to the slice that owns it. A slice works its
backlog in the Complete and Cited columns: probe each item, then write a rule or record why none is
needed. Strike nothing here; the slice PR deletes the items it settles.

### `program`

- Grammar: `frontmatter`, `annotation`, `annotation-arg`, `annotation-args`, `annotated-expr`.
- Errors: RILL-P023 (malformed frontmatter close), RILL-R060 (removed frontmatter key).
- Tests: `frontmatter.test.ts`, `whitespace-continuations.test.ts`.
- Docs: frontmatter at the top of a script; the leading continuation set (`?`, `!`, `.name`,
  `.?`, beyond `->` and `=>`); a binary operator such as `&&` or `+` at line start halts
  RILL-P001; a block with statements on its brace lines; the script result as an exit code.
- Docs: an annotation on an argument or entry attaches to the function or held block.

### `types/constructors`

- Grammar: `list`, `list-element`, `dict`, `dict-element`, `dict-entry`, `dict-key`, `map`,
  `map-entry`, `map-key`, `ordered`, `ordered-element`, `tuple`, `tuple-element`, `fn-literal`,
  `fn-param`, `fn-type`, `body`.
- Tests: `anonymous-typed-closure.test.ts`, `anonymous-typed-closure-reflection.test.ts`,
  `bare-syntax.test.ts`, `dict.test.ts`, `dict-key-form.test.ts`, `dict-variable-keys.test.ts`,
  `string-dict-keys.test.ts`, `identifier-prototype-names.test.ts`.
- `dict`: a variable or computed key that is not a string halts RILL-R002; the 8 dict method
  names are reserved keys (`dict[len: 1]` halts RILL-R002); dicts have no ordering.
- `tuple`: tuples order lexicographically; a length or slot type mismatch halts `#TYPE_MISMATCH`.
- `fn`: the removed `|x|` and `||` literals and `:|x|:T` type (RILL-P012); no named `fn f(x)`
  form (RILL-P001); a default does not infer the parameter type; `fn().^type.inner` is
  `ordered[]`.
- `union`: `|` as a type separator halts RILL-P011. `stream`: `stream:number` equals
  `stream(any):number`.

### `types/model` and `types/typing`

- Grammar: `type-name`, `type-ref`, `type-ref-member`, `type-conversion`.
- Errors: RILL-R077 (invalid parameter default), RILL-R078 (removed `:>` conversion).
- `assertion`: `$l:list [0]` halts RILL-P001.
- `carried-type`: a declaration carries through pipe selection and destructure; a bare `list`,
  `list(any)`, or union projects no element type.

### `variables`

- Grammar: `variable`, `capture`, `capture-type`.
- Tests: `scope-isolation.test.ts`.
- `capture`: a target without `$` halts RILL-P001.

### `expressions`

- No concept owns the operators. Grammar: `expression`, `value-expr`, `logical-or`,
  `logical-and`, `comparison`, `comparison-op`, `additive`, `multiplicative`, `unary`,
  `postfix-expr`, `primary`, `grouped-expr`, `implicit-primary`. Docs: the precedence table.
- Grammar for `pipe`: `pipe-target`, `pipe-invoke`, `pipe-error`, `chain-terminator`. For
  `selection`: `field-access`, `bracket-access`, `property-access`, `method-call`,
  `method-name`. For `existence`: `existence-check`, `status-probe`.
- Tests: `expressions.test.ts`, `parameterized-destruct.test.ts`,
  `parameterized-existence.test.ts`.
- `selection`: a wrong key type on an ordered halts RILL-R002. `pipe`: a pipe target's result
  takes a postfix index (`sort[0]`). `dispatch`: an empty hierarchical path returns its input.

### `callables`

- Grammar: `fn-call`, `host-call`, `host-name`, `argument`, `arguments`.
- Errors: RILL-R043 (non-producing body).
- Tests: `args.test.ts`.
- `invocation`: a bare `name` statement is a call (RILL-R006); `name: value` arguments halt
  RILL-P001; a bare built-in name as an argument is a zero-argument call.
- `code-block`: `$c.name(args)` runs the held block, then calls its result; `.keys` and `.len`
  do not read held entries.
- `annotation-access`: `.^input` halts RILL-R008 naming `.^type.inner`.

### `control-flow`

- Grammar: `else-clause`, `loop`, `pass`, `pass-block`, `construct-options`, `timeout-block`.
- Errors: RILL-R079 and RILL-R080 (removed `@` loop forms), RILL-P010 (`@` expression),
  RILL-R082 and RILL-R083 (timeout expiry; the timeout rules name no error id).
- `break`: `break` in `sort` halts RILL-R002 and escapes `guard`.
- `construct-options`: bare `retry(3)` halts RILL-P001.

### `collections`

- `iteration`: an over-limit source halts before any body runs; `seq` and `acc` pull streams
  and iterators lazily, so `break` bounds them.

### `errors`

- Grammar: `guard-block`, `retry-block`.
- Errors: RILL-R084 (invalidation code outside the core error set).
- Tests: `trace-frames.test.ts`.
- `retry`: each failed attempt appends a `guard-caught` trace frame.
- `error-code` (in `types/scalars`): the 36 `#RILL_R###` atoms in the core set; no rule lists
  the set.

### `host-boundary`

- Errors: RILL-P020, RILL-P021, RILL-R050 to RILL-R053, RILL-R057, RILL-R062, RILL-R063,
  RILL-R076, RILL-R091.
- `use`: a `guard` around `use<>` catches RILL-R057; `app::fetch()` halts RILL-P012.
- Hosts cannot add error codes; `toNative` reports the own type; a default in a host signature
  string halts RILL-R091.

### `lexical` (write)

- Grammar: `digit`, `digits`, `nonzero-digit`, `positive-integer`, `letter`,
  `lowercase-letter`, `uppercase-letter`, `newline`, `literal`, `yaml-char`, `yaml-line`.
- Errors: RILL-L002, RILL-P002, RILL-P005, RILL-P009 (removed sigils).
- Tests: `lexer.test.ts`, `parser-recovery.test.ts`, `parser-spans.test.ts`,
  `parser-syntax-errors.test.ts`.
- Docs: `for` is not a keyword (RILL-R006); `.1` on a tuple halts RILL-P001; spaces around `.`
  and a tight `->` still parse.

### `limits` (write)

- Unstated: the output cap of `take`, `batch`, `window`, `start_when`, and `stop_when`; the
  `take` and `skip` step walk; call depth (`maxCallDepth`, 1000); calls in flight; the host
  `timeout` option (RILL-R012); parser nesting (RILL-P015, #673); `.repeat` and `.pad_*` result
  size; the datetime range (#673); the `use<>` branding cap (RILL-R090).
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
- Errors: RILL-R007 (undefined method, #672), RILL-R011 (regex), RILL-R040, RILL-R074 (vector).
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
  RILL-R086 to RILL-R089.
- Test files: `ref-llms-full-assertions.test.ts` checks `docs/`, not the language.

## Findings

Defects filed and decisions made during the audit. An omission or inconsistency fixed in a PR needs
no row; the PR names it.

| File | Finding | Outcome |
|------|---------|---------|
| `expressions/selection.md` | `.name` on a list, tuple, or string literal halts RILL-R007, not RILL-R003 (`selection.no-name`) | Filed #672 |
| `limits` | The timer ceiling, datetime range, and parser nesting limits apply inconsistently | Filed #673 |
| `docs/llm/`, error registry | Six doc claims and two error resolutions contradict the reference or runtime | Filed #674 |
| `collections/iteration.md` | RILL-R010 from `take` and `skip` is catchable; the Errors row says No | Collected in INCONSISTENCIES.md |
| `expressions/interpolation.md` | A datetime interpolates, but its string conversion halts RILL-R036 | Collected in INCONSISTENCIES.md |
| `callables/code-block.md` | A suffix on a construct body checks the construct's result, not each run | Collected in INCONSISTENCIES.md |
| `collections/iteration.md` | `start_when`, `stop_when`, and `chain` halt RILL-R040, not `#TYPE_MISMATCH` | Collected in INCONSISTENCIES.md |
| `collections/filter.md` | An invalid predicate result halts RILL-R001, not `#TYPE_MISMATCH` | Collected in INCONSISTENCIES.md |
