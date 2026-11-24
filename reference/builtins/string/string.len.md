---
id: string.len
title: string.len
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, string]
tests: [property-access.test.ts, builtin-string.test.ts]
---

# string.len

`.len` yields the number of code points in a string.

## Syntax

```text
string.len() -> number
```

## Evaluation

r[string.len.count] .len counts code points
`.len` MUST yield the number of Unicode code points in the receiver. `"😀a".len` MUST yield 2,
and `"".len` MUST yield 0.

## Examples

```rill
list["héllo".len, "😀a".len, "".len]
# Result: list[5, 2, 0]
```
