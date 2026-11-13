---
id: declaration
title: Declarations
status: normative
since: 0.24.0
issues: [571]
grammar: []
errors: [TYPE_MISMATCH, RILL-R002]
depends: [type-value, structural-typing, any, list, dict, union, carried-type, inference]
tests: [collection-literals.test.ts, statement-boundaries.test.ts, type-var-positions.test.ts]
---

# Declarations

A declaration is a type construction: a type written in front of a literal, such as `union(string, number) 42 => $x` or `list(number)[]`, and the type it sets is the declared type.

## Syntax

r[declaration.form] A type followed by a value forms one literal {pending #571}
A written type followed by a value on the same line MUST form one literal.

    declaration = type-form , literal ;

## Static rules

r[declaration.written] Only a written type takes a value
A `$` variable that holds a type, followed by a bracket, MUST be an index and MUST NOT
construct a value. Indexing a type value MUST halt with RILL-R002.

r[declaration.newline] A newline ends the expression
A type alone on a line MUST be a complete statement. A value on the next line MUST be a
separate statement.

r[declaration.spacing] Spaces between a type and its value are legal {pending #571}
`list [1, 2]` MUST be accepted and MUST mean `list[1, 2]`.

r[declaration.atom] An atom after a type on the same line is the type's value {pending #571}
An atom that follows a written type on the same line MUST be read as that type's value, not
as a comment.

## Evaluation

r[declaration.sets-type] The type in front sets the declared type {pending #571}
The value MUST be checked against the written type where it is written, and the declared
type MUST travel with the value as `carried-type.carriage-declared` states.

r[declaration.mismatch] A value that lacks the written type halts {pending #571}
A literal whose value does not have the written type MUST halt with `#TYPE_MISMATCH`.

r[declaration.spellings] A literal has a complete, a kind, and a bare spelling {pending #571}
`list(number)[1]`, `list[1]`, and `[1]` MUST yield equal values. The complete spelling
writes the whole type, the kind spelling writes the name and leaves the inner to inference,
and the bare spelling writes the value alone.

r[declaration.kind] A kind spelling leaves the inner to inference
A collection written with its kind and no inner, such as `list[1, 2]`, MUST take the inferred
type of its elements.

r[declaration.leaf] A leaf type needs no inner {pending #571}
For a leaf type such as `string`, the complete and kind spellings coincide, and `string() "a"`
MUST mean `string "a"`.

r[declaration.scalar] Any value takes a type in front, scalars included {pending #571}
`union("a", "b") "a"` MUST declare a string into the closed set at the literal.

r[declaration.unspecified] An unspecified inner in front of a value is inferred {pending #571}
`list()[1]` and `list[1]` MUST both take the type inferred from `1`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A literal's value lacks the written type {pending #571} | `#TYPE_MISMATCH` | Yes |
| A `$` variable holding a type is indexed | RILL-R002 | Yes |

## Examples

```rill
list[1, 2].^type.signature
# Result: "list(number)"
```

```rill pending=571
list(number)[1, 2] == [1, 2]
# Result: true
```

```rill pending=571
union("a", "b") "a" => $x
$x.^type.signature
# Result: "union(\"a\", \"b\")"
```

## Notes

`RILL-P007` ("keyword and bracket must be adjacent") is removed in 0.24.0; spacing between a
type and its value becomes a checker finding.

Until the pending rules are built, a type followed by a value on the same line runs as two
statements, and the value is the result.

The mismatch row's catchability follows the assertion halt; no source fixes it separately.
