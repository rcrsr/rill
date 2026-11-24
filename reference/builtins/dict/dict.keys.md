---
id: dict.keys
title: dict.keys
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, dict, iteration, code-block]
tests: [dict-key-form.test.ts, builtin-collection-methods.test.ts]
---

# dict.keys

`.keys` yields the keys of a dict as a list of strings.

## Syntax

```text
dict.keys() -> list(string)
```

## Evaluation

r[dict.keys.order] .keys lists the keys in key order
`.keys` MUST yield a list holding each of the receiver's keys as a string, in the key order
`iteration.dict` states. `dict[].keys` MUST yield `list[]`.

## Interactions

A dict that holds a code block names the entry without running it (`code-block.shape-reads`).

## Examples

```rill
dict[b: 1, B: 2, a: 3] -> .keys
# Result: list["B", "a", "b"]
```
