---
id: statement
title: Statements
status: normative
since: 0.24.0
issues: []
grammar: [script, statement]
errors: [RILL-R005]
depends: []
tests: [block-scoping.test.ts]
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

r[statement.return] return at the top level ends the script
`v -> return` in a top-level statement MUST end the script with `v`. Later statements MUST NOT
run.

r[statement.variables] Statements share values through variables
A later statement MUST read an earlier result only through a variable bound by a capture.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `$` read at the top level of a script | RILL-R005 | Yes |

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
