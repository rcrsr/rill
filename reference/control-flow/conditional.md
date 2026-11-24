---
id: conditional
title: Conditional
status: normative
since: 0.24.0
issues: []
grammar: [conditional, else-clause, body]
errors: [RILL-P006, RILL-R002, RILL-R005]
depends: []
tests: [conditionals.test.ts, parser-syntax-errors.test.ts]
---

# Conditional

A conditional `cond ? then ! else` runs one of two bodies, chosen by a bool.

## Syntax

```ebnf
conditional = body , "?" , body , [ "!" , else-clause ] | "?" , body , [ "!" , else-clause ] ;
else-clause = conditional | body ;
body        = block | grouped-expr | postfix-expr ;
```

```text
cond ? a ! b          standalone: cond is evaluated
v -> ? a ! b          piped: v is the condition
v -> (cond) ? a ! b   piped: cond is evaluated with $ bound to v
c1 ? a ! c2 ? b ! d   else-if chain
```

`?` and `!` may begin a line, continuing the conditional from the line before.

## Static rules

r[conditional.branch-shape] A branch is a block, a group, or a postfix expression
Each branch MUST be a code block, a grouped expression, or a postfix expression. A branch that is
a binary expression, such as `true ? 1 + 1 ! 2`, MUST be rejected with RILL-P006.

## Evaluation

r[conditional.bool] The condition is a bool
The condition MUST be a bool. Any other value MUST halt with RILL-R002. No value converts to a
condition.

r[conditional.branch] Exactly one branch runs
`cond ? a ! b` MUST evaluate `a` when `cond` is true and `b` when it is false, and MUST NOT
evaluate the other. The conditional yields the value of the branch that ran.

r[conditional.piped] A piped conditional tests the pipe value
`v -> ? a ! b` MUST use `v` as the condition. `$` inside either branch MUST be `v`.

r[conditional.dollar] Branches see the incoming $
In every form, `$` inside a branch MUST be the `$` bound where the conditional stands.

r[conditional.no-else] A missing else yields the incoming $
`cond ? a` with a false `cond` MUST yield the `$` bound where the conditional stands. With no
`$` bound, it MUST halt with RILL-R005.

r[conditional.chain] An else clause may be a conditional
`c1 ? a ! c2 ? b ! d` MUST test `c2` only when `c1` is false.

r[conditional.block] A branch may be a code block
A branch written as a code block MUST run as a construct body (`code-block.construct`).

## Interactions

`pass` in a branch yields the incoming `$` unchanged (`pass`). A bool literal cannot follow `->`
directly (`pipe.no-literal`), so a constant condition after a pipe is grouped: `v -> (true ? a ! b)`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A branch is a binary expression | RILL-P006 | No |
| The condition is not a bool | RILL-R002 | Yes |
| A missing else runs where no `$` is bound | RILL-R005 | Yes |

## Examples

```rill
5 -> ($ > 3) ? { $ * 2 } ! { $ }
# Result: 10
```

```rill
"B" -> .eq("A") ? "a" ! .eq("B") ? "b" ! "other"
# Result: "b"
```

```rill
5 -> (false ? "skipped")
# Result: 5
```

```rill
false ? $nope ! 1
# Result: 1
```

```rill
# Error: must be boolean
"" ? 1 ! 2
```
