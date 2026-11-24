---
id: datetime.unix
title: datetime.unix
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, datetime]
tests: [datetime.test.ts, limits.test.ts, builtin-datetime.test.ts]
---

# datetime.unix

`.unix` yields the millisecond count of a datetime since the Unix epoch.

## Syntax

```text
datetime.unix() -> number
```

## Evaluation

r[datetime.unix.count] .unix yields milliseconds since the epoch
`.unix` MUST yield the number of milliseconds from 1970-01-01T00:00:00Z to the receiver's
instant, negative for an instant before it.

## Interactions

`datetime.from-unix` builds a datetime from the same count.

## Examples

```rill
datetime("1970-01-01T00:00:01Z") -> .unix
# Result: 1000
```

```rill
datetime("1969-12-31T23:59:59.999Z") -> .unix
# Result: -1
```
