---
id: vacancy
title: Vacancy
status: normative
since: 0.24.0
issues: []
grammar: [default-value]
errors: [RILL-R003]
depends: [value]
tests: [vacancy-coerce.test.ts, default-value-operator.test.ts, status-probe.test.ts]
---

# Vacancy

A value is vacant when it is empty or invalid, and `??` replaces a vacant value with a fallback.

## Syntax

```ebnf
default-value = "??" , body ;
```

## Evaluation

r[vacancy.empty] Only containers and strings can be empty
A string, list, tuple, dict, or ordered with no characters, elements, or entries MUST be
empty. A number, bool, atom, datetime, duration, function, or type value MUST never be empty.

r[vacancy.empty-probe] .empty reports emptiness
`.empty` MUST yield whether its receiver is empty. On a value that cannot be empty, it MUST halt
with RILL-R003.

r[vacancy.vacant] A vacant value is empty or invalid
A value MUST be vacant exactly when it is empty or invalid.

r[vacancy.zero-false] Zero and false are not vacant
`0` and `false` MUST pass through `??` unchanged.

r[vacancy.fallback] ?? replaces a vacant value
`v ?? d` MUST yield `d` when `v` is vacant and `v` otherwise. `d` MUST be evaluated only when
`v` is vacant.

r[vacancy.missing] ?? replaces a missing selection
`??` after a selection MUST yield the fallback when the key or index is missing, as
`selection.default` states.

r[vacancy.status] The status probe reads validity without halting
`v.!` MUST yield true for an invalid value and false for a valid one, and MUST NOT halt.

r[vacancy.access-invalid] Accessing an invalid value halts
A field read, an index read, a method call, or a comparison on an invalid value MUST halt with
the halt the value carries.

r[vacancy.no-condition] Vacancy is never a condition
A condition MUST be a bool. Emptiness and validity are tested with `.empty` and `.!`.

## Interactions

`??` does not require the fallback to share the value's type: `dict[] ?? 1` yields 1. The
fallback keeps its own type (`carried-type.fallback`). The invalid value and its status fields
are stated in the errors chapter.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `.empty` on a value that cannot be empty | RILL-R003 | Yes |

## Examples

```rill
tuple["" ?? "d", "x" ?? "d", list[] ?? list[1], 0 ?? 5, false ?? true]
# Result: tuple["d", "x", list[1], 0, false]
```

```rill
guard { $nope } => $r
tuple[$r.!, $r ?? 5]
# Result: tuple[true, 5]
```

```rill
# Error: not supported on number
5 -> .empty
```
