---
id: repeat
title: repeat
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, RILL-R001, RILL-R010, RILL-R044, RILL-R045]
depends: [invocation, defaults, pipe, iteration]
tests: [iterators.test.ts, builtin-functions-core.test.ts]
---

# repeat

`repeat` yields an iterator over one value repeated a number of times.

## Syntax

```text
repeat(value: any, count: number) -> iterator
```

## Evaluation

r[repeat.values] The iterator yields the value count times
`repeat(v, n)` MUST yield an iterator whose values are `v`, `n` times. A `count` of 0 MUST yield
a done iterator.

r[repeat.count] A negative or fractional count halts
A negative or non-integer `count` MUST halt with `#INVALID_INPUT` when `repeat` is called, before
any value is read.

r[repeat.lazy] Values are made as they are read
`repeat` MUST NOT produce a value before it is read. `repeat("a", 1000000000000)` MUST return an
iterator, and reading its first value MUST yield `"a"`.

## Interactions

Operators read the iterator as `iteration.iterator` states, and a read past 10,000 values halts
(`iteration.expansion`). `v -> repeat(n)` passes `v` as the value (`pipe.call-operand`).
`.repeat` on a string is a different function (`string.repeat.count`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The count is negative or not an integer (`repeat.count`) | `#INVALID_INPUT` | Yes |
| The count is not a number (`invocation.type`) | RILL-R001 | No |
| A read passes 10,000 values (`iteration.expansion`) | RILL-R010 | No |
| An argument is omitted (`defaults.param-required`) | RILL-R044 | No |
| More than two arguments are passed (`invocation.excess`) | RILL-R045 | No |

## Examples

```rill
list[repeat("a", 3), repeat(list[1], 2), repeat("a", 0)] -> seq({ $ -> seq({ $ }) })
# Result: list[list["a", "a", "a"], list[list[1], list[1]], list[]]
```

```rill
"x" -> repeat(2) -> seq({ $ })
# Result: list["x", "x"]
```

```rill
guard { repeat("a", 1.5) } => $r
$r.!code
# Result: #INVALID_INPUT
```
