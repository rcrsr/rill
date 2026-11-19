---
id: spread
title: Spread
status: normative
since: 0.24.0
issues: []
grammar: [spread-arg]
errors: [RILL-P004, RILL-P007, RILL-R001, RILL-R002, RILL-R044]
depends: [pipe]
tests: [spread.test.ts]
---

# Spread

`...v` places the elements or fields of `v` inline, in a collection literal or an argument
list.

## Syntax

```ebnf
spread-arg    = "..." , [ pipe-chain ] ;
```

```text
list[0, ...$a, 3]          elements of a list or tuple
dict[...$d, b: 2]          fields of a dict or ordered
$f(...dict[a: 1, b: 2])    arguments by name
$f(...tuple[1, 2])         arguments by position
v -> $f(...)               the piped value, spread
```

## Static rules

r[spread.operand] A literal spread names its operand
`...` in a collection literal MUST be followed by an expression. A bare `...` there MUST be
rejected with RILL-P004.

r[spread.one-argument] An argument list has at most one spread
A second spread in one argument list MUST be rejected with RILL-P007.

## Evaluation

r[spread.list-source] A list or tuple literal spreads a list or a tuple
In `list[...]` and `tuple[...]`, `...v` MUST insert the elements of the list or tuple `v` in
order. Any other value, an iterator included, MUST halt with RILL-R002 naming its kind.

r[spread.list-uniform] A spread list stays uniform
The spread elements MUST join the list's element type check, so `list[1, ...$strings]` halts
as a mixed list literal does.

r[spread.dict] A dict or ordered literal spreads a dict or an ordered
In `dict[...]` and `ordered[...]`, `...v` MUST insert the fields of the dict or ordered `v` in
its order. Any other value MUST halt with RILL-R002.

r[spread.dict-later] A later field replaces an earlier one
When a spread and another entry give the same key, the entry written later MUST win.

r[spread.arg-dict] A dict spreads arguments by name
`f(...d)` with a dict `d` MUST pass each field to the parameter of the same name. A field that
names no parameter MUST halt with RILL-R001, and a parameter left without a value or a default
MUST halt with RILL-R044.

r[spread.arg-tuple] A tuple spreads arguments by position
`f(...t)` with a tuple `t` MUST pass its elements as positional arguments.

r[spread.arg-ordered] An ordered spreads by name and position
`f(...o)` with an ordered `o` MUST pass its fields in order, and each field's name MUST match
the parameter at its position, or the call MUST halt with RILL-R001.

r[spread.arg-other] Other values do not spread into arguments
Spreading a list or any other non-tuple, non-dict, non-ordered value into arguments MUST halt
with RILL-R001.

r[spread.arg-positional] Written arguments fill the remaining parameters
Positional arguments written beside a dict spread MUST fill, in order, the parameters the
spread leaves without a value.

r[spread.piped] A bare spread spreads the piped value
`v -> f(...)` MUST spread `v` as `f(...v)` would.

## Interactions

A map never spreads (`map.no-spread`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `...` with no operand in a literal | RILL-P004 | No |
| Two spreads in one argument list | RILL-P007 | No |
| A literal spread of the wrong kind | RILL-R002 | Yes |
| An argument spread of the wrong kind, an unknown name, or an ordered out of order | RILL-R001 | Yes |
| A parameter left without a value | RILL-R044 | No |

## Examples

```rill
list[2, 3] => $mid
list[1, ...$mid, 4]
# Result: list[1, 2, 3, 4]
```

```rill
tuple[0, 1] => $t
list[...$t, 2, 3]
# Result: list[0, 1, 2, 3]
```

```rill
dict[a: 1, b: 2] => $d
dict[...$d, b: 9]
# Result: dict[a: 1, b: 9]
```

```rill
fn(a, b) { $a - $b } => $sub
$sub(...dict[b: 1, a: 5])
# Result: 4
```

```rill
fn(a, b) { $a - $b } => $sub
tuple[5, 1] -> $sub(...)
# Result: 4
```

## Notes

Superseded: `spread.list`, now `spread.list-source`. On 0.23.0 a tuple does not spread into a
list literal.