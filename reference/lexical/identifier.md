---
id: identifier
title: Identifiers
status: normative
since: 0.24.0
issues: []
grammar: [identifier, letter, uppercase-letter, lowercase-letter, digit]
errors: [RILL-L002]
depends: [notation, halt, source-text]
tests: [lexer.test.ts]
---

# Identifiers

An identifier is a name made of ASCII letters, digits, and underscores, used for variables, dict
keys, fields, functions, and atoms.

## Syntax

```ebnf
identifier    = ( letter | "_" ) , { letter | digit | "_" } ;
letter        = uppercase-letter | lowercase-letter ;
uppercase-letter = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M"
                 | "N" | "O" | "P" | "Q" | "R" | "S" | "T" | "U" | "V" | "W" | "X" | "Y" | "Z" ;
lowercase-letter = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m"
                 | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z" ;
digit         = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
```

snake_case is the convention, not a rule.

## Static rules

r[identifier.form] An identifier starts with a letter or underscore
An identifier MUST start with an ASCII letter or `_` and continue with ASCII letters, digits, and
`_`. `$_`, `$__a1`, and `dict[a_b_c9: 1]` are accepted.

r[identifier.ascii] A non-ASCII letter is rejected
A non-ASCII letter where an identifier is read MUST be rejected with RILL-L002, as
`source-text.charset` states. `$é` and `dict[é: 1]` are rejected.

r[identifier.case] Identifiers are case-sensitive
Two identifiers MUST be the same name only when they match character for character, case
included. `$X` and `$x` are two variables, and `dict[A: 1]` has no field `a`.

## Interactions

A `$` followed by a digit follows `variable.name`. A digit-first key such as `dict[1a: 1]` reads a
number first and follows `number.malformed`. Which identifiers are reserved follows
`keyword.reserved`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A non-ASCII letter where an identifier is read (`identifier.ascii`) | RILL-L002 | No |

## Examples

```rill
1 => $x
2 => $X
$x + $X
# Result: 3
```

```rill
# Error: RILL-L002
"a" => $é
```
