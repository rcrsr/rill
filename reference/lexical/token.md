---
id: token
title: Tokens
status: normative
since: 0.24.0
issues: []
grammar: [literal, digits, nonzero-digit]
errors: [RILL-P001, RILL-P009]
depends: [notation, halt, source-text, whitespace]
tests: [lexer.test.ts, lexer-capture-arrow.test.ts]
---

# Tokens

A token is the smallest unit the parser reads: an operator, a delimiter, an identifier, a keyword,
or a literal.

## Syntax

```ebnf
literal       = string | number | bool | list | dict | tuple | ordered | map | fn-literal ;
digits        = digit , { digit } ;
nonzero-digit = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
```

Each literal form is owned by its type's concept. The two-character operators are `->`, `=>`,
`&&`, `||`, `==`, `!=`, `<=`, `>=`, `??`, `.?`, `.!`, and `::`.

## Static rules

r[token.longest] The lexer takes the longest operator
At each position the lexer MUST read the longest operator that matches. `1 === 1` reads `==`
then `=`, and `1 ->> 2` reads `->` then `>`; both MUST be rejected with RILL-P001.

r[token.split] Whitespace inside a two-character operator splits it
A two-character operator with whitespace between its characters MUST read as two tokens.
`1 - > 2`, `1 ! = 2`, and `1 = > $x` MUST be rejected with RILL-P001.

r[token.stray-closer] A closer with no opener is rejected
A `)`, `]`, or `}` with no matching opener MUST be rejected with RILL-P001.

r[token.removed-sigil] Removed sigil forms are rejected
At the start of an expression, `*[`, `*<`, and `/<` MUST be rejected with RILL-P009.

## Interactions

`::` reads as one token and is rejected where `use` forbids the namespaced call. The removed `@`
forms follow `loop`. The removed `|x|` literal follows `fn`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| Tokens in an order the grammar rejects (`token.longest`, `token.split`, `token.stray-closer`) | RILL-P001 | No |
| A removed sigil form starts an expression (`token.removed-sigil`) | RILL-P009 | No |

## Examples

```rill
1 != 2
# Result: true
```

```rill
# Error: RILL-P009 use tuple[...] instead
*[1, 2]
```

## Notes

The removed sigil forms are `*[` (now `tuple[` or `ordered[`), `*<` (now `destruct<`), and `/<`
(now `slice<`). The error id for an opener left unclosed at the end of input is unstated: see
INCONSISTENCIES.md.
