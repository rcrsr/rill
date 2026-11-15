---
id: slice
title: Slice
status: normative
since: 0.24.0
issues: []
grammar: [slice, slice-bound]
errors: [INVALID_INPUT, RILL-P001, RILL-R002]
depends: [pipe, selection]
tests: [destruct-slice-keyword.test.ts, extraction.test.ts]
---

# Slice

`v -> slice<start:stop:step>` yields the elements of a list or a tuple, or the code points of a
string, from `start` up to `stop`, every `step`.

## Syntax

```ebnf
slice = "slice" , "<" , [ slice-bound ] , ":" , [ slice-bound ] , [ ":" , [ slice-bound ] ] , ">" ;
slice-bound = number | variable | grouped-expr ;
```

```text
v -> slice<1:4>     elements 1, 2, 3
v -> slice<-2:>     the last two
v -> slice<::-1>    reversed
```

## Static rules

r[slice.separator] A slice has at least one colon
`slice<>` and a slice with no `:` MUST be rejected with RILL-P001.

r[slice.bound-form] A bound is a number, a variable, or a grouped expression
A bound written in any other form, such as a string literal, MUST be rejected with RILL-P001.

## Evaluation

r[slice.sources] A slice takes a list, a tuple, or a string
A list MUST slice to a list, a tuple to a tuple, and a string to a string of its code points.
Any other source, an ordered or an iterator included, MUST halt with RILL-R002 naming its kind.

r[slice.half-open] start is included and stop is not
The result MUST hold the elements at `start`, `start + step`, and onward, stopping before
`stop`.

r[slice.defaults] An omitted bound takes its default
An omitted `step` MUST be 1. With a positive step, an omitted `start` MUST be the first index
and an omitted `stop` MUST be past the last. With a negative step, they MUST be the last index
and before the first.

r[slice.negative] A negative bound counts from the end
A negative `start` or `stop` MUST count from the end, so `-1` is the last element.

r[slice.clamp] A bound past either end is clamped
A bound beyond the source MUST be clamped to it, and MUST NOT halt.

r[slice.empty-result] A range that selects nothing is empty
A slice whose bounds select no element MUST yield an empty list, an empty tuple, or `""`.

r[slice.step-zero] A zero step halts
A `step` of 0 MUST halt with `#INVALID_INPUT`.

r[slice.integer] A bound is an integer
A bound that is not an integer MUST halt with `#INVALID_INPUT`, and a bound that is not a
number MUST halt with RILL-R002.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| No `:` in the slice, or a bound in another form | RILL-P001 | No |
| The source is not a list, a tuple, or a string | RILL-R002 | Yes |
| A bound is not a number | RILL-R002 | Yes |
| A bound is not an integer, or the step is 0 | `#INVALID_INPUT` | Yes |

## Examples

```rill
list[0, 1, 2, 3, 4] -> slice<1:4>
# Result: list[1, 2, 3]
```

```rill
tuple[0, 1, 2, 3] -> slice<1:3>
# Result: tuple[1, 2]
```

```rill
list[0, 1, 2, 3, 4] -> slice<::-2>
# Result: list[4, 2, 0]
```

```rill
"héllo" -> slice<1:3>
# Result: "él"
```

```rill
list[0, 1, 2] -> slice<5:9>
# Result: list[]
```

```rill
# Error: Slice step cannot be zero
list[1, 2] -> slice<::0>
```

## Notes

Superseded: `slice.source`, now `slice.sources`, and `slice.empty`, now `slice.empty-result`. On 0.23.0 a tuple does not slice.