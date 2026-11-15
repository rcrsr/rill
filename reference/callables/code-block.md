---
id: code-block
title: Code blocks
status: normative
since: 0.24.0
issues: [568, 575, 624]
grammar: [block]
errors: [RILL-R005, TYPE_MISMATCH]
depends: [dispatch, selection, fn, assertion]
tests: [block-scoping.test.ts, pipe-targets.test.ts, closure-auto-invoke.test.ts, conditionals.test.ts]
---

# Code blocks

A code block is a braced body that control flow reaches directly, so it runs where it is
written and is never a value.

## Syntax

```ebnf
block = "{" , statement , { statement } , "}" ;
```

A block is a code block when nothing in front of it makes it a function. `fn(...)` in front makes a
function literal, stated in `fn`. A block that is a whole argument converts to a function,
stated in `fn.block-type`. Every other block is a code block.

## Static rules

r[code-block.positions] A block outside a function literal or an argument is a code block
A block MUST be a code block when it is a construct body, a pipe target, the head of a chain, a
statement, alone in parentheses, or an entry of a collection literal.

## Evaluation

r[code-block.not-value] A code block is never a value {pending #575}
A code block MUST NOT be bound by a capture, returned as a result, or passed on by a pipe.
Each position below runs it or holds it, and nothing else reads it.

r[code-block.construct] A construct body runs under its construct
A code block that is the body of `? !`, `while`, `do`, `guard`, `retry`, `timeout`, or `pass`
MUST run as that construct directs.

r[code-block.pipe-target] A pipe target block runs with the pipe value
`v -> { body }` MUST run `body` once with `$` bound to `v`, and the chain MUST continue with
its result.

r[code-block.head] A head block runs where it is written {pending #575}
A code block at the head of a chain or as a statement MUST run once, with `$` bound to the
enclosing `$`. `{ 5 } => $x` MUST bind 5.

r[code-block.parens] A block alone in parentheses runs {pending #575}
`({ body })` MUST run `body` as a head block does. Parentheses only group.

r[code-block.no-params] A code block has no parameters
A code block MUST NOT declare or receive parameters. `$` and `$@` inside it MUST resolve
lexically to the bindings around it.

r[code-block.unbound] Reading an unbound $ halts
Reading `$` or `$@` in a code block where the enclosing scope binds none MUST halt with
RILL-R005.

r[code-block.held] A collection entry holds the block uncalled {pending #568}
A code block written as a dict value, an ordered value, a map value, a list element, or a
tuple element MUST be held as a code block. It MUST NOT convert to a function.

r[code-block.dispatch] Dispatch runs a held block with the selector
`sel -> $c` that selects a held block MUST run it with `$` bound to `sel`, and yield its result.

r[code-block.access] Access runs a held block with the enclosing $ {pending #568}
`$c.name`, `$c.$k`, and `$c[sel]` that select a held block MUST run it with `$` bound to the
enclosing `$`, and yield its result.

r[code-block.access-target] In a pipe target the enclosing $ is the piped value {pending #568}
Access written as a pipe target MUST run a held block with `$` bound to the piped value.
With `dict[n: 2, double: { $.n * 2 }] => $d`, `$d -> $d.double` MUST yield 4.

r[code-block.non-selecting] A read that selects no entry halts on a held block {pending #568}
Iteration, `.values`, `.entries`, `.first`, spread, equality, interpolation, and host conversion
that reach a held block MUST halt with `#TYPE_MISMATCH` naming the entry. `.^type` and a type
lock MUST see a held entry as `fn()`.

r[code-block.each-time] A held block runs on every selection
Each selection of a held block MUST run it again.

## Interactions

A code block yields its last statement (`statement.result`), and `return` ends it early
(`break.return-body`). A block after `->` reads its input (`pipe.uses-value`).

Storing a function needs `fn` in front of the block: `fn { 5 } => $x` binds a function
(`fn.bare-literal`), where `{ 5 } => $x` binds 5. A function written with `fn` as an entry is
a value, and selecting it returns it uncalled (`dispatch.fn`). A block passed as a whole
argument is a function, not a code block, and takes the unnamed parameters its body reads
(`fn.block-type`). An assertion on such a block sets the function's outer (`fn.block-outer`).

r[code-block.assert] An assertion on a code block checks its result {pending #575}
`{ body }:T` MUST run the block where its position runs it, then assert its result against
`T` as any assertion does (`assertion.pass`, `assertion.mismatch`). A pipe target, a head
block, a block in parentheses, a construct body, and a selected entry each assert on every run.

r[code-block.check] A check on a code block tests its result {pending #575}
`{ body }:?T` MUST run the block, then yield whether its result has type `T`.

r[code-block.assert-scope] The assertion covers the whole block {pending #575}
A `:T` or `:?T` after the closing brace MUST apply to the block's result, never to its last
statement. `$a -> { ... }:number -> .x` MUST assert before `.x` reads the value.

r[code-block.assert-construct] A construct body accepts an assertion {pending #575}
`true ? { 5 }:number ! { 6 }` MUST parse, and MUST assert the branch that runs.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `$` or `$@` read where none is bound | RILL-R005 | Yes |
| A code block's result fails its assertion {pending #575} | `#TYPE_MISMATCH` | Yes |
| A read that selects no entry reaches a held block {pending #568} | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
3 -> { $ + 1 }
# Result: 4
```

```rill
3 -> {
  "big" -> return
  "after"
} -> .upper
# Result: "BIG"
```

```rill
list[1, 2] -> fold(0, { 1 -> { $@ + $ } })
# Result: 2
```

```rill
"a" -> dict[a: { "got {$}" }]
# Result: "got a"
```

```rill pending=575
{ 5 } => $x
$x
# Result: 5
```

```rill pending=575
3 -> { $ + 1 }:number -> { $ * 2 }
# Result: 8
```

```rill pending=624
fn { 5 } => $x
$x()
# Result: 5
```

```rill pending=568
7 -> {
  dict[a: { $ + 1 }] => $d
  $d.a
}
# Result: 8
```

## Notes

On 0.23.0 a head block, a block alone in parentheses, and a collection entry are wrapped into a
function: `{ 5 } => $x` binds a closure, `$d.a` returns one, and `3 -> { 5 }` yields 5. An
assertion after a block tests the closure, so `3 -> { $ + 1 }:number` halts `#TYPE_MISMATCH`
(got closure), `:?number` yields false, and `true ? { 5 }:number ! { 6 }` halts RILL-P001.

Superseded: `code-block.ignores-input`, now stated by `pipe.uses-value`.

