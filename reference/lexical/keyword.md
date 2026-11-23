---
id: keyword
title: Keywords
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R006]
depends: [notation, halt, identifier]
tests: [lexer.test.ts, dict-key-form.test.ts]
---

# Keywords

A keyword is a reserved identifier that always starts its own construct or literal.

## Syntax

The reserved words are `true`, `false`, `break`, `return`, `yield`, `pass`, `assert`, `error`,
`guard`, `retry`, `while`, and `do`.

## Static rules

r[keyword.reserved] A reserved word always reads as its construct
Each reserved word, written where an expression or statement starts, MUST read as its construct or
literal and never as a function call, even when the host registers a function of that name.

r[keyword.lowercase] Reserved words are lowercase
A reserved word MUST match in lowercase only. `While` and `Guard` are identifiers.

r[keyword.other] No other word is reserved
An identifier outside the reserved list MUST NOT be a keyword. `for`, `if`, `let`, `else`, and
`in`, written bare, MUST read as calls to a function of that name.

r[keyword.name] A reserved word may name a key, field, variable, or atom
A reserved word MUST be accepted as a dict key, as a field name after `.`, as a variable name
after `$`, and as an atom name after `#`. `dict[while: 1].while` yields `1`, `1 => $true` binds
`$true`, and `#error` is an atom.

## Interactions

Words that open a construct only before a following token, such as `use<`, `destruct<`, `slice<`,
and `timeout(`, are owned by `use`, `destruct`, `slice`, and `construct-options`. Type names in
an expression follow `type-value`. `True` is not a bool literal (`bool.case`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A bare non-reserved word names no function (`keyword.other`) | RILL-R006 | Yes |

## Examples

```rill
dict[while: 1, error: 2] => $d
$d.while + $d.error
# Result: 3
```

```rill
# Error: RILL-R006 for is a function name, not a keyword
for
```
