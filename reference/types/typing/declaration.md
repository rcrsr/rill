---
id: declaration
title: Declarations
status: normative
since: 0.24.0
issues: []
errors: [TYPE_MISMATCH, RILL-P001, RILL-R002]
depends: [type-value, structural-typing, any, list, dict, union, carried-type, inference]
grammar: [declaration]
tests: [collection-literals.test.ts, declarations.test.ts, statement-boundaries.test.ts, type-var-positions.test.ts]
---

# Declarations

A declaration is a type construction: a type written in front of a literal, such as `union(string, number) 42 => $x` or `list(number)[]`, and the type it sets is the declared type.

## Syntax

r[declaration.form] A type followed by a value forms one literal
A written type followed by a value on the same line MUST form one literal. A negative number
value follows `number.negative`, so `number -1` declares `-1` and `number - 1` is subtraction,
which halts with RILL-R002.

```text
declaration   = type-form , ( string | number | bool | atom-literal | list | dict | tuple | ordered ) ;
```

## Static rules

r[declaration.written] Only a written type takes a value
A `$` variable that holds a type, followed by a bracket, MUST be an index and MUST NOT
construct a value. Indexing a type value MUST halt with RILL-R002.

r[declaration.newline] A newline ends the expression
A type alone on a line MUST be a complete statement. A value on the next line MUST be a
separate statement.

r[declaration.spacing] Spaces between a type and its value are legal
`list [1, 2]` MUST be accepted and MUST mean `list[1, 2]`.

r[declaration.atom] An atom after a type on the same line is the type's value
An atom that follows a written type on the same line MUST be read as that type's value, not
as a comment.

r[declaration.pipe-target] A declared literal as a pipe target acts as a pipe into a variable holding it
A declared literal used as a pipe target MUST be checked as `declaration.mismatch` states, then
MUST behave as a pipe into a variable that holds it. A string value MUST act as the bare string
target. The form MUST be legal only where the bare value is a legal target: a list, a dict, or a
string. A number, bool, atom, tuple, or ordered value as the target MUST be a parse error,
RILL-P001. `pipe.data-no-dollar` owns RILL-P030 and `pipe.string` owns RILL-P031; both apply to the inner
value, and a `??` default attaches to the inner value.

## Evaluation

r[declaration.sets-type] The type in front sets the declared type
The value MUST be checked against the written type where it is written, and the declared
type MUST travel with the value as `carried-type.carriage-declared` states.

r[declaration.mismatch] A value that lacks the written type halts
A literal whose value does not have the written type MUST halt with `#TYPE_MISMATCH`.

r[declaration.spellings] A type in front has a complete and a kind spelling
`list(number)[1]` and `list[1]` MUST yield equal values. The complete spelling writes the
whole type, and the kind spelling writes the name and leaves the inner to inference.
`list.bare` owns the equivalence of `[1]` with `list[1]`.

r[declaration.kind] A kind spelling leaves the inner to inference
A collection written with its kind and no inner, such as `list[1, 2]`, MUST take the inferred
type of its elements.

r[declaration.leaf] A leaf type needs no inner
For a leaf type such as `string`, the complete and kind spellings coincide, and `string() "a"`
MUST mean `string "a"`.

r[declaration.scalar] Any value takes a type in front, scalars included
`union("a", "b") "a"` MUST declare a string into the closed set at the literal.

r[declaration.unspecified] An unspecified inner in front of a value is inferred
`list()[1]` and `list[1]` MUST both take the type inferred from `1`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A literal's value lacks the written type | `#TYPE_MISMATCH` | Yes |
| A `$` variable holding a type is indexed | RILL-R002 | Yes |
| A number, bool, atom, tuple, or ordered declared literal is a pipe target | RILL-P001 | No |

## Examples

```rill
list[1, 2].^type.signature
# Result: "list(number)"
```

```rill
list(number)[1, 2] == [1, 2]
# Result: true
```

```rill
list [1, 2] == list[1, 2]
# Result: true
```

```rill
union("a", "b") "a" => $x
$x.^type.signature
# Result: "union(\"a\", \"b\")"
```

```rill
list()[1] => $a
$a.^type.signature
# Result: "list(number)"
```

```rill
union(#off, #on) #on => $s
$s.^type.signature
# Result: "union(#off, #on)"
```

```rill
guard { list(number)["a"] } => $r
$r.!code
# Result: #TYPE_MISMATCH
```

```rill
list(number)
[1, 2]
# Result: list[1, 2]
```

## Notes

`RILL-P007` ("keyword and bracket must be adjacent") no longer rejects a space between a
written type and its value. It still rejects `use <...>` (`use.adjacent`) and a second spread
(`spread.one-argument`).

The mismatch row's catchability follows the assertion halt; no source fixes it separately.
