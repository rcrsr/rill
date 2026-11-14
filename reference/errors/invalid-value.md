---
id: invalid-value
title: Invalid values
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: []
tests: [status-probe.test.ts, guard-retry.test.ts, vacancy-coerce.test.ts]
---

# Invalid values

An invalid value is a failure held as a value: it carries the halt that produced it, and using
it raises that halt again.

## Evaluation

r[invalid-value.origin] Recovery and hosts make invalid values
An invalid value MUST arise only from `guard` or `retry` catching a halt, or from a host
function that invalidates its result.

r[invalid-value.status] An invalid value carries a status
An invalid value MUST carry a status with the fields `code`, `message`, `provider`, `raw`, and
`trace`. `code` MUST be the error code of the halt it holds.

r[invalid-value.valid-status] A valid value has the ok status
A valid value MUST report the status code `#ok`, an empty `message`, `provider`, and `raw`,
and an empty `trace`.

r[invalid-value.probe] Status probes never halt
`v.!` MUST yield whether `v` is invalid, and `v.!code`, `v.!message`, `v.!provider`,
`v.!raw`, and `v.!trace` MUST yield the status fields. None of them MUST halt.

r[invalid-value.access] Access raises the held halt
A field read, an index read, a method call, an operator, or a pipe into a target that uses the
value MUST raise the halt the invalid value holds, at the place of access.

r[invalid-value.hold] Holding an invalid value is not access
A capture, a variable read, a `??` test, and a status probe MUST NOT raise the held halt.

## Interactions

`??` replaces an invalid value, since an invalid value is vacant (`vacancy.vacant`). The type
of `.!code` is `union(error_code, #ok)` (`error-code.status`). Which halts become invalid
values is stated in `guard` and `halt.catchable`.

## Examples

```rill
guard { 1 / 0 } => $r
tuple[$r.!, $r.!message, $r ?? 0]
# Result: tuple[true, "Division by zero", 0]
```

```rill
5 => $v
tuple[$v.!, $v.!message]
# Result: tuple[false, ""]
```

```rill
# Error: Division by zero
guard { 1 / 0 } => $r
$r + 1
```

## Notes

On 0.23.0 an invalid value placed in a collection or interpolated does not halt: `list[$r]`
holds it, and `"{$r}"` yields `"dict[]"` (#612).
