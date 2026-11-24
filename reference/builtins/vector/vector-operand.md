---
id: vector-operand
title: Vector operands
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [method]
tests: [vectors.test.ts, builtin-duration-vector.test.ts]
---

# Vector operands

A vector operand is the second vector that `.similarity`, `.dot`, and `.distance` compare their
receiver with.

## Evaluation

r[vector-operand.type] A non-vector operand halts
An argument to `.similarity`, `.dot`, or `.distance` that is not a vector MUST halt with
`#TYPE_MISMATCH`.

r[vector-operand.dimensions] Operands of different dimensions halt
When the argument's component count differs from the receiver's, `.similarity`, `.dot`, and
`.distance` MUST halt with `#INVALID_INPUT`.

r[vector-operand.model] The model name does not take part
The receiver's and the argument's model names MUST NOT affect the result. Two vectors with the
same components and different model names yield what two vectors with one model name yield.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a vector | `#TYPE_MISMATCH` | Yes |
| The argument has a different number of components | `#INVALID_INPUT` | Yes |

## Examples

```rill
use<ext:app> => $app
guard { $app.embed("a").dot(list[1, 2, 3]) } => $r
$r.!code
# Result: #TYPE_MISMATCH
```

## Notes

A vector is a host value: a script receives one from a host function and cannot construct one.
