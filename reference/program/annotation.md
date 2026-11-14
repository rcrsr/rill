---
id: annotation
title: Annotations
status: normative
since: 0.24.0
issues: [571, 620]
grammar: []
errors: [RILL-P001, RILL-R081]
depends: []
tests: [annotations.test.ts, closure-annotation-defaults.test.ts, dict-field-annotations.test.ts]
---

# Annotations

`^(key: value, ...)` attaches inert metadata to a statement, a function, a parameter, or a
field of a structural type.

## Syntax

```text
^(note: "x") $a -> $f()           on a statement
^(min: 0, max: 100) fn(x) { $x }  on a function
^("adds one") fn(x) { $x + 1 }    description shorthand
fn(^(min: 0) x: number) { $x }   on a parameter
dict(^("label") name: string)     on a field
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
Each value MUST be evaluated once, when the annotated statement, function, or type is
evaluated.

r[annotation.repeat-key] A later key replaces an earlier one
When one key appears twice, the value written later MUST win.

r[annotation.stack] Stacked blocks merge {pending #620}
Two or more `^(...)` blocks before one target MUST merge into one annotation map, in every
position.

r[annotation.attach] An annotation belongs to its target alone
An annotation MUST attach only to the statement, function, parameter, or field it precedes. A
function created inside an annotated function MUST NOT carry its annotations.

r[annotation.inert] Annotations do not change evaluation
An annotation MUST NOT change how its target evaluates. A statement annotation MUST NOT be
readable from any value.

## Interactions

A function's annotations are read with `.^key` (`annotation-access`). Parameter and field
annotations are read from the type (`introspection.annotations`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A reserved, numeric, or string key, or a `list` element annotation | RILL-P001 | No |
| `^(limit: N)` before a function argument | RILL-R081 | No |

## Examples

```rill pending=571
5 => $n
^(k: $n + 1) fn(x) { $x } => $f
$f.^k
# Result: 6
```

```rill
^(note: "inert") 0 -> while ($ < 3) do { $ + 1 }
# Result: 3
```

```rill pending=571
# Error: Annotation key "type" is reserved
^(type: "x") fn(x) { $x }
```

## Notes

On 0.23.0 field annotations are visible only to the host. A code block written after `^(...)`
becomes a function, which `code-block` does not allow on 0.24.0. The core reads
`description`, and the older `doc` key, when it describes a host function.
