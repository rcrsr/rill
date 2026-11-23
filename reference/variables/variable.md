---
id: variable
title: Variables
status: normative
since: 0.24.0
issues: []
grammar: [identifier]
errors: [RILL-L003, RILL-P001, RILL-R005]
depends: [identifier, capture, statement]
tests: [capture-types.test.ts, late-bound-closures.test.ts]
---

# Variables

A variable is a name written `$name` that holds one value, bound by a capture.

## Syntax

```ebnf
identifier = ( letter | "_" ) , { letter | digit | "_" } ;
```

A variable is `$` followed by an identifier (`identifier.form`): `$total`, `$_tmp`, `$row2`.

## Static rules

r[variable.sigil] A variable carries the $ sigil
Every variable reference and every capture MUST write `$` before the name. A bare identifier
MUST NOT name a variable; it is a dict key, a keyword, a type name, or a function.

r[variable.name] A name starts with a letter or underscore
`$` followed by a digit MUST be rejected with RILL-L003.

r[variable.reserved] $ and $@ are not capture targets
`=> $` MUST be rejected with RILL-P001. `$` and `$@` are bound only by a pipe, a call, or a
collection operator (`code-block`, `statement`).

## Evaluation

r[variable.bind] A capture creates or replaces a variable
`v => $x` MUST bind `$x` to `v` in the current scope, as `capture` states.

r[variable.read] A reference yields the bound value
`$x` MUST yield the value most recently bound to `$x` in the scope that owns it (`scope`).

r[variable.undefined] Reading an unbound name halts
Reading a variable no visible scope binds MUST halt with RILL-R005.

r[variable.host] A host binds variables before the script runs
A variable the host provides MUST be visible to the script as if the outermost scope had bound
it. A script MUST NOT assume any host variable exists.

r[variable.callable] A script function lives in a variable
A function a script defines MUST be stored in a variable and called as `$name(...)` or by a
pipe into `$name`. Built-in and host functions stay bare.

## Interactions

A variable's type locks on its first binding (`type-lock`). A capture with a type asserts
(`capture.assert`). Which scope owns a name, and who may rebind it, is stated in `scope`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `$` followed by a digit | RILL-L003 | No |
| A capture into `$` | RILL-P001 | No |
| A variable read where none is bound | RILL-R005 | Yes |

## Examples

```rill
5 => $total
$total + 1
# Result: 6
```

```rill
fn(x) { $x * 2 } => $double
3 -> $double
# Result: 6
```

```rill
# Error: Undefined variable
$missing
```

## Notes

`$ENV` and `$ARGS` are not built in. They exist only when a host binds them, as any host
variable is bound.
