---
id: interpolation
title: Interpolation
status: normative
since: 0.24.0
issues: []
grammar: [interpolation, brace-escape]
errors: [RILL-L005, RILL-P004, RILL-R005, RILL-R036]
depends: [pipe]
tests: [interpolation.test.ts, interpolation-locations.test.ts, interpolation-scope.test.ts]
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

r[interpolation.scope] An interpolation is a child scope
Each interpolation MUST run in a child scope, as a group does (`scope.child`). A capture inside
it MUST NOT bind in the enclosing scope.

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

A pipe into a string literal binds `$` for its interpolations (`pipe.string`). A function or an iterator has no printed form, alone (`conversion.no-string-form`) or inside a collection at any depth (`conversion.no-string-nested`), and neither has a vector (`conversion.no-string-vector`). A datetime or a duration inserts its printed form at any depth, though `-> string` halts on one (`conversion.no-string-time`). An invalid value raises the halt it holds (`invalid-value.interpolate`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| An empty interpolation | RILL-P004 | No |
| A backslash before a brace | RILL-L005 | No |
| `{$}` with no `$` bound | RILL-R005 | Yes |
| The value is a function, an iterator, or a vector, or a collection that holds one at any depth | RILL-R036 | Yes |

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

```rill
# Error: Undefined variable
"{5 => $q}"
$q
```

```rill
# Error: RILL-R036 a collection holding an iterator has no printed form
"{list[range(0, 3)]}"
```
