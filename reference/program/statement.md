---
id: statement
title: Statements
status: normative
since: 0.24.0
issues: []
grammar: [script, statement]
errors: [RILL-R005, RILL-R043, RILL-P001]
depends: [notation, halt, whitespace]
tests: [block-scoping.test.ts, statement-boundaries.test.ts, whitespace-continuations.test.ts]
---

# Statements

A script and a block are sequences of statements, each a pipe chain that starts without a
pipe value.

## Syntax

```ebnf
script = [ frontmatter ] , { statement } ;
statement = [ annotation ] , ( pipe-chain | assert-statement | error-statement ) ;
```

A line that begins with `->` or `=>` continues the chain of the line before it.

## Static rules

r[statement.same-line] Two statements may share a line
A complete statement followed on the same line by the start of another MUST read as two
statements. `1 2` yields `2`, and `1 => $a 2` yields `2`.

r[statement.trailing-operator] A line ending in an operator continues
A line that ends with `->`, `=>`, or an arithmetic, comparison, or logical operator MUST continue
onto the next line. Blank lines between the two MUST NOT end the statement. `1 +` then `2`
yields `3`.

r[statement.leading-operator] A line starting with a binary operator is rejected
At the top level of a statement, a line that begins with `+`, `*`, `/`, `%`, `==`, `!=`, `<`,
`>`, `<=`, `>=`, `&&`, or `??` MUST be rejected with RILL-P001. A line that begins with `-` MUST
start a new statement.

r[statement.leading-bracket] A line starting with a bracket starts a statement
A line that begins with `[` or `(` MUST start a new statement. It MUST NOT index or call the
value on the line before. `$l` then `[0]` yields `list[0]`.

## Evaluation

r[statement.order] Statements run in order
The statements of a script or a block MUST run one after another, in source order.

r[statement.no-carry] A statement does not receive the previous result
A statement MUST NOT bind `$` to the result of the statement before it. At the top level of a
script, reading `$` MUST halt with RILL-R005.

r[statement.block-dollar] Every statement in a block sees the block's $
Inside a code block, `$` MUST be the same value in every statement: the block's input, or the
enclosing `$`.

r[statement.continuation] A leading arrow continues the chain
A line that begins with `->` or `=>` MUST continue the previous statement's chain with its
value.

r[statement.result] A script or block yields its last statement
A script and a block MUST yield the value of the last statement they run.

r[statement.empty] A script with no statement halts
A script that holds no statement MUST halt with RILL-R043. A script of only blank lines,
comments, or frontmatter holds no statement.

r[statement.return] return at the top level ends the script
`v -> return` in a top-level statement MUST end the script with `v`. Later statements MUST NOT
run.

r[statement.variables] Statements share values through variables
A later statement MUST read an earlier result only through a variable bound by a capture.

## Interactions

A line that begins with `?` or `!` continues a conditional (`conditional`). Inside a declaration,
a newline ends the type (`declaration.newline`). A comment line between two lines of one
statement reads as a blank line (`whitespace.comment`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `$` read at the top level of a script | RILL-R005 | Yes |
| A script with no statement (`statement.empty`) | RILL-R043 | No |
| A line that begins with a binary operator (`statement.leading-operator`) | RILL-P001 | No |

## Examples

```rill
3 -> {
  $ + 1
  $ * 10
}
# Result: 30
```

```rill
1 => $a
2
$a
# Result: 1
```

```rill
5
-> { $ + 1 }
# Result: 6
```

```rill
"x" -> return
"y"
# Result: "x"
```

```rill
# Error: Undefined variable
5
$
```

```rill
# Error: RILL-P001
1
+ 2
```

## Notes

No guard can enclose a whole script, so RILL-R043 from an empty script is never caught. A line
that begins with `||` reads the removed `||` function literal and halts RILL-P012. Which
member, type, and coalescing forms continue across a line ending is unstated: see INCONSISTENCIES.md.
