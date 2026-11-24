---
id: annotation
title: Annotations
status: normative
since: 0.24.0
issues: []
grammar: [annotation, annotated-expr]
errors: [RILL-P001, RILL-R002, RILL-R081]
depends: [notation, halt, statement]
tests: [annotations.test.ts, closure-annotation-defaults.test.ts, dict-field-annotations.test.ts]
---

# Annotations

`^(key: value, ...)` attaches inert metadata to a statement, a function, a parameter, or a
field of a structural type.

## Syntax

```ebnf
annotation    = "^" , "(" , annotation-args , ")" ;
annotated-expr = annotation , primary ;
```

```text
^(note: "x") $a -> $f()           on a statement
^(min: 0, max: 100) fn(x) { $x }  on a function
^("adds one") fn(x) { $x + 1 }    description shorthand
fn(^(min: 0) x: number) { $x }   on a parameter
dict(^("label") name: string)     on a field
^(...$opts) fn(x) { $x }          entries spread from a dict
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

r[annotation.target] An annotation needs a target
`^(...)` with no statement, function, parameter, or field after it MUST be rejected with
RILL-P001.

r[annotation.newline] A line ending after an annotation does not end it
Blank lines between `^(...)` and its target MUST NOT separate them.

r[annotation.limit-in-call] A limit annotation inside a call is rejected
`^(limit: N)` before a function argument MUST halt with RILL-R081, naming the loop option.

## Evaluation

r[annotation.values] Values are expressions evaluated once
Each value MUST be evaluated once, when the annotated statement, function, or type is
evaluated.

r[annotation.repeat-key] A later key replaces an earlier one
When one key appears twice, the value written later MUST win.

r[annotation.spread] A spread adds a dict's entries as keys
`...$d` inside `^(...)` MUST add each entry of the dict `$d` as a key, in order with the keys
written beside it (`annotation.repeat-key`).

r[annotation.spread-dict] A spread of a non-dict halts
A spread value inside `^(...)` that is not a dict MUST halt with RILL-R002.

r[annotation.stack] Stacked blocks merge
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
annotations are read from the type (`introspection.annotations`), and a tuple type has none to read
(`introspection.annotations-tuple`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A reserved, numeric, or string key, a `list` element annotation, or no target | RILL-P001 | No |
| A spread value that is not a dict (`annotation.spread-dict`) | RILL-R002 | Yes |
| `^(limit: N)` before a function argument | RILL-R081 | No |

## Examples

```rill
5 => $n
^(k: $n + 1) fn(x) { $x } => $f
$f.^k
# Result: 6
```

```rill
^(note: "inert") 0 -> while ($ < 3) do { $ + 1 }
# Result: 3
```

```rill
# Error: Annotation key "type" is reserved
^(type: "x") fn(x) { $x }
```

## Notes

On 0.23.0 field annotations are visible only to the host. A code block written after `^(...)`
runs as a block and keeps no annotation. The core reads
`description`, and the older `doc` key, when it describes a host function. Which type
arguments take an annotation, a string written after the first argument, and a reserved key
reached through a spread are unstated: see INCONSISTENCIES.md.
