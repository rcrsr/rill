---
id: vector.dimensions
title: vector.dimensions
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method]
tests: [vectors.test.ts, builtin-duration-vector.test.ts]
---

# vector.dimensions

`.dimensions` yields the number of components of a vector.

## Syntax

```text
vector.dimensions() -> number
```

## Evaluation

r[vector.dimensions.count] .dimensions yields the component count
`.dimensions` MUST yield the number of components the receiver holds.

## Examples

```rill
use<ext:app> => $app
$app.embed("a") => $v
$v.dimensions
# Result: 3
```
