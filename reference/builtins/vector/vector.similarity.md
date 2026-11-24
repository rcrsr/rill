---
id: vector.similarity
title: vector.similarity
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [method, vector-operand, vector.dot, vector.norm]
tests: [vectors.test.ts, builtin-duration-vector.test.ts]
---

# vector.similarity

`.similarity` yields the cosine similarity of two vectors, from -1 to 1.

## Syntax

```text
vector.similarity(other: any) -> number
```

## Evaluation

r[vector.similarity.cosine] .similarity yields the cosine of the angle between two vectors
`v.similarity(w)` MUST yield `v.dot(w)` divided by the product of `v.norm` and `w.norm`
(`vector.dot.sum`, `vector.norm.length`). Vectors in one direction yield 1, orthogonal vectors
0, and opposite vectors -1.

r[vector.similarity.zero] A vector of all zeros yields 0
When either vector's norm is 0, `.similarity` MUST yield 0.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a vector (`vector-operand.type`) | `#TYPE_MISMATCH` | Yes |
| The argument has a different number of components (`vector-operand.dimensions`) | `#INVALID_INPUT` | Yes |

## Examples

```rill
use<ext:app> => $app
$app.embed("a") => $v
$v.similarity($v)
# Result: 1
```

```rill
use<ext:app> => $app
guard { $app.embed("a").similarity("a") } => $r
$r.!code
# Result: #TYPE_MISMATCH
```
