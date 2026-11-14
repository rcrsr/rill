---
id: acc
title: acc
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [fold]
tests: [collection-operators.test.ts]
---

# acc

`acc` threads an accumulator as `fold` does and yields the accumulator after every call.

## Syntax

```text
source -> acc(seed, fn)
acc(source, seed, fn)
```

## Evaluation

r[acc.threading] acc threads the accumulator as fold does
`acc` MUST bind `$`, `$@`, and its parameters, and order its calls, as `fold` does
(`fold.accumulator`, `fold.order`, `fold.unnamed`, `fold.named`, `fold.seed-required`).

r[acc.result] acc yields every accumulator after the seed
`acc` MUST yield a list holding each call's result in source order. The seed MUST NOT be in
the list, and an empty source MUST yield `list[]`.

## Interactions

`break` ends `acc` with the results collected before the breaking element (`break.seq`).

## Examples

```rill
list[1, 2, 3] -> acc(0, { $@ + $ })
# Result: list[1, 3, 6]
```

```rill
list[1, 2, 3] -> acc(0, {
  ($ == 3) ? break
  $@ + $
})
# Result: list[1, 3]
```

```rill
list[] -> acc(0, { $@ + $ })
# Result: list[]
```
