---
id: whitespace
title: Whitespace and comments
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-L002]
depends: [notation, halt, source-text]
tests: [lexer.test.ts, strings.test.ts]
---

# Whitespace and comments

Whitespace separates tokens, and a comment is text the lexer discards up to the end of its line.

## Syntax

The whitespace characters are space (U+0020) and tab (U+0009). A comment starts at a `#` that
`atom.comment` makes a comment and ends at the next line feed.

## Static rules

r[whitespace.blank] Spaces and tabs between tokens carry no meaning
Any run of spaces and tabs between two tokens MUST read as a single separator. `1	+	2` and
`1     +     2` MUST read as `1 + 2`.

r[whitespace.optional] Tokens need no separator
Two adjacent tokens that do not join into one token (`token.longest`) MUST read the same with or
without whitespace between them. `1+2` MUST read as `1 + 2`, and `1->{ $ + 1 }` as
`1 -> { $ + 1 }`.

r[whitespace.member] Whitespace around a member dot carries no meaning
Whitespace before or after the `.` of a field access MUST NOT change it. `$d. a` and `$d .a`
MUST read as `$d.a`.

r[whitespace.other] Other whitespace characters are rejected
Outside a string literal and a comment, every whitespace character other than space, tab, and the
line ending MUST be rejected with RILL-L002. U+00A0, U+000B, U+000C, U+2028, and U+3000 are
rejected.

r[whitespace.comment] A comment runs to the end of its line and is discarded
A comment MUST run from its `#` to the next line feed and MUST yield no token. A line holding
only a comment MUST read as an empty line.

r[whitespace.comment-text] Text in a comment opens no token
A character inside a comment MUST NOT open a token. A quote, a brace, or `=>` in a comment MUST NOT
start a string, a block, or a capture.

r[whitespace.string-hash] A hash inside a string is text
A `#` inside a string literal MUST be part of the string and MUST NOT start a comment.
`"a # b"` yields `"a # b"`.

## Interactions

Whether a `#` starts a comment or an atom follows `atom.spelling` and `atom.comment`. Where a line
ending ends a statement follows `statement.continuation`. Three places require tokens to touch:
`number.negative`, `atom.spelling`, and `use.adjacent`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A whitespace character other than space, tab, or a line ending (`whitespace.other`) | RILL-L002 | No |

## Examples

```rill
dict[a: 1] => $d
$d. a
# Result: 1
```

```rill
# a line holding only a comment
"x # not a comment" # a comment with a "quote
# Result: "x # not a comment"
```
