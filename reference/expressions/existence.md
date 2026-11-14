---
id: existence
title: Existence check
status: normative
since: 0.24.0
issues: [576, 599, 607]
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [selection]
tests: [existence-check.test.ts, existence-check-dynamic.test.ts]
---

# Existence check

The existence check `.?` yields whether a selection exists, as a bool, without halting on a missing key.

## Syntax

```text
$c.?name      by name               $c.?$k       by a selector in a variable
$c.?[sel]     by a selector expression          $c.?name&T   by name and type
```

## Evaluation

r[existence.found] The existence check finds a key
`.?name` and `.?$k` MUST yield true when the selection exists.

r[existence.bracket] The existence check takes a selector expression {pending #607}
`$c.?[sel]` MUST check as `$c.?$k` does, with `$k` holding the value of `sel`.

r[existence.missing] The existence check never halts for a missing key
`.?name` and `.?$k` MUST yield false, without halting, when the selection is missing or the receiver is a scalar.

r[existence.index] The existence check reads an index
On a list and a tuple, `.?$k` MUST yield true, for `$k` holding a number for `-len` to `len - 1`.

r[existence.integer] The existence check needs an integer index
`.?$k` with a non-integer number in `$k` on a list, a tuple, or an ordered MUST halt with `#INVALID_INPUT`.

r[existence.type] A type qualifier narrows the existence check
`.?name&T` MUST yield true only when the field exists and has type `T`.

r[existence.ordered-type] An existence check needs a string on an ordered {pending #576}
`$o.?$k` with a selector that is not a string MUST halt with `#TYPE_MISMATCH`, as a map
existence check does with a wrong key type.

r[existence.map] A map existence check finds a key {pending #599}
`$m.?[k]` MUST yield true when the map holds `k` and false otherwise, without halting.

r[existence.map-type] A map existence check needs the key type {pending #599}
`$m.?[k]` with a selector that is not the key type MUST halt with `#TYPE_MISMATCH`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| An index is not an integer | `#INVALID_INPUT` | Yes |
| An ordered or map selector has the wrong type {pending #576} | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
dict[a: 1] => $d
"z" => $z
list[$d.?a, $d.?$z, $d.?a&number, $d.?a&string]
# Result: list[true, false, true, false]
```

```rill
list[10, 20] => $l
list[-1, 2] -> seq({ $l.?$ })
# Result: list[true, false]
```

## Notes

The 0.23.0 form `$c.?(expr)` is removed in 0.24.0 (#607). Write `$c.?[expr]`. On 0.23.0
`$o.?(0)` on an ordered yields true by number position.
