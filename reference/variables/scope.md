---
id: scope
title: Scope
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R001, RILL-R005]
depends: [variable, capture, statement]
tests: [block-scoping.test.ts, closure-hoist-validation.test.ts, late-bound-closures.test.ts]
---

# Scope

A scope is the region whose captures a name belongs to; inner scopes read outer variables and
never rebind them.

## Evaluation

r[scope.child] Bodies and groups open a child scope
A code block, a construct body, a function body, and a parenthesized expression MUST each run
in a new scope whose parent is the scope around it.

r[scope.iteration] Each loop iteration gets a fresh scope
Each run of a loop body or a collection operator's function MUST start a new scope, so a
variable bound in one iteration is not visible in the next.

r[scope.read-outer] An inner scope reads outer variables
A reference MUST resolve to the nearest enclosing scope that binds the name.

r[scope.no-rebind] An inner scope does not rebind an outer variable
A capture in a child scope into a name an enclosing scope binds MUST halt with RILL-R001.

r[scope.no-leak] A variable does not outlive its scope
A variable bound in a child scope MUST NOT be visible after that scope ends. Reading it MUST
halt with RILL-R005.

r[scope.siblings] Sibling scopes reuse names
Two scopes that do not enclose each other MAY bind the same name independently.

r[scope.later-outer] An outer scope may bind a name a finished child used
After a child scope ends, its enclosing scope MAY bind a name the child bound.

r[scope.parameter] A parameter may shadow an outer variable
A function parameter MUST be bound in the function's own scope, and reading it MUST yield the
argument even when an enclosing scope binds the same name.

r[scope.late-binding] A function resolves names when it runs
A function body MUST resolve each variable it reads when the body runs, not when the function
is created. A name bound after the function was created is visible to it.

r[scope.recursion] A function reaches itself through its variable
A function stored in `$f` MUST be able to call `$f` from its body, because the name resolves
at call time.

## Interactions

The same-scope rebinding rule, and its type lock, is stated in `capture.rebind` and
`type-lock`. A loop accumulates through `$` (`loop.accumulate`), never by rebinding an outer variable
(`scope.no-rebind`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A child scope captures into an outer variable | RILL-R001 | Yes |
| A variable is read after its scope ended | RILL-R005 | Yes |

## Examples

```rill
10 => $x
list[1, 2] -> seq({ $x + $ })
# Result: list[11, 12]
```

```rill
1 => $y
|| { $y } => $f
2 => $y
$f()
# Result: 2
```

```rill
|n| { ($n < 1) ? 0 ! ($n + $sum($n - 1)) } => $sum
$sum(3)
# Result: 6
```

```rill
1 => $x
|x| { $x } => $f
$f(2)
# Result: 2
```

```rill
# Error: Cannot reassign outer variable
0 => $count
list[1, 2] -> seq({ $count + 1 => $count })
```

```rill
# Error: Undefined variable
1 -> { 2 => $t }
$t
```

## Notes

`docs/topic-variables.md` says a loop that captures into an outer name creates a local
variable and leaves the outer one at 0. The runtime halts RILL-R001 instead, as
`scope.no-rebind` states (#610).
