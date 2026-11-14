---
id: dispatch
title: Dispatch
status: normative
since: 0.24.0
issues: [568, 599]
grammar: []
errors: [RILL-R002]
depends: [selection, dict, ordered, list, tuple, map, fn]
tests: [dict-dispatch.test.ts, list-dispatch.test.ts, hierarchical-dispatch.test.ts, unified-dispatch.test.ts]
---

# Dispatch

A dispatch pipe `sel -> $c` selects an element of a collection and runs it when it is a held block.

## Evaluation

r[dispatch.select] A pipe into a collection selects
For a valid selector, `sel -> $c` MUST select as `$c[sel]` does, on a dict and a list.

r[dispatch.tuple] A pipe into a tuple selects by index {pending #568}
`sel -> $t` MUST select as `$t[sel]` does, for a tuple `$t`.

r[dispatch.ordered] A pipe into an ordered selects by key {pending #568}
`sel -> $o` MUST select as `$o[sel]` does, for an ordered `$o`.

r[dispatch.path] A list piped into nested collections descends one level per element
`list["a", "b"] -> $d` MUST select `"a"` in `$d`, then `"b"` in that result.

r[dispatch.multi-key] A dict entry MAY list several keys
`dict[["a", "b"]: v]` MUST yield `v` for the selector `"a"` and for `"b"`.

r[dispatch.block] A selected block runs with the key bound
A block held by a dict entry MUST run with `$` bound to the selector.

r[dispatch.block-list] A block in a list variable runs with the index bound
`0 -> $l` MUST run a block held at index 0 of the list `$l`, with `$` bound to 0.

r[dispatch.block-literal] A block in a list literal target runs {pending #568}
`0 -> list[{ 5 }]` MUST run the block and yield 5.

r[dispatch.block-held] A block held by a tuple or an ordered runs {pending #568}
Selecting a held block from a tuple or an ordered MUST run it, with `$` bound to the selector.

r[dispatch.fn] A selected function is returned {pending #568}
A function selected by key or index MUST be returned and MUST NOT be called.

r[dispatch.map-block] A block held by a map runs on selection {pending #599}
A block held by a map entry MUST run with `$` bound to the key.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A non-number piped into a list | RILL-R002 | Yes |

## Examples

```rill
list["a", "b"] -> dict[a: dict[b: { "got {$}" }]]
# Result: "got b"
```

```rill
"b" -> dict[["a", "b"]: 1]
# Result: 1
```

```rill
list[{ "got {$}" }] => $l
0 -> $l
# Result: "got 0"
```

## Notes

`0 -> list[{ 5 }]` yields the block uncalled on 0.23.0, `0 -> tuple[{ 5 }]` fails to parse, and
`fn` values do not parse inside a dict literal. A multi-key entry also parses as `list["a", "b"]: v`.

On 0.23.0 `$l.("a")` on a list halts RILL-R003 where `"a" -> $l` halts RILL-R002. The
parenthesized form is removed in 0.24.0 (#607), and `$l["a"]` halts RILL-R002 as dispatch does.

Selection and dispatch are one topic split in two: dispatch runs held blocks and descends paths,
which element reads never do.
