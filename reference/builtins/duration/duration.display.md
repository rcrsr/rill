---
id: duration.display
title: duration.display
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, duration]
tests: [duration.test.ts, builtin-duration-vector.test.ts]
---

# duration.display

`.display` yields the printed form of a duration as a string.

## Syntax

```text
duration.display() -> string
```

## Evaluation

r[duration.display.print] .display yields the printed form
`.display` MUST yield the string the receiver prints as (`duration.print`,
`duration.print-zero`). For every duration `$d`, `$d.display` MUST equal `"{$d}"`.

## Examples

```rill
list[duration("25h").display, duration().display, duration("1y2mo").display]
# Result: list["1d1h", "0ms", "1y2mo"]
```
