---
id: string.lines
title: string.lines
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, string, string.split]
tests: [methods.test.ts, builtin-string.test.ts]
---

# string.lines

`.lines` yields the lines of a string.

## Syntax

```text
string.lines() -> list(string)
```

## Evaluation

r[string.lines.newline] .lines splits at each newline
`.lines` MUST yield what `.split("\n")` yields (`string.split.separator`). A carriage return
MUST stay in its line, and a trailing newline MUST yield a final `""`.

## Examples

```rill
"a\r\nb\n" -> .lines
# Result: list["a\r", "b", ""]
```
