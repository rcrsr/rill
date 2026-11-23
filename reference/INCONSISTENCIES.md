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
| An operand that carries `any` | `equality.kind`: an `any` operand compared with a value of another kind yields false. `carried-type.element` gives an element of a `list(any)` the element type `any` | `1 => $x:any` then `$x == "a"`, `fn(x: any) { $x == "a" }` called with `1`, and `list[1, "a"] => $l:list(any)` then `$l -> seq({ $ == "a" })` each halt `#TYPE_MISMATCH` "Cannot compare number with string", catchable. No probed form makes an operand carry `any`. Probed at c611430c | `equality`, `carried-type`, `any` |

## Values

Rules in the `values` chapter that disagree with another rule or leave a probed case unstated.
Probed at c611430c.

| Inconsistency | One form | The other form | Concept |
|---------------|----------|----------------|---------|
| Kinds the value list omits | `value.kinds` lists every kind a value can have, with error code apart from atom | `range(0, 3).^type.signature` is `"iterator"`, and `iteration.source-kinds` names iterators. Hosts supply vectors. `#TIMEOUT.^type.signature` is `"atom"` | `value`, `iteration`, `error-code` |
| A source that yields nothing | An empty list, string, dict, tuple, ordered, or map is vacant, so `list[] ?? 5` yields `5` (`vacancy.empty`) | `range(0, 0) ?? 5` yields the iterator, and a host stream with no chunks passes `??` unchanged. `.empty` on either halts RILL-R003, catchable. `vacancy.empty` names neither kind | `vacancy`, `iteration` |
| A function and a later rebinding | `value.no-alias`: rebinding a variable does not change the value a function or collection holds. `equality.function` compares the values captured variables hold | `scope.late-binding`: `"a" => $x`, `fn { $x } => $f`, `list[$f] => $l`, `"b" => $x`, then `$l[0]()` yields `"b"`. Two functions built before and after the rebinding compare equal | `value`, `equality`, `scope` |

## Type constructors

Rules in the `types/constructors` chapter that disagree with another rule or leave a probed case
unstated. Probed at 289206aa.

| Inconsistency | One form | The other form | Concept |
|---------------|----------|----------------|---------|
| Dict method names as keys | `dict.key-spelling`: a dict type accepts every key spelling a literal accepts. `dict[len: 1]`, `dict["len": 1]`, `[len: 1]`, and `ordered[keys: 1]` halt RILL-R002, catchable, for each of `len`, `first`, `empty`, `eq`, `ne`, `keys`, `values`, `entries`, and `map["len": 1] -> dict` halts RILL-R036 | `dict(len: number)` and `ordered(len: number)` are types, and `dict[] -> dict(len: number = 1)` yields `dict[len: 1]`, a dict holding the key. Brand keys such as `__type` halt RILL-R002 in both the literal and the type | `dict`, `ordered`, `map`, `defaults` |
| A dict key reached twice through a multi-key list or a computed key | `dict.key-duplicate`: a literal that spells one key twice halts RILL-P027. In a map, a literal element of a multi-key list counts (`map.duplicate-parse`), and a computed duplicate halts `#INVALID_INPUT` (`map.duplicate-run`) | `dict[["a", "b"]: 1, a: 2]` yields `dict[a: 2, b: 1]`, `dict[["a", "a"]: 1]` yields `dict[a: 1]`, and `"k" => $k` then `dict[$k: 1, k: 2]` yields `dict[k: 2]`. `ordered` behaves the same | `dict`, `dict-literal`, `map` |
| `.entries` on a dict whose values differ in type | `dict.entries-type`: values of type `V` give `list(tuple(string, V))` | `dict[a: 1, b: "x"].entries.^type.signature` is `"list(union(tuple(string, number), tuple(string, string)))"`, a union of tuples, not `list(tuple(string, union(number, string)))` | `dict`, `inference` |
| The halt for operands with no order | `dict.no-order`, `list.no-order`, `ordered.no-order`, `number.no-coercion`, and `string.cross-order` halt RILL-R002 | `tuple[1, 2] < tuple[1, 2, 0]`, `tuple[1, "a"] < tuple[1, 2]`, and `tuple[true] < tuple[false]` halt `#TYPE_MISMATCH`, catchable; `tuple[1] < list[2]` halts RILL-R002. `sort.incomparable` halts `#TYPE_MISMATCH` for the same pairs | `tuple`, `dict`, `list`, `sort` |
| Extra arguments to a stream type | `list.argument-count` and `tuple.unnamed`: a second or named argument halts `#INVALID_INPUT`. `stream.slots` names only `stream(T):R` | `stream(number, string)` yields `stream(number):string`, and `stream(a: number)` yields `stream(number)`, the name dropped. `defaults.element` names `stream(number, string = "x")` as a form | `stream`, `list`, `defaults` |
| The printed form of a stream | `string.md` and `interpolation.printed` state a printed form for each collection; no rule states one for a stream | `$s -> string` and `"{$s}"` yield `type(stream)` for a stream from `fn(x):stream(string):number { $x -> yield ... }` | `stream`, `string`, `interpolation` |

## Type model

Rules in the `types/model` chapter that disagree with another rule, the grammar, or the runtime,
or leave a probed case unstated. Probed at 6cc38b29.

| Inconsistency | One form | The other form | Concept |
|---------------|----------|----------------|---------|
| A non-type expression that starts with a type name inside an inner | `type-form.argument-literal`: a non-type expression inside an inner raises RILL-P001, as `list(1 + 1)` and `list("a")` do | `list(number + 1)` and `list(number -> :type)` halt RILL-P014 "Expected ',' or ')' in type argument list", which the `type-form` Errors table does not name | `type-form` |
| Parentheses after a type name that takes no inner | `type-value.contexts`: a type form yields one type value in every position. `5 -> :string(number)` halts "string does not accept type arguments" | `5 -> :number()`, `5 => $x:number()`, `fn(x: number()) { $x }`, and `list(number())` accept `number()`, while `number()` as an expression halts RILL-R006 "Unknown function", catchable. `5 -> :any(number)` halts `#INVALID_INPUT`; `any(number)` halts RILL-R006 | `type-value`, `type-form`, `any` |
| An outer on a scalar in a type position | The `type-form` Errors table: an outer on a type that takes none raises RILL-P006, as `5 -> :list(number):string` does | `5 -> :number:string` and `5 => $x:number:string` halt RILL-P001 "Unexpected token: :". As an expression, `number:string` asserts the type value `number` against `string` and halts `#TYPE_MISMATCH` | `type-form` |
| `??` after a chain that reads a missing property early | `introspection.fallback`: `??` supplies its right operand when the left side reads a property the type lacks | `number.inner ?? any` yields `any`, but `number.inner.inner ?? 3` and `number.inner.name ?? 3` halt RILL-R003. Dicts agree: `dict[a: dict[]].a.c ?? 3` yields `3`, and `dict[a: 1].b.c ?? 3` halts RILL-R009. Only a miss on the last read recovers | `introspection`, `vacancy` |
| The type a literal operand carries in an overlap check | `structural-typing.overlap-literal`: a literal type overlaps its scalar kind. `equality.closed-set` halts only when the union is all literals | With `"a" => $x:union("a", number)`, `$x == "b"` and `"b" == $x` halt `#TYPE_MISMATCH` "Cannot compare union(number, "a") with string", and so does `"b" => $s` then `$s == $x`. `"b" => $s:string` then `$s == $x` yields `false`. The operand acts as the literal `"b"`, but the message names `string` | `structural-typing`, `equality`, `carried-type` |

## Scalar types

Rules in the `types/scalars` chapter that disagree with an equivalent form, or leave a probed case
unstated. Probed at c7ef8720.

| Inconsistency | One form | The other form | Concept |
|---------------|----------|----------------|---------|
| Which ISO 8601 strings `datetime` accepts | `datetime.invalid`: a string that is not ISO 8601 halts `#INVALID_INPUT`. `datetime("2026-03-13T02:00Z")`, with no seconds, and `datetime("2026-03-13T02:00:00.5Z")` are accepted | `datetime("2026-03")` (reduced precision), `datetime("20260313")` (basic format), and `datetime("2026-03-13 02:00:00Z")` halt `#INVALID_INPUT`, though the first two are ISO 8601. No rule names the accepted subset | `datetime` |
| A fractional datetime count | `datetime.out-of-range`: a component outside its range halts. `datetime(...dict[year: 2026, month: 3, day: 1.5])` halts `#INVALID_INPUT` | `datetime(...dict[unix: 1.5])` yields `1970-01-01T00:00:00.001Z`, the count truncated. No rule says whether `unix` must be an integer | `datetime` |
| A unix count with a time component | `datetime.one-form`: a unix count with `year`, `month`, or `day` halts `#INVALID_INPUT` | `datetime(...dict[unix: 0, ms: 1])` yields `1970-01-01T00:00:00.000Z`, silently dropping `ms`. `hour`, `minute`, and `second` beside `unix` are dropped the same way | `datetime` |
| A string piped into a time type | `duration.from-pipe`: `"500ms" -> duration` parses as `duration("500ms")` does | `"2026-03-13" -> datetime` halts RILL-R036, though `datetime("2026-03-13")` parses. `datetime -> string` also halts (`string.from-datetime`), while `duration -> string` converts | `datetime`, `duration`, `string` |

## Typing

Rules in the `types/typing` chapter that disagree with an equivalent form, or leave a probed case
unstated. Probed at c2fdd19f.

| Inconsistency | One form | The other form | Concept |
|---------------|----------|----------------|---------|
| A bracket after a postfix assertion | After a type with arguments it indexes the asserted value: with `list[1] => $l`, `$l:list(number)[0]` yields `1` | After a bare kind it halts RILL-P001 "Expected type name", with or without a space: `$l:list[0]`, `$l:list [0]`, and `$l:?list [0]`. `($l:list)[0]` yields `1` | `assertion`, `declaration` |
| Iterating a dict with a carried type | `carried-type.element`: a read by `[i]`, `.name`, `.$k`, or iteration gives the part the asserted field type. With `$d:dict(a: union(number, string))` holding `dict[a: 1]`, `$d.a` and `$d.$k` carry `union(number, string)` | `$d -> seq({ $.value.^type.signature })` yields `list["number"]`, and each entry carries `dict(key: string, value: number)`. No rule says whether a dict's iteration element is the entry or the field value | `carried-type`, `iteration` |
| The carried type of a `??` right operand | `carried-type.fallback`: `a ?? b` yields the selected operand with its carried type. The left operand keeps it: with `1 => $x:union(string, number)`, `($x ?? 2).^type.signature` is `"union(number, string)"` | When `??` selects its right operand the type drops: with `dict[a: 1] => $d`, `($d.zz ?? $x).^type.signature` is `"number"`, and `($d.zz ?? $x) => $y` then `"a" => $y` halts RILL-R001 "locked as number". `declared-types.test.ts` "takes the own type for the ?? default branch" pins the drop | `carried-type`, `type-lock` |
| Defaults from a union member, conversion against call | `defaults.hydration-union` and `defaults.hydration-tie`: hydration against a union takes the narrowest accepting member's defaults, ties broken by canonical order. A call does: with `$f` taking `union(dict(a: number, c: number = 7), dict(a: number, b: number = 9))`, `$f(dict[a: 1])` yields `dict[a: 1, b: 9]` | `conversion.union`: a value that has a member passes unchanged. `dict[a: 1] -> union(dict(a: number, b: number = 9), dict(a: number, c: number = 7))` yields `dict[a: 1]`, also as a field of a dict conversion. The `defaults` example fills only because `union.reduce` leaves one member | `defaults`, `conversion`, `union` |

## Variables

Rules in the `variables` chapter that leave a probed case unstated. Probed at 9b5a9c67.

| Inconsistency | One form | The other form | Concept |
|---------------|----------|----------------|---------|
| A capture into a parameter inside its body | `scope.parameter`: a parameter is bound in the function's own scope. `capture.rebind`: a capture into a variable bound in the same scope replaces it | `fn(x) { 2 => $x` then `$x } => $f`, then `$f(1)` halts RILL-R001 "Cannot reassign outer variable $x from child scope", catchable. `fn(x: number)` with `"a" => $x` halts the same way. The body acts as a child of the parameter scope, and `scope.child` does not say which scope a function body's parent is | `scope`, `capture`, `fn` |

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
