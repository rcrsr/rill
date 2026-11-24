---
id: duration.zero
title: duration.zero
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, duration]
tests: [duration.test.ts, builtin-duration-vector.test.ts]
---

# duration.zero

`.zero` on a duration yields the zero duration.

## Syntax

```text
duration.zero() -> duration
```

## Evaluation

r[duration.zero.value] .zero yields the zero duration
`.zero` on a duration MUST yield the zero duration, equal to `duration()`, whatever the
receiver's components.

## Examples

```rill
duration("1y3d") -> .zero
# Result: 0ms
```

```rill
duration("1y3d").zero == duration()
# Result: true
```
