---
id: window
title: window
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [slicing, slicing-limit]
tests: [collection-operators.test.ts, builtin-functions-slicing.test.ts]
---

# window

`window` yields runs of up to `n` consecutive elements, one starting every `step` elements.

## Syntax

```text
window(source, n: number, step: number = n) -> list(list)
```

## Evaluation

r[window.starts] window yields one window per step position
`window(n, step)` MUST yield, for each position 0, `step`, 2 times `step`, and so on below the
element count, a list of the up to `n` elements from that position, in source order. A window
near the end MUST hold fewer than `n` elements when fewer remain, and a `step` above `n` MUST
leave the elements between windows out.

r[window.step-default] The step defaults to n
`window(n)` MUST yield what `window(n, n)` yields.

r[window.size] A size below 1 halts
An `n` below 1 MUST halt with `#INVALID_INPUT`.

r[window.step-positive] A step below 1 halts
A number `step` below 1 MUST halt with `#INVALID_INPUT`.

## Interactions

The sources and the result kind are stated in `slicing.sources` and `slicing.to-list`, a
fractional `n` or `step` in `slicing.integer`, and the result size in `slicing-limit.output`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `n` is below 1 | `#INVALID_INPUT` | Yes |
| `step` is a number below 1 | `#INVALID_INPUT` | Yes |

## Examples

```rill
list[range(1, 5) -> window(2), range(1, 4) -> window(2, 1), range(1, 7) -> window(2, 4)]
# Result: list[list[list[1, 2], list[3, 4]], list[list[1, 2], list[2, 3], list[3]], list[list[1, 2], list[5, 6]]]
```

```rill
# Error: window: step must be > 0
list[1, 2] -> window(2, 0)
```

## Notes

A `step` that is not a number halts `#INVALID_INPUT`, catchable, while an `n` that is not a
number halts RILL-R001, uncatchable. Which is intended is undecided: see INCONSISTENCIES.md.
