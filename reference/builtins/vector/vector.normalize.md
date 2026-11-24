---
id: vector.normalize
title: vector.normalize
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, vector.norm, vector.model]
tests: [vectors.test.ts, builtin-duration-vector.test.ts]
---

# vector.normalize

`.normalize` yields the vector of length 1 in the direction of a vector.

## Syntax

```text
vector.normalize() -> vector
```

## Evaluation

r[vector.normalize.unit] .normalize divides each component by the norm
`.normalize` MUST yield a vector with the receiver's number of components and model name, each
component the receiver's divided by the receiver's norm (`vector.norm.length`).

r[vector.normalize.zero] A vector of all zeros is unchanged
When the receiver's norm is 0, `.normalize` MUST yield the receiver.

## Examples

```rill
use<ext:app> => $app
$app.embed("a") => $v
list[$v.normalize.dimensions, $v.normalize.similarity($v) > 0.999999]
# Result: list[3, true]
```

## Notes

The runtime stores vector components as 32-bit floats, so the norm of a normalized vector can
differ from 1 in the eighth significant digit: a vector of components 3 and 4 normalizes to one
of norm 1.000000023841858.
