---
id: string.pad_end
title: string.pad_end
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [method, string, defaults]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.pad_end

`.pad_end` widens a string to a length by adding fill text after it.

## Syntax

```text
string.pad_end(length: number, fill: string = " ") -> string
```

## Evaluation

r[string.pad_end.fill] .pad_end adds fill after the text
When the receiver has fewer than `length` code points, `.pad_end(length, fill)` MUST add
`fill` repeated after the receiver, cut to the code points needed, so the result has exactly
`length` code points. `fill` MUST default to `" "`.

r[string.pad_end.unchanged] A long enough receiver or an empty fill is unchanged
When the receiver already has `length` or more code points, or `fill` is `""`, the result
MUST be the receiver.

r[string.pad_end.invalid] A negative or fractional length halts
A negative or non-integer `length` MUST halt with `#INVALID_INPUT`.

## Interactions

A result past the string length limit halts as `value-size.string` states.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The length is negative or not an integer | `#INVALID_INPUT` | Yes |

## Examples

```rill
list["5" -> .pad_end(3, "0"), "5" -> .pad_end(4, "ab"), "abc" -> .pad_end(2)]
# Result: list["500", "5aba", "abc"]
```

```rill
"5" -> .pad_end(3) -> .len
# Result: 3
```
