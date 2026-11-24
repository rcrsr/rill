---
id: string.le
title: string.le
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [method, string]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.le

`.le` tests whether a string orders at most another value.

## Syntax

```text
string.le(other: any) -> bool
```

## Evaluation

r[string.le.operator] .le yields what <= yields
`s.le(x)` MUST yield what `s <= x` yields (`string.ordering`), and MUST halt where it halts
(`string.cross-order`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument is not a string (`string.cross-order`) | RILL-R002 | Yes |

## Examples

```rill
"a" -> .le("a")
# Result: true
```

```rill
# Error: Cannot compare string with number
"a" -> .le(1)
```
