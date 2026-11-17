---
id: existence
title: Existence check
status: normative
since: 0.24.0
issues: [599]
grammar: []
errors: [RILL-R009, INVALID_INPUT, TYPE_MISMATCH]
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

r[existence.bracket] The existence check takes a selector expression
`$c.?[sel]` MUST check as `$c.?$k` does, with `$k` holding the value of `sel`.

r[existence.missing] The existence check never halts for a missing key
`.?name` and `.?$k` MUST yield false, without halting, when the selection is missing or the receiver is a scalar.

r[existence.key-type] The existence check halts on a non-string dict selector
`.?$k` and `.?[sel]` on a dict MUST halt with `#TYPE_MISMATCH` when the selector is not a string,
as `selection.key-type` states. A wrong selector type is not a missing key, so the check does not
yield false.

r[existence.chain] The existence check tests only its own step
A step before `.?` that selects a missing key or index MUST halt with RILL-R009, by every
selection form. `$d.x.?y` with `x` missing MUST halt, as `$d["x"].?y` does.

r[existence.index] The existence check reads an index
On a list and a tuple, `.?$k` MUST yield true, for `$k` holding a number for `-len` to `len - 1`.

r[existence.integer] The existence check needs an integer index
`.?$k` with a non-integer number in `$k` on a list, a tuple, or an ordered MUST halt with `#INVALID_INPUT`.

r[existence.type] A type qualifier narrows the existence check
`.?name&T` MUST yield true only when the field exists and has type `T`.

r[existence.map] A map existence check finds a key {pending #599}
`$m.?[k]` MUST yield true when the map holds `k` and false otherwise, without halting.

r[existence.map-type] A map existence check needs the key type {pending #599}
`$m.?[k]` with a selector that is not the key type MUST halt with `#TYPE_MISMATCH`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A step before `.?` is missing | RILL-R009 | Yes |
| An index is not an integer | `#INVALID_INPUT` | Yes |
| A dict selector is not a string | `#TYPE_MISMATCH` | Yes |
| A map selector has the wrong key type {pending #599} | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
dict[a: 1] => $d
"z" => $z
list[$d.?a, $d.?$z, $d.?["a"], $d.?a&number, $d.?a&string]
# Result: list[true, false, true, true, false]
```

```rill
list[10, 20] => $l
list[-1, 2] -> seq({ $l.?$ })
# Result: list[true, false]
```

```rill
# Error: Dict has no field 'x'
dict[a: 1] => $d
$d.x.?y
```

## Notes

The 0.23.0 form `$c.?(expr)` is removed in 0.24.0 (#607). Write `$c.?[expr]`. On 0.23.0
`$o.?(0)` on an ordered yields true by number position.
