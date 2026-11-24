---
id: enumerate
title: enumerate
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R001, RILL-R044, RILL-R045, TYPE_MISMATCH]
depends: [invocation, defaults, pipe, iteration, list, dict, code-block]
tests: [extraction.test.ts, code-block.test.ts, builtin-functions-core.test.ts]
---

# enumerate

`enumerate` yields a list that pairs each element or entry of a list or a dict with its position.

## Syntax

```text
enumerate(items: union(list, dict)) -> list
```

## Evaluation

r[enumerate.list] A list yields index and value dicts
`enumerate(l)` on a list MUST yield one `dict[index: i, value: v]` per element, in list order,
with `i` counting from 0. `enumerate(list[])` MUST yield `list[]`.

r[enumerate.dict] A dict yields index, key, and value dicts in key order
`enumerate(d)` on a dict MUST yield one `dict[index: i, key: k, value: v]` per key, in the order
`iteration.dict` yields keys, with `i` counting from 0. `enumerate(dict[])` MUST yield `list[]`.

## Interactions

A value of any other kind fails the parameter type (`invocation.type`). A held code block as an
element or an entry halts (`code-block.non-selecting`). `v -> enumerate` passes `v` as the
argument (`pipe.call-operand`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a list or a dict (`invocation.type`) | RILL-R001 | No |
| An element or entry is a held code block (`code-block.non-selecting`) | `#TYPE_MISMATCH` | Yes |
| No argument is passed (`defaults.param-required`) | RILL-R044 | No |
| More than one argument is passed (`invocation.excess`) | RILL-R045 | No |

## Examples

```rill
enumerate(list[10, 20])
# Result: list[dict[index: 0, value: 10], dict[index: 1, value: 20]]
```

```rill
dict[b: 1, a: 2] -> enumerate
# Result: list[dict[index: 0, key: "a", value: 2], dict[index: 1, key: "b", value: 1]]
```

```rill
# Error: items expects union(dict, list), got string
enumerate("ab")
```
