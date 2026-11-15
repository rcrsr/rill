---
id: fan
title: fan
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [iteration]
tests: [collection-operators.test.ts]
---

# fan

`fan` calls a function on each element, with calls free to overlap, and yields the list of
results in source order.

## Syntax

```text
source -> fan(fn)
source -> fan(fn, dict[concurrency: N])
```

## Evaluation

r[fan.concurrent] Calls MAY overlap
`fan` MAY start a call before an earlier call completes. With no `concurrency` option, it MAY
start every call at once.

r[fan.result] fan yields results in source order
`fan` MUST yield a list holding each call's result in source order, whatever order the calls
complete in. An empty source MUST yield `list[]`.

r[fan.concurrency] concurrency caps the calls in flight
With `dict[concurrency: N]`, `fan` MUST have at most `N` calls in flight at once.

r[fan.options-dict] The options are a dict
An options argument that is not a dict MUST halt with `#TYPE_MISMATCH`.

r[fan.options-number] concurrency is a number
A `concurrency` that is not a number MUST halt with `#TYPE_MISMATCH`.

r[fan.options-positive] concurrency is a positive integer
A `concurrency` that is zero, negative, or not an integer MUST halt with `#INVALID_INPUT`.

r[fan.options-unknown] Only concurrency is an option
An options key other than `concurrency` MUST halt with `#INVALID_INPUT`.

## Interactions

`break` inside `fan` halts (`break.unsupported`). Each call binds its own element
(`iteration.dollar`), so no call sees another's result.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The options argument is not a dict | `#TYPE_MISMATCH` | Yes |
| `concurrency` is not a number | `#TYPE_MISMATCH` | Yes |
| `concurrency` is not a positive integer | `#INVALID_INPUT` | Yes |
| An unknown option | `#INVALID_INPUT` | Yes |

## Examples

```rill
list[1, 2, 3] -> fan({ $ * $ })
# Result: list[1, 4, 9]
```

```rill
list[1, 2, 3, 4] -> fan({ $ + 1 }, dict[concurrency: 2])
# Result: list[2, 3, 4, 5]
```

```rill
# Error: fan: options.concurrency must be a positive integer, got 0
list[1] -> fan({ $ }, dict[concurrency: 0])
```
