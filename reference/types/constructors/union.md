---
id: union
title: Union types
status: normative
since: 0.24.0
issues: [571, 574]
grammar: [union-type, union-member, union-literal]
errors: [RILL-P001, RILL-P003, RILL-R001, RILL-R003, RILL-R036, INVALID_INPUT, TYPE_MISMATCH]
depends: [type-value, atom]
tests: [union-types.test.ts, type-inner-outer.test.ts]
---

# Union types

A union is a type that accepts a value when at least one of its members accepts it.

## Syntax

```ebnf
union-type        = "union" , "(" , [ union-member , { "," , union-member } , [ "," ] ] , ")" ;
union-member      = type-ref | union-literal ;
union-literal     = string | number | bool | atom-literal ;
```

r[union.position] A union is written in any type position or as an expression
`union(...)` MUST be accepted in every type position and as an expression yielding a type value.
A union MAY be captured and used as a member of another union.

r[union.bare] A bare union outside a type position is a parse error
The word `union` without a parenthesized member list MUST raise RILL-P003.

r[union.colon-literal] A bare literal after a colon is a parse error
What follows a colon in a type position MUST be a type. A literal there MUST raise RILL-P001.
`union("c")` is the spelling of a one-value type.

## Static rules

r[union.no-outer] A union type takes no outer {pending #571}
A union type written with an outer, such as `union(number, string):string`, MUST be a parse error.

r[union.members] A member is a type or a scalar literal
A member MUST be a type or a string, number, bool, or atom literal.

r[union.member-match] A type member matches by type, a literal by equality
A value MUST match a type member when it has the type, and MUST match a literal member when
it equals the literal.

r[union.compound] A compound literal member halts
A list, dict, tuple, or ordered literal as a member MUST halt with `#INVALID_INPUT`.

r[union.empty] An empty union halts
`union()` MUST halt with `#INVALID_INPUT`.

r[union.duplicate] A member listed twice halts
A member written twice in one member list MUST halt with `#INVALID_INPUT`.

r[union.variable] A variable member holds a type
A variable member that holds a value other than a type MUST halt with `#TYPE_MISMATCH`.

## Evaluation

r[union.flatten] A nested union merges into its parent
A member that is itself a union MUST be merged into its parent.

r[union.reduce] A union drops a member another member accepts
A member that another member accepts MUST be dropped. `union(string, "a")` ⇒ `string`.

r[union.single] A union left with one type member equals that type
After reduction, a union with one type member MUST equal that type.

r[union.keep-default] A member that carries a default survives a broader member
A member MUST NOT be dropped when it declares a default that the accepting member does not
declare identically. `union(dict(a: string, b: string = "x"), dict)` keeps both members.

r[union.equality] Unions with the same members are equal in any order
Two unions MUST compare equal when their member sets are equal, regardless of written order.

r[union.canonical-order] A union prints its members in canonical order
Type members MUST come first, sorted by name. Literal members follow, grouped atom, bool,
number, string, and sorted by value within a kind. String literals sort in code-unit order.

r[union.inner] A union's inner lists its reduced members
`.inner` MUST return the members as a list in canonical order, after dropping and merging.
A union has no `.outer`.

r[union.no-collection] A union type has no collection properties
Reading `.len` or `.has` on a union type MUST halt with RILL-R003.

## Interactions

A pipe into a union follows `conversion.union` and `conversion.union-miss`. Hydration against
a union follows `defaults.hydration-union` and `defaults.hydration-tie`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| Member listed twice, empty union, or compound literal member | `#INVALID_INPUT` | Yes |
| Variable member holds a value that is not a type | `#TYPE_MISMATCH` | Yes |
| Assertion value matches no member | `#TYPE_MISMATCH` | Yes |
| Bare `union` without members | RILL-P003 | No |
| Bare literal after a colon | RILL-P001 | No |
| Parameter value matches no member | RILL-R001 | No |
| Pipe into a union a value with no member | RILL-R036 | Yes |
| `.len` read on a union type | RILL-R003 | Yes |

## Examples

```rill
union(string, number) => $t
42 -> :$t
# Result: 42
```

```rill
union(number, string) == union(string, number)
# Result: true
```

```rill
union(string, "a") == string
# Result: true
```

```rill pending=574
"5" -> union(number, string)
# Result: "5"
```

## Notes

The 0.23.0 `A|B` separator is removed and raises RILL-P011. Open decision: #569, the halt for a
typed capture whose value matches no member.

`union(number, string):string` parses today as an assertion of the type value against `string` and halts
`#TYPE_MISMATCH` at run time.
