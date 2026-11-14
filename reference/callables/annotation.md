---
id: annotation
title: Annotations
status: normative
since: 0.24.0
issues: [565, 620, 621]
grammar: []
errors: [RILL-P001, RILL-R003, RILL-R008, RILL-R081]
depends: [introspection, code-block]
tests: [annotations.test.ts, closure-annotation-defaults.test.ts, dict-field-annotations.test.ts]
---

# Annotations

`^(key: value, ...)` attaches inert metadata to a statement, a function, a parameter, or a
field of a structural type, and `.^key` reads a function's annotation back.

## Syntax

```text
^(min: 0, max: 100) |x| ($x)      on a function
^("adds one") |x| ($x + 1)        description shorthand
|^(min: 0) x: number| ($x)        on a parameter
dict(^("label") name: string)     on a field
^(note: "x") $a -> $f()           on a statement
$f.^min                           read a function annotation
```

## Static rules

r[annotation.key] A key is an identifier
Each key MUST be an identifier. A number or a string written as a key MUST be rejected with
RILL-P001.

r[annotation.reserved] type and effective are reserved
The keys `type` and `effective` MUST be rejected with RILL-P001.

r[annotation.shorthand] A leading string is the description
A string written first in `^(...)` MUST mean `description: <string>`.

r[annotation.positions] Annotations precede a statement, function, parameter, or field
`^(...)` MUST be accepted before a statement, a function literal, a function parameter, and a
field or position of a `dict`, `ordered`, or `tuple` type. Before a `list` element type it MUST
be rejected with RILL-P001.

r[annotation.limit-in-call] A limit annotation inside a call is rejected
`^(limit: N)` before a function argument MUST halt with RILL-R081, naming the loop option.

## Evaluation

r[annotation.values] Values are expressions evaluated once
Each value MUST be evaluated once, when the annotated function, type, or statement is
evaluated.

r[annotation.repeat-key] A later key replaces an earlier one
When one key appears twice, the value written later MUST win.

r[annotation.stack] Stacked blocks merge {pending #620}
Two or more `^(...)` blocks before one target MUST merge into one annotation map, in every
position.

r[annotation.inert] Annotations do not change evaluation
An annotation MUST NOT change how its target evaluates. A statement annotation MUST NOT be
readable from any value.

r[annotation.read] .^key reads a function annotation
`$f.^key` on a function MUST yield the value stored under `key` on that function.

r[annotation.direct] An annotation belongs to the function it precedes
A function created inside an annotated function MUST NOT carry the outer function's
annotations.

r[annotation.missing] A missing key halts
`$f.^key` for a key the function does not carry MUST halt with RILL-R008.

r[annotation.fallback] ?? replaces a missing annotation
`$f.^key ?? d` on a function MUST yield `d` when `key` is missing, and when its value is vacant
(`vacancy.fallback`). On a value that is not a function, the halt MUST NOT be replaced.

r[annotation.non-function] Only functions carry readable annotations
`$v.^key`, for any key other than `type` and `effective`, on a value that is not a function
MUST halt with RILL-R003.

r[annotation.presence] .?^key tests for an annotation {pending #621}
`$f.?^key` MUST yield whether the function carries `key`, and MUST NOT halt.

r[annotation.param-read] Parameter and field annotations are read from the type {pending #565}
Parameter and field annotations MUST be read through the type's `.annotations`
(`introspection.annotations`), never through `.^key` on the function.

## Interactions

`.^type` and `.^effective` read a value's type
(`introspection.type-probe`, `carried-type`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A reserved, numeric, or string key, or a `list` element annotation | RILL-P001 | No |
| `^(limit: N)` before a function argument | RILL-R081 | No |
| `.^key` names a key the function lacks | RILL-R008 | Yes |
| `.^key` on a value that is not a function | RILL-R003 | Yes |

## Examples

```rill
^(min: 0, max: 100) |x| ($x) => $f
tuple[$f.^min, $f.^max]
# Result: tuple[0, 100]
```

```rill
^("adds one") |x| ($x + 1) => $f
$f.^description
# Result: "adds one"
```

```rill
|x| ($x) => $f
$f.^unit ?? "none"
# Result: "none"
```

```rill
5 => $n
^(k: $n + 1) |x| ($x) => $f
$f.^k
# Result: 6
```

```rill
# Error: Annotation key "type" is reserved
^(type: "x") |x| ($x)
```

## Notes

On 0.23.0 parameter annotations are read as `$f.params.x.__annotations.key`, and field
annotations are visible only to the host. A code block written after `^(...)` becomes a
function, which `code-block` does not allow on 0.24.0. The core reads `description`, and the
older `doc` key, when it describes a host function.
