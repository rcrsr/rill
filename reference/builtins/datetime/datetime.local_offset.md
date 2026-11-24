---
id: datetime.local_offset
title: datetime.local_offset
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [method, datetime]
tests: [datetime.test.ts, builtin-datetime.test.ts]
---

# datetime.local_offset

`.local_offset` yields the UTC offset in hours that the host gives the runtime.

## Syntax

```text
datetime.local_offset() -> number
```

## Evaluation

r[datetime.local_offset.host] .local_offset yields the host's offset in hours
`.local_offset` MUST yield the UTC offset, in hours, that the host passes to the runtime as its
`timezone` option. When the host passes none, `.local_offset` MUST yield 0, whatever time zone
the process running the script is in.

r[datetime.local_offset.invalid] A host offset that is not finite halts
When the host's offset is not a finite number, `.local_offset` MUST halt with `#INVALID_INPUT`.

## Interactions

`.local_iso`, `.local_date`, and `.local_time` format at this offset (`datetime.local_iso.offset`,
`datetime.local_date.offset`, `datetime.local_time.offset`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The host's offset is not a finite number | `#INVALID_INPUT` | Yes |

## Examples

```rill
datetime("2026-03-13") -> .local_offset
# Result: 0
```
