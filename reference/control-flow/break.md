---
id: break
title: Break and return
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R002]
depends: [loop]
tests: [loops.test.ts]
---

# Break and return

`break` ends the innermost loop or `seq`/`acc` early, and `return` ends the innermost body
early; neither is a halt.

## Syntax

```text
break           end the loop, with the current $
v -> break      end the loop, with v
v -> return     end the body, with v
```

## Evaluation

r[break.loop] break ends a while or do loop with its value
`v -> break` inside a `while` or `do` body MUST end the loop, and the loop MUST yield `v`. A bare
`break` MUST yield the current `$`.

r[break.seq] break ends seq and acc with the results so far
`break` inside a `seq` or `acc` function MUST end the iteration, and the operator MUST yield the
results collected before the breaking element. The value piped into `break` MUST be discarded.

r[break.nested] break passes through code blocks
A `break` inside a code block nested in a loop body MUST end that loop.

r[break.unsupported] break is rejected where nothing can catch it
`break` inside `fan`, `filter`, or `fold`, or outside any loop, MUST halt with RILL-R002.

r[break.return-body] return ends the innermost body
`v -> return` MUST end the innermost code block, function body, or collection operator call
with `v`. At the top level it ends the script (`statement.return`).

r[break.return-each] return in an operator function ends one call
`return` inside a function passed to `seq`, `fan`, or another collection operator MUST end that
call only, and the operator MUST continue with the next element.

r[break.not-halt] break and return are not halts
Recovery MUST NOT catch `break` or `return`. Both pass through `guard`, `retry`, and `pass` to
the construct they end.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `break` in `fan`, `filter`, `fold`, or outside a loop | RILL-R002 | No |

## Examples

```rill
0 -> while (true) do {
  ($ + 1) -> ($ > 3) ? break ! $
}
# Result: 4
```

```rill
list["a", "b", "c"] -> seq({
  ($ == "c") ? break
  $
})
# Result: list["a", "b"]
```

```rill
list[1, 2] -> seq({ $ -> return })
# Result: list[1, 2]
```

```rill
# Error: break not supported in fan
list[1, 2] -> fan({ break })
```
