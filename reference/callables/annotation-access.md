---
id: annotation-access
title: Annotation access
status: normative
since: 0.24.0
issues: [621, 624]
grammar: []
errors: [RILL-R003, RILL-R008]
depends: [annotation]
tests: [annotations.test.ts]
---

# Annotation access

`$f.^key` reads the annotation a function carries under `key`.

## Syntax

```text
$f.^key           read
$f.^key ?? d      read with a fallback
$f.?^key          test for presence
```

## Evaluation

r[annotation-access.read] .^key reads a function annotation
`$f.^key` on a function MUST yield the value stored under `key` on that function.

r[annotation-access.missing] A missing key halts
`$f.^key` for a key the function does not carry MUST halt with RILL-R008.

r[annotation-access.fallback] ?? replaces a missing annotation
`$f.^key ?? d` on a function MUST yield `d` when `key` is missing, and when its value is vacant
(`vacancy.fallback`). On a value that is not a function, the halt MUST NOT be replaced.

r[annotation-access.non-function] Only functions carry readable annotations
`$v.^key`, for any key other than `type` and `effective`, on a value that is not a function
MUST halt with RILL-R003.

r[annotation-access.presence] .?^key tests for an annotation {pending #621}
`$f.?^key` MUST yield whether the function carries `key`, and MUST NOT halt.

r[annotation-access.presence-other] .?^key on a value that cannot carry annotations is false {pending #621}
`$v.?^key` MUST yield false when `$v` is not a function.

## Interactions

Which annotations a function carries is stated in `annotation.attach`. Parameter annotations
are read from the function's type (`introspection.annotations`), not with `.^key`. `.^type`
and `.^effective` read a value's type (`introspection.type-probe`, `carried-type`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `.^key` names a key the function lacks | RILL-R008 | Yes |
| `.^key` on a value that is not a function | RILL-R003 | Yes |

## Examples

```rill pending=624
^(min: 0, max: 100) fn(x) { $x } => $f
tuple[$f.^min, $f.^max]
# Result: tuple[0, 100]
```

```rill pending=624
^("adds one") fn(x) { $x + 1 } => $f
$f.^description
# Result: "adds one"
```

```rill pending=624
fn(x) { $x } => $f
$f.^unit ?? "none"
# Result: "none"
```

```rill
# Error: annotation not found: ^a
5 => $v
$v.^a
```

## Notes

On 0.23.0 parameter annotations are read as `$f.params.x.__annotations.key`.
