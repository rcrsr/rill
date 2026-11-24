---
id: batch
title: batch
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [slicing, slicing-limit, construct-options, duration]
tests: [collection-operators.test.ts, throttling.test.ts, builtin-functions-slicing.test.ts]
---

# batch

`batch` groups consecutive elements of a source into lists of `n`.

## Syntax

```text
batch(source, n: number, options: dict) -> list(list)
```

The options are `drop_partial`, a bool, and `idle_flush`, a duration.

## Evaluation

r[batch.chunks] batch yields consecutive chunks of n
`batch(n)` MUST yield a list of lists, each holding the next `n` elements in source order. The
last chunk MUST hold the elements that remain, fewer than `n` when the count is not a multiple
of `n`.

r[batch.size] A count below 1 halts
An `n` below 1 MUST halt with `#INVALID_INPUT`.

r[batch.drop-partial] drop_partial drops a short last chunk
With `drop_partial: true`, a last chunk holding fewer than `n` elements MUST be dropped. With
`drop_partial: false` or no options, it MUST be kept.

r[batch.options-kind] Options of the wrong kind halt
An options argument that is a list, a string, or a number MUST halt with `#TYPE_MISMATCH`.

r[batch.unknown-option] An unknown option halts
An options dict with a key other than `drop_partial` and `idle_flush` MUST halt with
`#INVALID_INPUT`.

r[batch.option-types] Each option has its type
A `drop_partial` that is not a bool, and an `idle_flush` that is not a duration, MUST halt with
`#TYPE_MISMATCH`.

## Interactions

The sources and the result kind are stated in `slicing.sources` and `slicing.to-list`, a
fractional `n` in `slicing.integer`, and the result size in `slicing-limit.output`. An
`idle_flush` with a months part halts as `construct-options.timeout-fixed-duration` states.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `n` is below 1 | `#INVALID_INPUT` | Yes |
| The options are a list, a string, or a number | `#TYPE_MISMATCH` | Yes |
| An option name other than `drop_partial` and `idle_flush` | `#INVALID_INPUT` | Yes |
| `drop_partial` is not a bool, or `idle_flush` is not a duration | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
list[range(1, 6) -> batch(2), range(1, 6) -> batch(2, dict[drop_partial: true])]
# Result: list[list[list[1, 2], list[3, 4], list[5]], list[list[1, 2], list[3, 4]]]
```

```rill
# Error: batch: unknown option 'size'
list[1, 2] -> batch(2, dict[size: 1])
```
