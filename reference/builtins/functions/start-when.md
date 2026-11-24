---
id: start-when
title: start_when
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [slicing, iteration, break]
tests: [collection-operators.test.ts, collection-slicing.test.ts, builtin-functions-slicing.test.ts]
---

# start_when

`start_when` yields the elements of a source from the first one a predicate accepts.

## Syntax

```text
start_when(source, predicate) -> list
```

## Evaluation

r[start-when.from-match] start_when yields from the first match to the end
`start_when(p)` MUST yield a list of the elements from the first element for which `p` yields
`true` through the last element, in source order.

r[start-when.once] The predicate is not called after the first match
After `p` yields `true`, `start_when` MUST NOT call `p` again.

r[start-when.no-match] No match yields an empty list
When `p` yields `false` for every element, `start_when` MUST yield `list[]`.

## Interactions

The sources and the result kind are stated in `slicing.sources` and `slicing.to-list`, and a
predicate that yields a non-bool in `slicing.predicate-bool`. The predicate's arity is stated
in `iteration.arity-single`, and `break` in it in `break.other-operators`.

## Examples

```rill
list[list[1, 5, 2] -> start_when({ $ > 4 }), list[1, 2] -> start_when({ $ > 4 })]
# Result: list[list[5, 2], list[]]
```

## Notes

A predicate that is not callable halts RILL-R040, not `#TYPE_MISMATCH` as
`iteration.callable` states for the operators: see INCONSISTENCIES.md.
