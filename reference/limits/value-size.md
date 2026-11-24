---
id: value-size
title: Value size
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT]
depends: [halt, string, datetime]
tests: [limits.test.ts, methods.test.ts]
---

# Value size

A string has a maximum length and a datetime a maximum distance from the epoch; an operation that
would produce a value past either bound halts.

## Evaluation

r[value-size.string] A string method past the maximum length halts
`.repeat`, `.pad_start`, and `.pad_end` MUST halt with `#INVALID_INPUT` when their result would
be longer than the longest string the runtime can hold. That length is an implementation limit.
An empty receiver repeated any number of times MUST yield `""`.

r[value-size.datetime] A datetime lies within 8,640,000,000,000,000 ms of the epoch
A datetime MUST lie within 8,640,000,000,000,000 milliseconds of 1970-01-01T00:00:00Z, either
side. Building a datetime outside that range, from components, from an ISO 8601 string, or from a
unix count, MUST halt with `#INVALID_INPUT`. So MUST `.add` when its result would fall outside it.
A datetime exactly at either bound MUST be accepted.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A string method result past the maximum length (`value-size.string`) | `#INVALID_INPUT` | Yes |
| A datetime outside the range (`value-size.datetime`) | `#INVALID_INPUT` | Yes |

## Examples

```rill
datetime("+275760-09-13T00:00:00Z") -> .unix
# Result: 8640000000000000
```

```rill
# Error: Invalid datetime component year: 275761
datetime(...dict[year: 275761, month: 1, day: 1])
```

```rill
# Error: too large to allocate
"ab" -> .repeat(10000000000)
```

## Notes

Probed at 93e55c14 on Node.js, the longest string holds 536,870,888 UTF-16 code units:
`"a" -> .repeat(536870888)` returns and `.repeat(536870889)` halts.

The bound of `value-size.datetime` is 275760-09-13T00:00:00Z after the epoch and
-271821-04-20T00:00:00Z before it.
