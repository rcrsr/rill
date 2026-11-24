---
id: source-text
title: Source text
status: normative
since: 0.24.0
issues: []
grammar: [newline]
errors: [RILL-L002]
depends: [notation, halt]
tests: [lexer.test.ts, literals.test.ts, strings.test.ts]
---

# Source text

A script's source text is a sequence of Unicode characters, read in lines, that the lexer splits
into tokens.

## Syntax

```ebnf
newline       = "\n" | "\r\n" ;
```

## Static rules

r[source-text.bom] A leading byte-order mark is skipped
A U+FEFF byte-order mark as the first character of the source MUST be skipped, and the source
MUST then read as if it were absent.

r[source-text.bom-elsewhere] A byte-order mark anywhere else is rejected
A U+FEFF outside a string literal or a comment, anywhere but the first character, MUST be
rejected with RILL-L002. A second U+FEFF directly after the leading one is rejected.

r[source-text.line-end] A line feed ends a line
A line feed MUST end a line. A carriage return directly before a line feed MUST belong to that
line ending, so `"a"` CR LF `"b"` reads as two lines.

r[source-text.charset] Characters outside the token set are rejected
Outside a string literal and a comment, each of `;`, `'`, `` ` ``, `~`, `\`, U+0000, and every
non-ASCII character MUST be rejected with RILL-L002.

r[source-text.free-text] A string literal or comment accepts any character
Inside a string literal or a comment, any character MUST be accepted as text, including U+0000,
U+FEFF, and non-ASCII characters. `"😀"` is a valid literal.

## Interactions

Where a line ending ends a statement follows `statement.continuation`. Whitespace between tokens
follows `whitespace.blank`. A carriage return inside a one-line string follows
`string.single-line`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A byte-order mark appears after the first character (`source-text.bom-elsewhere`) | RILL-L002 | No |
| A character outside the token set appears outside a string or comment (`source-text.charset`) | RILL-L002 | No |

## Examples

```rill
# Error: RILL-L002
1 ; 2
```

```rill
"a ; b ~ c"
# Result: "a ; b ~ c"
```

## Notes

A carriage return not followed by a line feed is unstated: see INCONSISTENCIES.md.
