---
id: pipe
title: Pipe
status: normative
since: 0.24.0
issues: []
grammar: [pipe-chain]
errors: [RILL-P001, RILL-P030, RILL-P031, RILL-R002, RILL-R005, RILL-R045]
depends: [statement, dispatch, conversion, assertion]
tests: [pipe-targets.test.ts, unified-dispatch.test.ts, conversion.test.ts, closure-semantics.test.ts, late-bound-closures.test.ts, use-expr.test.ts]
---

# Pipe

A pipe `v -> target` evaluates its target with the incoming value `v`, by the kind of the target.

## Syntax

```ebnf
pipe-chain = value-expr , [ "?" , body , [ "!" , body ] ] , { ( "->" , ( pipe-target | capture ) ) | ( "=>" , capture ) } , [ "->" , chain-terminator ] ;
```

```text
"5" -> number         type: converts
0 -> list["a", "b"]   data: selects
3 -> { $ + 1 }        computation: takes the value as input
5 -> "x{$}"           string: built with $ bound
```

## Static rules

r[pipe.no-literal] A number, a bool, or an atom is not a target
A number, bool, or atom literal after `->` MUST be rejected with RILL-P001.

r[pipe.uses-value] A target uses the piped value
A code block whose body does not read the pipe value and a string that does not interpolate `$`
MUST be rejected with RILL-P031 before the script runs. A body reads the pipe value when it writes
`$`, starts a chain with a method such as `.upper`, or uses `pass`. A call with no arguments does not
read it: `5 -> { f() }` MUST be rejected. `5 -> "x"` and `3 -> { 5 }` MUST be rejected.

r[pipe.zero-param] A function of no parameters halts when piped into
`v -> $f` MUST halt with RILL-R045 when `$f` is a function of no parameters, because the value
is an excess argument. A block closure, which takes the value as `$`, is not such a function.

r[pipe.data-no-dollar] A data literal target does not read $
A list or dict literal used as a target MUST NOT read `$` at its top level, and MUST be rejected
with RILL-P030 before the script runs. The message MUST name the block form, such as
`3 -> { list[$, $] }`. A `$` inside a nested block does not count.

## Evaluation

r[pipe.left-to-right] A chain evaluates left to right
Each `->` MUST evaluate its target with the value the chain has produced so far, and the chain
MUST continue with the result.

r[pipe.type] A type target converts
`v -> T` MUST convert `v` to `T`, as `conversion` states.

r[pipe.data] A data target selects
`v -> c` for a list, dict, tuple, ordered, or map `c` MUST select with `v`, as `dispatch` states.

r[pipe.block] A code block target runs with the value
`v -> { body }` MUST run the block with `$` bound to `v`, as `code-block.pipe-target` states.

r[pipe.function] A function target is called with the value
`v -> $f` MUST call `$f` with `v` as its one argument.

r[pipe.method] A method target applies to the value
`v -> .m` and `v -> .m(args)` MUST call the method `m` on `v`.

r[pipe.string] A string target is built with the value
`v -> "..."` MUST evaluate the string with `$` bound to `v`.

r[pipe.call-operand] A call target receives the value first
`v -> f(args)` and `v -> f` MUST call `f` with `v` prepended to `args`, for a built-in or host
function `f`. Only a call written as the target receives `v`. A call inside a target's body, a
branch, or a callback receives only the arguments written.

r[pipe.call-dollar] A written $ argument replaces the prepended operand
When an argument of a call target is a top-level `$`, the value MUST NOT be prepended, and
each such `$` MUST be `v`. `5 -> range(0, $)` MUST equal `range(0, 5)`. A `$` inside a conditional,
guard, retry, timeout, or pass body in an argument counts as written. A `$` inside a nested
pipe target in an argument does not, so `5 -> f(2 -> g($))` prepends `5`.

r[pipe.script-operand] A script function target receives the value first
`v -> $h(args)` MUST call `$h` with `v` prepended to `args`, as `pipe.call-operand` states. A spread
argument, as in `v -> $h(...$t)`, is the exception: `v` is not prepended, and the spread supplies
every argument.

r[pipe.grouped] A parenthesized target is a grouped expression
`v -> (expr)` MUST evaluate `expr` with `$` bound to `v`.

r[pipe.variable] A variable target acts as its value
`v -> $x` MUST do what the value of `$x` calls for as a target. An undefined `$x` MUST halt
with RILL-R005.

r[pipe.variable-kind] A variable that holds no target kind halts
`v -> $x` MUST halt with RILL-R002 when `$x` holds a value that is not a function, a type, or a
data value `pipe.data` names. The message MUST name the variable and the kind it holds, as in
`cannot pipe into $n: it holds a number`. When the target selects through an access chain, as in
`3 -> $d.a`, the message MUST name the variable and the kind of the selected value, as in
`cannot pipe into a value selected from $d: it is a number`.

## Interactions

A conditional or a loop after `->` takes the value as its input (`conditional.piped`,
`loop.seed`). `-> :T` and `-> :?T` assert and check rather than convert (`assertion`). A capture in a
chain binds and passes the value on (`capture`). A function target binds its arguments as
`invocation` states.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A number, bool, or atom literal is a target | RILL-P001 | No |
| A list or dict literal target reads `$` at its top level | RILL-P030 | No |
| A block or string target does not read the piped value | RILL-P031 | No |
| A function of no parameters is a target | RILL-R045 | No |
| A variable target is undefined | RILL-R005 | Yes |
| A variable target holds no target kind | RILL-R002 | Yes |

## Examples

```rill
"5" -> number -> { $ + 1 }
# Result: 6
```

```rill
list[1, 2, 3] -> take(2)
# Result: list[1, 2]
```

```rill
3 -> range(0, $) -> seq({ $ })
# Result: list[0, 1, 2]
```

```rill
5 -> ($ > 3) ? "big" ! "small"
# Result: "big"
```

```rill
# Error: Expected pipe target
5 -> 3
```

```rill
# Error: RILL-P031 the string never reads the piped value
5 -> "x"
```

```rill
# Error: RILL-P030 a literal target cannot read $
3 -> list[$, $]
```

```rill
fn() { 1 } => $zero
# Error: RILL-R045 Function expects 0 arguments, got 1
5 -> $zero
```

```rill
3 => $n
# Error: cannot pipe into $n
5 -> $n
```

## Notes

On 0.23.0 a target that ignores the value runs: `5 -> "x"` yields `"x"` and `3 -> { 5 }` yields
5. `3 -> list[$, $]` builds `list[3, 3]` and indexes it with 3, halting RILL-R009. A function of no
parameters drops the value or binds it to `$`. A script function does not receive the operand:
`3 -> $h(4)` halts RILL-R044, and `3 -> $h($, 4)` works.
On 0.23.0 a call with no arguments where `$` is bound received `$` as its first argument.
On 0.23.0 `5 -> $n` for a number `$n` halts RILL-R002 `Cannot dispatch to number`.
