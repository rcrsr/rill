---
id: ordered.keys
title: ordered.keys
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, ordered, iteration, code-block]
tests: [ordered-access.test.ts, builtin-collection-methods.test.ts]
---

# ordered.keys

`.keys` yields the keys of an ordered as a list of strings.

## Syntax

```text
ordered.keys() -> list(string)
```

## Evaluation

r[ordered.keys.order] .keys lists the keys in the ordered's own order
`.keys` MUST yield a list holding each of the receiver's keys as a string, in the receiver's own
order (`iteration.ordered`). `ordered[].keys` MUST yield `list[]`.

## Interactions

An ordered that holds a code block names the entry without running it (`code-block.shape-reads`).

## Examples

```rill
ordered[b: 1, a: 2] -> .keys
# Result: list["b", "a"]
```
