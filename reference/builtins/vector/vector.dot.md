---
id: vector.dot
title: vector.dot
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [method, vector-operand]
tests: [vectors.test.ts, builtin-duration-vector.test.ts]
---

# vector.dot

`.dot` yields the dot product of two vectors.

## Syntax

```text
vector.dot(other: any) -> number
```

## Evaluation

r[vector.dot.sum] .dot yields the sum of the component products
`v.dot(w)` MUST yield the sum, over each position, of `v`'s component times `w`'s component at that position.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a vector (`vector-operand.type`) | `#TYPE_MISMATCH` | Yes |
| The argument has a different number of components (`vector-operand.dimensions`) | `#INVALID_INPUT` | Yes |

## Examples

```rill
use<ext:app> => $app
$app.embed("a") => $v
$v.dot($v) == ($v.norm * $v.norm)
# Result: true
```
