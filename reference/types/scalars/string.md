---
id: string
title: Strings
status: normative
since: 0.24.0
issues: [560]
grammar: [string, char, escape, brace-escape, interpolation]
errors: [RILL-L001, RILL-L004, RILL-L005, RILL-P004, RILL-R002, RILL-R036, TYPE_MISMATCH]
depends: [notation, halt, type-value]
tests: [strings.test.ts, literals.test.ts, boolean.test.ts, interpolation.test.ts, type-assertions.test.ts]
---

# Strings

A string is an immutable sequence of Unicode characters that a literal writes between double quotes.

## Syntax

```ebnf
string        = '"' , { char | escape | brace-escape | interpolation } , '"'
              | '"""' , { char | escape | brace-escape | interpolation } , '"""' ;

char          = letter | digit | " " | "!" | "#" | "$" | "%" | "&" | "'" | "(" | ")"
              | "*" | "+" | "," | "-" | "." | "/" | ":" | ";" | "<" | "=" | ">"
              | "?" | "@" | "[" | "]" | "^" | "_" | "`" | "|" | "~" | newline ;
escape        = "\\" , ( "n" | "r" | "t" | "\\" | '"' ) ;
brace-escape  = "{{" | "}}" ;
interpolation = "{" , expression , "}" ;
```

## Static rules

r[string.single-line] A double-quoted string ends on its own line
A string opened with `"` MUST close before the end of the line, or raise RILL-L001.

r[string.escape] Five escapes are defined
In a double-quoted string, `\n`, `\r`, `\t`, `\\`, and `\"` MUST denote newline, carriage return,
tab, backslash, and double quote.

r[string.bad-escape] Any other backslash sequence is rejected
A backslash sequence outside the five defined MUST raise RILL-L005.

r[string.triple] A triple-quoted string spans lines and takes text as written
A string opened with `"""` MUST extend to the next `"""`, MAY contain newlines and double quotes,
and MUST NOT process backslash escapes.

r[string.triple-newline] A newline after the opening quotes is dropped
A newline directly after `"""` MUST be dropped.

r[string.triple-unclosed] An unclosed triple-quoted string is rejected
An unclosed triple-quoted string MUST raise RILL-L004.

r[string.brace-escape] A doubled brace is one literal brace
`{{` MUST denote `{` and `}}` MUST denote `}`, in either string form.

r[string.lone-brace] A lone closing brace stands for itself
A lone `}` outside an interpolation MUST stand for itself.

r[string.interpolation] A braced expression interpolates its printed form
`{expression}` MUST evaluate the expression and insert the value's printed form into the string.

r[string.empty-interpolation] An empty interpolation is rejected
`"{}"` MUST raise RILL-P004.

r[string.triple-interpolation] A triple quote inside an interpolation is rejected
A `"""` inside an interpolation of a triple-quoted string MUST raise RILL-L005.

## Evaluation

r[string.value] A string literal yields a string value
A string literal MUST yield its characters with each interpolation replaced by its printed form,
left to right.

r[string.print] A string prints as its own text
A string MUST print as its characters, without quotes, and interpolates unchanged.

r[string.equality] Two strings are equal when their code units match
`==` between two strings MUST yield true exactly when both hold the same UTF-16 code units, with
no case folding and no normalization.

r[string.ordering] Strings order by code unit
`<`, `>`, `<=`, and `>=` between two strings MUST compare UTF-16 code units from the first. A
proper prefix orders first.

## Interactions

r[string.no-arithmetic] A string is not an arithmetic operand
An arithmetic operator with a string operand MUST halt with RILL-R002. `+` MUST NOT concatenate.

r[string.cross-order] Ordering a string against another type halts
`<`, `>`, `<=`, and `>=` between a string and a non-string MUST halt with RILL-R002.

r[string.cross-equality] Equality against a non-string halts {pending #560}
`==` and `!=` between a string and an operand whose type does not overlap `string` MUST halt
with `#TYPE_MISMATCH`.

r[string.from-number] A number converts to its printed form
`number -> string` MUST yield the string a number prints as. `5 -> string` ⇒ `"5"`.

r[string.from-bool] A bool converts to its word
`true -> string` MUST yield `"true"` and `false -> string` MUST yield `"false"`.

r[string.from-collection] A collection converts to its printed form
A list, dict, tuple, or ordered piped into `string` MUST yield its printed form.
`list[1] -> string` ⇒ `"list[1]"`.

r[string.from-time] A datetime and a duration have no route
`datetime -> string` and `duration -> string` MUST halt with RILL-R036.

r[string.membership] Only a string satisfies string
A string MUST satisfy `:string`; any other value MUST halt it with `#TYPE_MISMATCH`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A double-quoted string is unclosed or crosses a line | RILL-L001 | No |
| A triple-quoted string is unclosed | RILL-L004 | No |
| A backslash escape is undefined, or `"""` appears inside a triple-quoted interpolation | RILL-L005 | No |
| An interpolation is empty | RILL-P004 | No |
| An arithmetic operand is a string, or an ordering operator mixes a string with a non-string | RILL-R002 | Yes |
| A datetime or duration is converted to string | RILL-R036 | Yes |
| A non-string is asserted as `:string` | `#TYPE_MISMATCH` | Yes |
| A string is compared for equality with a non-string {pending #560} | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
"hello" => $name
"hi {$name}, {1 + 1} apples"
# Result: "hi hello, 2 apples"
```

```rill
"""
no \n escape, "quotes" stay, {{braces}} collapse
"""
# Result: no \n escape, "quotes" stay, {braces} collapse
```

```rill
# Error: a string is not a number
"5" + 1
```

## Notes

The `string` production lists `newline` in `char`, but the lexer rejects it in a `"` string.
