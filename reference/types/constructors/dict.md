---
id: dict
title: Dict types
status: normative
since: 0.24.0
issues: []
grammar: [field-key]
errors: [RILL-P006, RILL-P012, RILL-P027, TYPE_MISMATCH]
depends: [type-value, type-form]
tests: [uniform-value-type.test.ts, structural-type-identity.test.ts, structural-type-boundaries.test.ts, type-inner-outer.test.ts, type-assertions.test.ts, unspecified-type-args.test.ts, type-form-outer.test.ts, type-field-keys.test.ts, bare-bracket-literals.test.ts]
---

# Dict types

A dict type describes a dict by its named fields, one type per field.

## Syntax

```ebnf
field-key        = identifier | string | number | bool
                 | "break" | "return" | "yield" | "pass" | "assert"
                 | "error" | "guard" | "retry" | "while" | "do" ;
```

```text
dict                          any dict
dict(a: number, b: string)    one type per named field
```

r[dict.field-default] A named field MAY carry a default
A named field MAY carry a default, as in `dict(a: number = 1)`.

r[dict.field-type] A field type is any type
A field type MUST be any type, and a dict type MAY nest, as in `dict(a: list(number))`.

r[dict.fields] A dict type always names its fields
Every argument of a dict type MUST carry a field name.

r[dict.no-uniform] A dict type has no uniform form
`dict(V)` MUST be rejected with RILL-P012, and the message MUST name `map(string, V)`.

r[dict.empty-parens] dict and dict() are one type
`dict` and `dict()` MUST compare equal.

## Static rules

r[dict.no-outer] A dict type takes no outer
A dict type written with an outer, such as `dict(a: number):string`, MUST be a parse error.

r[dict.key-string] A dict key is always a string 
A key written as a number or a bool MUST be the string of its spelling, so `dict[1: "n"]`
equals `dict["1": "n"]`.

r[dict.key-duplicate] A key written twice in one literal is rejected
A literal that spells one key twice, including a number and the string with the same text,
MUST be rejected at parse time with RILL-P027.

r[dict.type-key-duplicate] A type that names one key twice is rejected
A dict or ordered type that names one key twice, in any spelling, MUST be rejected at parse time
with RILL-P027.
`dict("a b": number, "a b": string)` MUST NOT parse.

r[dict.bare] A bare bracket dict is shorthand for the keyword dict
A dict literal written as `[a: 1]` MUST mean `dict[a: 1]`, and `[:]` MUST mean `dict[]`: the two
MUST yield equal values of equal type, at every nesting depth, with the key rules of
`dict.key-string` and `dict.key-duplicate`. A bare dict MUST accept every entry `dict[...]`
accepts, including a spread entry as in `[...$d, b: 2]`, a variable key as in `[$k: 1]`, and a
computed key as in `[(expr): 1]`.

In a bare bracket, `$x:` and `(expr):` MUST read as keys, as in `dict[...]`, so `[$x:number]` is a
dict. A bracket of only spreads is a list (`list.bare`), so a spread-only dict is written
`dict[...$d]`.

r[dict.key-spelling] A dict type accepts every key spelling a literal accepts
A named field MUST be written as any `field-key` spelling, reserved words such as `while`
included. The key is a string in each case.

r[dict.key-print] A printed dict or ordered type parses back to an equal type
A dict or ordered signature MUST print a key bare when it is spelled as a letter or `_` followed by
letters, digits or `_`, other than `true` and `false`. It MUST print every other key quoted. A
reserved word such as `while` prints bare, and `true`, `false`, `1`, and `a b` print quoted.

## Evaluation

r[dict.field-equality] Dict types are equal when their fields and types are equal
Two dict types MUST be equal when they name the same fields with equal types, in any order.

r[dict.field-inner] A dict type's inner is its fields
`.inner` MUST return a dict of field types.

r[dict.field-print] A dict type prints its fields
A dict type MUST print as `dict(a: T, ...)`.

r[dict.value-print] A dict value prints in the keyword spelling
A dict value MUST print as `dict[...]` and never as a bare bracket dict, so `[a: 1]` prints
`dict[a: 1]`, `[:]` prints `dict[]`, and `[a: 1, b: [1]]` prints `dict[a: 1, b: list[1]]`.

r[dict.entries-type] A dict's entries are string-keyed tuples
`.entries` on a dict or an ordered whose values have type `V` MUST return
`list(tuple(string, V))`, one `tuple[key, value]` per entry.

## Interactions

An unknown type name as an argument follows `type-form.unknown-name`, and a variable argument
that holds a non-type follows `type-value.variable-halt`. Which dicts have a dict type follows
`structural-typing.exact-dict` and `structural-typing.bare-dict`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| Outer on a type that takes none | RILL-P006 | No |
| An argument with no field name, as in `dict(V)` | RILL-P012 | No |
| Value has a field a named form does not name (`structural-typing.exact-dict`) | `#TYPE_MISMATCH` | Yes |
| A literal spells one key twice | RILL-P027 | No |
| A type names one key twice | RILL-P027 | No |

## Examples

```rill
[a: 1, b: 2] == dict[a: 1, b: 2]
# Result: true
```

```rill
[:] == dict[]
# Result: true
```

```rill
dict[a: 1] => $d
"k" => $k
[...$d, b: 2, $k: 3, ("x" -> .upper): 4] == dict[a: 1, b: 2, k: 3, X: 4]
# Result: true
```

```rill
[1: "x"] == dict["1": "x"]
# Result: true
```

```rill
dict[a: 1, b: 2] -> :?dict
# Result: true
```

```rill
# Error: RILL-P012
dict(number)
```

```rill
dict(a: number, b: string) == dict(b: string, a: number)
# Result: true
```

```rill
dict(a: number, b: string).inner.b == string
# Result: true
```

```rill
dict[a: 1, b: 2] -> :?dict(a: number)
# Result: false
```

```rill
dict("a b": number) == dict["a b": 1].^type
# Result: true
```

```rill
ordered[while: 1, true: 2, 1: 3].^type.signature
# Result: "ordered(while: number, \"true\": number, \"1\": number)"
```

## Notes

The 0.23.0 runtime accepts the uniform form: `dict(number)` is a type, `dict[a: 1, b: 2] -> :?dict(number)`
is true, `.inner` of `dict(T)` is `T`, and mixing named and unnamed arguments halts
`#INVALID_INPUT`. The form now halts RILL-P012, and a script rewrites `dict(V)` to `map(string, V)`.

Superseded rule ids: `dict.forms`, `dict.mixed`, `dict.uniform-count`, `dict.value-type`,
`dict.equality`, `dict.inner`, `dict.print`, `dict.unspecified`, `dict.any`,
`dict.named-membership`.

The 0.23.0 runtime keeps a number or bool key as a typed key, so `dict[1: "n"] == dict["1": "n"]`
is false and `.keys` returns `list[1]`. An empty dict infers the unspecified type, as an empty
list does, so `dict[].^type == dict()` is true and its type prints `dict`.
