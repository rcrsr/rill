---
id: interpolation
title: Interpolation
status: normative
since: 0.24.0
issues: []
grammar: [interpolation, brace-escape]
errors: [RILL-L005, RILL-P004, RILL-R005]
depends: [pipe]
tests: [interpolation.test.ts, interpolation-locations.test.ts]
---

# Interpolation

`{expr}` inside a string literal evaluates `expr` and inserts its printed form.

## Syntax

```ebnf
interpolation = "{" , expression , "}" ;
brace-escape = "{{" | "}}" ;
```

## Static rules

r[interpolation.non-empty] An interpolation holds an expression
`{}` and `{ }` MUST be rejected with RILL-P004.

r[interpolation.brace-escape] Doubled braces are literal braces
`{{` MUST stand for `{` and `}}` for `}`. A backslash before a brace MUST be rejected with
RILL-L005.

## Evaluation

r[interpolation.order] Interpolations evaluate left to right
Each interpolation MUST be evaluated once, from left to right, when the string literal is
evaluated.

r[interpolation.expression] Any expression may be interpolated
An interpolation MUST accept any expression, including a pipe chain and a nested string.

r[interpolation.dollar] $ is the enclosing $
`$` inside an interpolation MUST be the `$` bound where the string stands. With none bound,
`{$}` MUST halt with RILL-R005.

r[interpolation.string] A string inserts its text
A string MUST be inserted as its text, without quotes.

r[interpolation.printed] Other values insert their printed form
A value of another kind MUST be inserted as the string conversion yields it
(`string.from-number`, `string.from-bool`, `string.from-collection`). An atom MUST be inserted
with its `#`, and a type value as its signature.

## Interactions

A pipe into a string literal binds `$` for its interpolations (`pipe.string`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| An empty interpolation | RILL-P004 | No |
| A backslash before a brace | RILL-L005 | No |
| `{$}` with no `$` bound | RILL-R005 | Yes |

## Examples

```rill
3 => $n
"n={$n}, next={$n + 1}"
# Result: "n=3, next=4"
```

```rill
"x" -> "<{$ -> .upper}>"
# Result: "<X>"
```

```rill
"{list[1, 2]} {#ok} {true}"
# Result: "list[1, 2] #ok true"
```

```rill
"{{literal}}" -> .len
# Result: 9
```

## Notes

Open decision: #617. A capture inside an interpolation binds in the enclosing scope on 0.23.0,
while a grouped capture does not.

On 0.23.0 a function interpolates as `"type(closure)"` (#605), and an invalid value as
`"dict[]"` (#612).

Open decision: #605, whether converting a function or an iterator to a string halts or yields a
stated form.

Open decision: #612, whether interpolating an invalid value halts.
