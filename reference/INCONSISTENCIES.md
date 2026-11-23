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

A defect, where the runtime breaks a rule nobody disputes, is not a row here. While the audit is
open it goes in the [AUDIT.md](AUDIT.md) Findings table; otherwise file it as an issue.

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

Found by the [AUDIT.md](AUDIT.md) slices and probed on `main` at a897cfc3 unless a row names another
commit. In each row the runtime may be the intended behavior, so the row is collected rather than
filed as a defect.

| Inconsistency | Rule says | Runtime does | Concept |
|---------------|-----------|--------------|---------|
| Catchability of the 10,000-step iterator limit | `iteration.expansion` and its Errors row: RILL-R010, not catchable | `range(0, 20000) -> take(10001)` and `skip(10001)` halt RILL-R010 and `guard` catches it. `range(0, 10001) -> seq({ $ })` halts RILL-R010 and escapes `guard` | `iteration` |
| Interpolating a datetime | `interpolation.printed`: a value inserts as the string conversion yields it | `"at {$d}"` inserts `2024-01-15T00:00:00.000Z`, while `$d -> string` halts RILL-R036 | `interpolation`, `datetime`, `conversion` |
| An assertion suffix on a construct body | `code-block.assert`: a construct body asserts on every run | `5 -> pass { "a" }:string` halts `#TYPE_MISMATCH` "expected string, got number", and `0 -> while ($ < 3) do { $ + 1 }:?number` returns `true`: the suffix checks the construct's result | `code-block`, `pass`, `loop` |
| A non-callable operator argument | `iteration.callable`: halts `#TYPE_MISMATCH` | `start_when(5)`, `stop_when(5)`, and `chain(5)` halt RILL-R040, catchable. `seq(5)` halts `#TYPE_MISMATCH` | `iteration` |
| A filter predicate that returns an invalid value | `filter.bool`: a non-bool result halts `#TYPE_MISMATCH` | An invalid result halts RILL-R001 "filter: predicate returned an invalid value", catchable. A number result halts `#TYPE_MISMATCH` | `filter`, `invalid-value` |
| `.name` on a receiver with no named fields | `selection.no-name`: `.name` on a list, tuple, or scalar halts RILL-R003 | `list[1].a`, `tuple[1, 2].a`, and `"abc".a` halt RILL-R007 "Unknown method", and the locked tests in `access-halt.test.ts` pin RILL-R007 for `"abc".bogus` and `5.bogus`. On a variable, `$l.a` and `$n.a` halt RILL-R003 | `selection` |
| An opener left unclosed at end of input | The RILL-P005 registry entry: a missing closing parenthesis, bracket, or brace | `(1 + 2` and `list[1, 2` halt RILL-P005. `{ 1`, `fn(x) {`, a bare `(`, and `dict[a:` halt RILL-P001. Probed at a70ec9dc | `token` |
| A carriage return with no line feed after it | `source-text.line-end` names only LF and CR LF | Outside a string, `1` CR `+ 2` returns 3 and a comment runs past it, so it acts as a space. Inside a one-line string it halts RILL-L001, pinned by `lexer.test.ts`. Probed at a70ec9dc | `source-text`, `string` |
| Whitespace between an angle-opener keyword and `<` | `use.adjacent` halts RILL-P007, and the RILL-P007 registry entry names `use<`, `destruct<`, and `slice<` | `list[1, 2] -> destruct <$a, $b>` and `slice <0:1>` halt RILL-P001. Probed at a70ec9dc | `use`, `destruct`, `slice` |
| Halts that carry only an error code | `halt.error-id`: every halt carries an error id | `1 == "1"` halts `#TYPE_MISMATCH` and a call after `dispose()` halts `#DISPOSED`, each a `RuntimeHaltSignal` with no `errorId`. `error`, `assert`, and RILL-R010 halts carry one. Probed at 0a3f5a6b | `halt` |
| A reserved annotation key reached through a spread | `annotation.reserved`: the keys `type` and `effective` are rejected with RILL-P001 | `dict[type: 1, effective: 2] => $o` then `^(...$o) fn(x) { $x } => $f` stores both: `$f.?^type` and `$f.?^effective` are `true`. Probed at 43a2995e | `annotation` |
| A string after the first annotation argument | `annotation.shorthand` and the `annotation-args` production: only a leading string is the description | `^(k: 1, "d") fn(x) { $x }` sets `description` to `"d"`, and `^("a", "b")` sets it to `"b"`. Probed at 43a2995e | `annotation` |
| Annotation argument values | The `annotation-arg` production: `identifier , ":" , literal`, with no spread | `annotation.values` and `annotation.spread` accept any expression and `...$d`, and the runtime agrees with them. Probed at 43a2995e | `annotation` |
| Characters on a frontmatter line | The `yaml-char` production allows letters, digits, and `: -_.[],'"` | `---`, `k: é 😀 @ # $ ! ;`, `---`, `1` returns `1`, and `frontmatter.test.ts` pins Unicode, `@`, `#`, `$`, and `!`. Probed at 43a2995e | `frontmatter` |

## Line continuation

Forms that read alike continue across a line ending in some places and not others. Probed at
43a2995e.

| Inconsistency | One form | The other form | Concept |
|---------------|----------|----------------|---------|
| A leading `.name` or `:type` | After a variable, a value literal, a grouped expression, or a member access it continues: `list[1, 2]` then `.len` yields `2`, and `5` then `:?number` yields `true`, both pinned by `whitespace-continuations.test.ts` and `statement-boundaries.test.ts` | After a `fn` literal both halt RILL-P001, and `fn(x) { $x }` then `.len` is pinned as two statements. After `-> number` `.^type` halts RILL-P001. After `-> { $ }` `.len` starts a statement and `:string` halts RILL-P001. After `true ? "ab" ! "c"`, `.len` joins the else branch and the result is `"ab"` | `statement`, `selection`, `assertion` |
| A trailing `.` | After a variable or a pipe target it continues: `$d.` then `a` yields `1`, and `"hello" -> .` then `upper` is pinned by `whitespace-continuations.test.ts` | After a literal it halts RILL-P001: `"ab".` then `len`, and `dict[a: 1].` then `a` | `statement`, `selection` |
| A leading `.?` | After a variable or an index it continues: `$d` then `.?a` yields `true` | After a literal it halts RILL-P001: `"ab"` then `.?len`, and `dict[a: 1]` then `.?a`. A leading `.name` continues after both | `statement`, `existence` |
| `.!` and `.?` across a line ending | A trailing `.!` continues: `$d.!` then `a` reads `$d.!a`. A leading `.?` continues after a variable | A leading `.!` halts RILL-P001: `$d` then `.!a`, and `5` then `.!`. A trailing `.?` does not continue: `$d.?` then `a` calls `a` and halts RILL-R006 | `statement`, `existence` |
| A trailing `??` | Every other binary operator continues: `1 +` then `2` yields `3` (`statement.trailing-operator`) | `1 ??` then `2` halts RILL-P001 "Unexpected token: newline", also inside `(...)` | `statement` |
| A leading binary operator inside brackets | At the top level of a statement it halts RILL-P001 (`statement.leading-operator`) | Inside `(...)` or `[...]` it halts RILL-P005: `(1` then `+ 2)`, `(true` then `&& false)`, and `dict[a: 1` then `+ 1]` | `statement` |

## Annotation and frontmatter forms

Probed at 43a2995e.

| Inconsistency | One form | The other form | Concept |
|---------------|----------|----------------|---------|
| An annotation before a type argument | `annotation.positions`: rejected before a `list` element type. `list(^(k: 1) number)`, `map(^(k: 1) string, number)`, `union(^(k: 1) number, string)`, and `fn(x: list(^(k: 1) number))` halt RILL-P001 | `stream(^(k: 1) number)` returns `stream(number)`, and `dict(a: list(^(k: 1) number))` returns `dict(a: list(number))` | `annotation` |
| Where `^(limit: N)` is rejected | `annotation.limit-in-call`: before a function argument it halts RILL-R081 | It halts RILL-R081 before any annotated expression: a dict entry, a list element, and a conditional branch. At statement level `^(limit: 5) fn(x) { $x } => $f` is accepted and `$f.^limit` is `5` | `annotation` |
| Text after a frontmatter delimiter | The `frontmatter` production: each delimiter is `---` then a line ending. A closing `----` halts RILL-P023 (`frontmatter.extra-dash`) | An opening `----` or `--- x` is accepted and `-` or `x` becomes the first line of frontmatter text. A closing `--- 2` is accepted and `2` runs as a statement | `frontmatter` |
