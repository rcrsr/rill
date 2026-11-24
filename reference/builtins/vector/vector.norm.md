---
id: vector.norm
title: vector.norm
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method]
tests: [vectors.test.ts, builtin-duration-vector.test.ts]
---

# vector.norm

`.norm` yields the length of a vector.

## Syntax

```text
vector.norm() -> number
```

## Evaluation

r[vector.norm.length] .norm yields the Euclidean length
`.norm` MUST yield the square root of the sum of the squares of the receiver's components. A vector whose components are all 0 MUST yield 0.

## Examples

```rill
use<ext:app> => $app
$app.embed("a") => $v
list[$v.norm > 0.374, $v.norm < 0.375]
# Result: list[true, true]
```
