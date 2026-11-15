---
id: sort
title: sort
status: normative
since: 0.24.0
issues: [614]
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [iteration]
tests: [sort.test.ts]
---

# sort

`sort` orders a source's elements ascending, by the elements or by a key a function computes,
keeping equal keys in source order.

## Syntax

```text
source -> sort
source -> sort(key_fn)
```

## Evaluation

r[sort.ascending] sort orders elements ascending
`sort` MUST order elements from the smallest key to the largest. Without `key_fn`, an element
MUST be its own key.

r[sort.key-fn] key_fn computes each element's key
With `key_fn`, each element's key MUST be the result of calling `key_fn` with the element bound
to `$`.

r[sort.stable] Equal keys keep source order
Elements with equal keys MUST keep their source order.

r[sort.comparable] Numbers, strings, and tuples have an order
Keys MUST compare when all are numbers, all are strings, or all are tuples of one length.
Strings MUST compare by UTF-16 code unit. Tuples MUST compare slot by slot from the first.

r[sort.incomparable] Any other pair of keys halts
Comparing two keys of different types, two bools, two atoms, two lists, two dicts, or tuples of
different lengths MUST halt with `#TYPE_MISMATCH`.

r[sort.vacant-key] A vacant key halts
A `key_fn` result that is vacant MUST halt with `#INVALID_INPUT`.

r[sort.key-callable] key_fn is callable
A `key_fn` that is not callable MUST halt with `#TYPE_MISMATCH`.

r[sort.list] A list, string, or iterator sorts to a list
`sort` over a list, a string, or an iterator MUST yield a list. A string MUST sort its
code-point elements (`iteration.string`).

r[sort.dict] A dict sorts to an ordered
`sort` over a dict MUST yield an `ordered` whose fields follow the sorted entries. Without
`key_fn`, an entry's key MUST be its dict key. With `key_fn`, `$` MUST be the entry dict.

r[sort.ordered-source] An ordered sorts to an ordered {pending #614}
`sort` over an ordered MUST sort its entries and yield an `ordered`, as `sort.dict` does for a
dict.

## Interactions

A tuple is a source and yields its elements (`iteration.tuple`). `sort[0]` indexes the
sorted result (`pipe.call-operand`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| Two keys have no order | `#TYPE_MISMATCH` | Yes |
| `key_fn` returns a vacant value | `#INVALID_INPUT` | Yes |
| `key_fn` is not callable | `#TYPE_MISMATCH` | Yes |
| The source is an ordered | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
list[3, 1, 2] -> sort
# Result: list[1, 2, 3]
```

```rill
list["banana", "fig", "apple"] -> sort({ .len })
# Result: list["fig", "apple", "banana"]
```

```rill
dict[c: 3, a: 1, b: 2] -> sort({ $.value })
# Result: ordered[a: 1, b: 2, c: 3]
```

```rill
list[tuple[2, "b"], tuple[1, "z"], tuple[2, "a"]] -> sort
# Result: list[tuple[1, "z"], tuple[2, "a"], tuple[2, "b"]]
```

```rill
# Error: sort: cannot compare bool with bool
list[true, false] -> sort
```

## Notes

Superseded: `sort.ordered`, now `sort.ordered-source`. On 0.23.0 `sort` over an ordered halts
`#TYPE_MISMATCH`.