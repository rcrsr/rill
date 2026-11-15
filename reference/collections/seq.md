---
id: seq
title: seq
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R045]
depends: [iteration]
tests: [collection-operators.test.ts]
---

# seq

`seq` calls a function on each element in order, one call at a time, and yields the list of
results.

## Syntax

```text
source -> seq(fn)
seq(source, fn)
```

## Evaluation

r[seq.order] Calls run one at a time, in source order
`seq` MUST start each call only after the previous call completes, in the order the source
yields its elements (`iteration.list`).

r[seq.result] seq yields the list of results
`seq` MUST yield a list holding each call's result in source order. An empty source MUST yield
`list[]`.

r[seq.result-type] The result list carries the union of result types
The result MUST carry `list(T)`, where `T` is the union of the results' types, so mixed results
form a list rather than halting.

r[seq.arguments] seq takes a source and a function
A third argument MUST halt with RILL-R045.

## Interactions

`break` ends `seq` with the results collected before the breaking element (`break.seq`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| More than two arguments | RILL-R045 | No |

## Examples

```rill
list[1, 2, 3] -> seq({ $ * 2 })
# Result: list[2, 4, 6]
```

```rill
list[1, 2, 3, 4] -> seq({
  ($ == 3) ? break
  $ * 10
})
# Result: list[10, 20]
```

```rill
list[1, 2] -> seq({ ($ == 1) ? 1 ! "a" }) -> .^type
# Result: list(union(number, string))
```
