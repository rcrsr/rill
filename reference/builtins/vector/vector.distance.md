---
id: vector.distance
title: vector.distance
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [method, vector-operand]
tests: [vectors.test.ts, builtin-duration-vector.test.ts]
---

# vector.distance

`.distance` yields the Euclidean distance between two vectors.

## Syntax

```text
vector.distance(other: any) -> number
```

## Evaluation

r[vector.distance.euclidean] .distance yields the Euclidean distance
`v.distance(w)` MUST yield the square root of the sum, over each position, of the squared difference of the two components.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a vector (`vector-operand.type`) | `#TYPE_MISMATCH` | Yes |
| The argument has a different number of components (`vector-operand.dimensions`) | `#INVALID_INPUT` | Yes |

## Examples

```rill
use<ext:app> => $app
$app.embed("a") => $v
$v.distance($v)
# Result: 0
```
