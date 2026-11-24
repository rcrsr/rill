---
id: stop-when
title: stop_when
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [slicing, iteration, break]
tests: [collection-operators.test.ts, collection-slicing.test.ts, builtin-functions-slicing.test.ts]
---

# stop_when

`stop_when` yields the elements of a source up to and including the first one a predicate
accepts.

## Syntax

```text
stop_when(source, predicate) -> list
```

## Evaluation

r[stop-when.through-match] stop_when yields through the first match
`stop_when(p)` MUST yield a list of the elements from the first through the first element for
which `p` yields `true`, that element included, in source order.

r[stop-when.once] The predicate is not called after the first match
After `p` yields `true`, `stop_when` MUST NOT call `p` again.

r[stop-when.no-match] No match yields every element
When `p` yields `false` for every element, `stop_when` MUST yield every element.

## Interactions

The sources and the result kind are stated in `slicing.sources` and `slicing.to-list`, and a
predicate that yields a non-bool in `slicing.predicate-bool`. The predicate's arity is stated
in `iteration.arity-single`, and `break` in it in `break.other-operators`.

## Examples

```rill
list[list[1, 5, 2] -> stop_when({ $ > 4 }), list[1, 2] -> stop_when({ $ > 4 })]
# Result: list[list[1, 5], list[1, 2]]
```

## Notes

A predicate that is not callable halts RILL-R040, not `#TYPE_MISMATCH` as
`iteration.callable` states for the operators: see INCONSISTENCIES.md.
