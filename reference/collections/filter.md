---
id: filter
title: filter
status: normative
since: 0.24.0
issues: [599]
grammar: []
errors: [TYPE_MISMATCH]
depends: [iteration, fan]
tests: [collection-operators.test.ts]
---

# filter

`filter` calls a predicate on each element and yields the elements it accepts.

## Syntax

```text
source -> filter(pred)
source -> filter(pred, dict[concurrency: N])
```

## Evaluation

r[filter.keep] filter keeps the elements the predicate accepts
`filter` MUST yield a list of the elements whose call returned `true`, in source order. An
empty source MUST yield `list[]`.

r[filter.bool] The predicate returns a bool
A call that returns a value other than a bool MUST halt with `#TYPE_MISMATCH`.

r[filter.element] filter keeps the element the source yields
The kept element MUST be the value the source yielded: a one-character string for a string,
and the entry dict for a dict.

r[filter.map] filter over a map keeps the entry dicts {pending #599}
`filter` over a map MUST yield the `dict[key: K, value: V]` entries its predicate accepts.

r[filter.options] filter takes fan's options
`filter` MUST accept and check an options dict as `fan` does (`fan.concurrency`,
`fan.options-dict`, `fan.options-number`, `fan.options-positive`, `fan.options-unknown`).

## Interactions

`break` inside `filter` halts (`break.unsupported`). Calls may overlap as in `fan`
(`fan.concurrent`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The predicate returns a non-bool | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
list[1, 2, 3, 4, 5] -> filter({ $ > 2 })
# Result: list[3, 4, 5]
```

```rill
"hello" -> filter({ $ != "l" })
# Result: list["h", "e", "o"]
```

```rill
dict[a: 1, b: 5] -> filter({ $.value > 2 })
# Result: list[dict[key: "b", value: 5]]
```

```rill
# Error: filter: predicate must return bool, got number
list[1, 2] -> filter({ $ })
```
