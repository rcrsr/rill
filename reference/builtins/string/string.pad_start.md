---
id: string.pad_start
title: string.pad_start
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [method, string, defaults]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.pad_start

`.pad_start` widens a string to a length by adding fill text before it.

## Syntax

```text
string.pad_start(length: number, fill: string = " ") -> string
```

## Evaluation

r[string.pad_start.fill] .pad_start adds fill before the text
When the receiver has fewer than `length` code points, `.pad_start(length, fill)` MUST add
`fill` repeated before the receiver, cut to the code points needed, so the result has exactly
`length` code points. `fill` MUST default to `" "`.

r[string.pad_start.unchanged] A long enough receiver or an empty fill is unchanged
When the receiver already has `length` or more code points, or `fill` is `""`, the result
MUST be the receiver.

r[string.pad_start.invalid] A negative or fractional length halts
A negative or non-integer `length` MUST halt with `#INVALID_INPUT`.

## Interactions

A result past the string length limit halts as `value-size.string` states.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The length is negative or not an integer | `#INVALID_INPUT` | Yes |

## Examples

```rill
list["5" -> .pad_start(3, "0"), "5" -> .pad_start(4, "ab"), "abc" -> .pad_start(2)]
# Result: list["005", "aba5", "abc"]
```

```rill
"5" -> .pad_start(3)
# Result: "  5"
```
