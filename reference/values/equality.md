---
id: equality
title: Equality
status: normative
since: 0.24.0
issues: [560]
grammar: []
errors: [TYPE_MISMATCH, RILL-R002]
depends: [value]
tests: [closure-equality.test.ts]
---

# Equality

`==` compares two values by content, and `!=` is its negation.

## Static rules

r[equality.no-overlap] Equality halts when the types do not overlap {pending #560}
`a == b` and `a != b` MUST halt with `#TYPE_MISMATCH` when the types the operands carry do not
overlap (`structural-typing`). Each operand is judged on its carried type (`carried-type`).

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

r[equality.kind] Values of different kinds are unequal
A comparison of values of different kinds that completes MUST yield false, as
`list[1] == tuple[1]` and `ordered[a: 1] == dict[a: 1]` do.

r[equality.function] Functions compare by structure
Two functions MUST be equal when their parameters, bodies, and the values of the variables
their bodies capture are equal. A function MUST equal itself.

r[equality.type] Type values compare structurally
Two type values MUST be equal under `structural-typing`.

r[equality.stream] Streams are not comparable
`==` with a stream operand MUST halt with RILL-R002.

r[equality.methods] .eq, .ne, and .has follow the operators
`.eq`, `.ne`, and `.has` MUST compare as `==` does, including its halts.

## Interactions

A carried type decides whether a comparison halts, never its result (`carried-type.equality`).
Ordering comparisons, `<` and `>`, are stated with the operators.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The operands' types do not overlap {pending #560} | `#TYPE_MISMATCH` | Yes |
| An operand is a stream | RILL-R002 | Yes |

## Examples

```rill
list[dict[b: 2, a: 1] == dict[a: 1, b: 2], list[1, 2] == list[2, 1]]
# Result: list[true, false]
```

```rill
|x| { $x } => $f
|x| { $x } => $g
$f == $g
# Result: true
```

```rill pending=560
# Error: #TYPE_MISMATCH
1 == "1"
```

## Notes

On 0.23.0 operands of non-overlapping types compare false: `1 == "1"` and `number == string`
yield false.
