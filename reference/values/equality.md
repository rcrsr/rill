---
id: equality
title: Equality
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [TYPE_MISMATCH, RILL-R002]
depends: [value]
tests: [closure-equality.test.ts, equality-gate.test.ts, list-membership.test.ts]
---

# Equality

`==` compares two values by content, and `!=` is its negation.

## Static rules

r[equality.no-overlap] Equality halts when the types do not overlap
`a == b` and `a != b` MUST halt with `#TYPE_MISMATCH` when the types the operands carry do not
overlap (`structural-typing`). Each operand is judged on its carried type (`carried-type`).

r[equality.closed-set] A declared set of literals halts on a value outside it
When an operand carries a type from an assertion or a declaration that is a union of literals,
and the other operand is a literal that is not a member, `==`, `!=`, `.eq`, `.ne`, `.has`,
`.has_any`, and `.has_all` MUST halt with `#TYPE_MISMATCH`, as `structural-typing.overlap-literal`
states. Two declared sets with no common member MUST halt. `.has`, `.has_any`, and `.has_all`
MUST judge each sought value. Two operands that carry only inferred types are never narrowed, so
`"a" == "b"` and `#TIMEOUT == #TIMEUOT` MUST yield false. The set holds strings, numbers, bools, or atoms.

## Evaluation

r[equality.content] Equal content is equal
Two values MUST compare equal when they have the same kind and equal content, however and
whenever each was built.

r[equality.not] != negates ==
`a != b` MUST yield the negation of `a == b`.

r[equality.number] Numbers compare by numeric value
`1 == 1.0` and `0 == -0` MUST yield true.

r[equality.atom] Atoms compare by name
Two atoms MUST be equal exactly when their names are equal.

r[equality.ordered-seq] Lists, tuples, and ordereds compare in order
A list, a tuple, and an ordered MUST be equal to one of the same kind only when their elements
or entries are equal position by position.

r[equality.keyed] Dicts and maps ignore order
A dict, and a map, MUST be equal to one of the same kind when both hold the same keys with
equal values, in any order.

r[equality.nested] Equality is deep
Equality of collections MUST compare nested elements by these same rules.

r[equality.kind] Values of different kinds with overlapping types are unequal
A comparison of values of different kinds whose types overlap, such as an `any` operand or a
union, MUST yield false. Kinds whose types do not overlap, as in `list[1] == tuple[1]` and
`ordered[a: 1] == dict[a: 1]`, halt per `equality.no-overlap`.

r[equality.function] Functions compare by structure
Two functions MUST be equal when their parameters, bodies, and the values of the variables
their bodies capture are equal. A function MUST equal itself.

r[equality.type] Type values compare structurally
Two type values MUST be equal under `structural-typing`.

r[equality.stream] Streams are not comparable
`==` with a stream operand MUST halt with RILL-R002.

r[equality.methods] .eq, .ne, .has, .has_any, and .has_all follow the operators
`.eq`, `.ne`, `.has`, `.has_any`, and `.has_all` MUST compare as `==` does, including its
halts.

r[equality.membership] Membership judges the sought value against the element type
`.has`, `.has_any`, and `.has_all` on a list MUST judge overlap between each sought value and the
list's element type, carried or inferred, not each element's own type.

```rill
list[1, "a"] -> .has("a")
# Result: true
```

## Interactions

A carried type decides whether a comparison halts, never its result (`carried-type.equality`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The operands' types do not overlap | `#TYPE_MISMATCH` | Yes |
| A declared literal set is compared with a literal outside it | `#TYPE_MISMATCH` | Yes |
| An operand is a stream | RILL-R002 | Yes |

## Examples

```rill
list[dict[b: 2, a: 1] == dict[a: 1, b: 2], list[1, 2] == list[2, 1]]
# Result: list[true, false]
```

```rill
fn(x) { $x } => $f
fn(x) { $x } => $g
$f == $g
# Result: true
```

```rill
# Error: #TYPE_MISMATCH
1 == "1"
```

```rill
# Error: #TYPE_MISMATCH
dict[a: 1] => $x:dict(a: number)
$x == dict[a: 1, b: 2]
```

```rill
dict[a: 1] => $x:dict(a: number, b: number = 0)
$x == dict[a: 1, b: 2]
# Result: false
```

```rill
# Error: #TYPE_MISMATCH
dict[a: 1] == dict[a: 1, b: 2]
```

```rill
# Error: #TYPE_MISMATCH
list[dict[a: 1], dict[b: 2]] -> seq({ $ == dict[a: 1] })
```

```rill
"c" => $unit:union("c", "f")
$unit == "f"
# Result: false
```

```rill
# Error: #TYPE_MISMATCH "x" is outside the declared set
"c" => $unit:union("c", "f")
$unit == "x"
```

```rill
list[dict[a: 1], dict[b: 2]] => $l:list(dict)
$l -> seq({ $ == dict[a: 1] })
# Result: list[true, false]
```

## Notes

On 0.23.0 operands of non-overlapping types compare false: `1 == "1"` and `number == string`
yield false.

On 0.23.0 a declared operand let a dict key that only one side names pass, so a declared
`dict(a: number)` compared with `dict[a: 1, b: 2]` yielded false. Dict overlap now follows
`structural-typing.overlap-fields` whether or not an operand is declared.
