# Known inconsistencies

*Observed disagreements in the reference, collected before anyone decides them.*

Each row is a disagreement between two built rules, or between a rule and the runtime. A row is a
candidate for a decision, never a rule. `pnpm ref lint` and `pnpm ref check` do not treat this file as a concept.

[#670](https://github.com/rcrsr/rill/issues/670) reviews every concept file and decides every row
here. 0.24.0 does not ship until it closes.

## Adding a row

1. Probe the behavior against `packages/core/dist`, per [CLAUDE.md](CLAUDE.md) "Probing the
   runtime". Put the evidence in the row: the source, the observed result, and the rules involved.
2. Group the row under a `##` heading per topic. Add a heading when no topic fits.
3. Name every concept the row touches in the Concept column.
4. Add the row even when the disagreement sits outside the file you are working on.

## Deciding a row

1. Bring the question to the owner with the rules involved, the evidence, and a proposed amendment.
2. File the issue that records the decision.
3. Write the decided behavior as a `{pending #N}` rule in the owning concept.
4. Remove the row. Remove the heading when no row remains under it.

A defect, where the runtime breaks a rule nobody disputes, is not a row here. File it as an issue.

## Host property functions and `self`

`selection.property` calls a host property function the host counterpart of a held block
(`code-block.access`). The two behave differently in each row below.

| Inconsistency | Held block | Host property function | Concept |
|---------------|------------|------------------------|---------|
| What the body sees on access | The enclosing `$` (`code-block.access`), so `$d.c` at top level halts RILL-R005. Dispatch binds the selector (`code-block.dispatch`) | The collection it is selected from, as `self`, under every selecting form | `selection`, `code-block` |
| Reads that select no entry | Halt `#TYPE_MISMATCH` (`code-block.non-selecting`) | Pass the function through uncalled: `.values`, `.entries`, and `seq` yield it as a value | `selection`, `code-block` |
| Receivers that run it | A list or tuple element runs on selection | Only a dict or ordered receiver runs it: `list[$p] => $l` then `$l[0]` returns it uncalled | `selection` |
| Shape of `self` | Not applicable | A dict arrives as a plain record, an ordered as its internal `__rill_ordered` form | `selection`, `host-boundary` |
| An argument replaces `self` | Not applicable | `self` is the function's first parameter, so `$d.f(1)` passes `1` as `self` and drops the receiver | `selection`, `invocation` |
| A bare call | Not applicable | `$p()` halts RILL-R044 naming the parameter `self`, not the rule that the function runs only when selected | `invocation` |

## Rules the runtime contradicts

Found by the slice 1 sweeps of [AUDIT.md](AUDIT.md) and probed on `main` at a897cfc3. In each row
the runtime may be the intended behavior, so the row is collected rather than filed as a defect.

| Inconsistency | Rule says | Runtime does | Concept |
|---------------|-----------|--------------|---------|
| Catchability of the 10,000-step iterator limit | `iteration.expansion` and its Errors row: RILL-R010, not catchable | `range(0, 20000) -> take(10001)` and `skip(10001)` halt RILL-R010 and `guard` catches it. `range(0, 10001) -> seq({ $ })` halts RILL-R010 and escapes `guard` | `iteration` |
| Interpolating a datetime | `interpolation.printed`: a value inserts as the string conversion yields it | `"at {$d}"` inserts `2024-01-15T00:00:00.000Z`, while `$d -> string` halts RILL-R036 | `interpolation`, `datetime`, `conversion` |
| An assertion suffix on a construct body | `code-block.assert`: a construct body asserts on every run | `5 -> pass { "a" }:string` halts `#TYPE_MISMATCH` "expected string, got number", and `0 -> while ($ < 3) do { $ + 1 }:?number` returns `true`: the suffix checks the construct's result | `code-block`, `pass`, `loop` |
| A non-callable operator argument | `iteration.callable`: halts `#TYPE_MISMATCH` | `start_when(5)`, `stop_when(5)`, and `chain(5)` halt RILL-R040, catchable. `seq(5)` halts `#TYPE_MISMATCH` | `iteration` |
| A filter predicate that returns an invalid value | `filter.bool`: a non-bool result halts `#TYPE_MISMATCH` | An invalid result halts RILL-R001 "filter: predicate returned an invalid value", catchable. A number result halts `#TYPE_MISMATCH` | `filter`, `invalid-value` |
