---
id: existence
title: Existence check
status: normative
since: 0.24.0
issues: []
grammar: [existence-check]
errors: [RILL-R009, INVALID_INPUT, TYPE_MISMATCH]
depends: [selection]
tests: [existence-check.test.ts, existence-check-dynamic.test.ts, map-selection.test.ts, map-membership.test.ts, parameterized-existence.test.ts]
---

# Existence check

The existence check `.?` yields whether a selection exists, as a bool, without halting on a missing key.

## Syntax

```ebnf
existence-check = ".?" , ( identifier
                         | "$" , identifier
                         | "[" , pipe-chain , "]" )
                , [ "&" , type-name ] ;
```

```text
$c.?name      by name               $c.?$k       by a selector in a variable
$c.?[sel]     by a selector expression          $c.?name&T   by name and type
```

## Evaluation

r[existence.found] The existence check finds a key
`.?name` and `.?$k` MUST yield true when the selection exists.

r[existence.bracket] The existence check takes a selector expression
`$c.?[sel]` MUST validate `sel` as the read `$c[sel]` does, and MUST yield false only for a genuine miss: an absent key or an out-of-range index. A selector the read rejects MUST halt with the read's error, so `list[1, 2].?["a"]`, `tuple[1].?[true]`, `ordered[a: 1].?[list[1]]`, and `"s".?["len"]` halt. A type value is not an exception.

r[existence.variable] The variable existence check agrees with its read
`$c.?$k` MUST validate `$k` as `$c.$k` and `$c[$k]` do, as `selection.key-validation` states, and MUST yield false only for a genuine miss. A string `$k` is a key, so `$list.?$k` with `$k` holding `"a"` halts.

r[existence.missing] The existence check never halts for a missing key
`.?name`, `.?$k`, and `.?[sel]` MUST yield false, without halting, when the selection is missing and the key is valid for the receiver. A spelled name on a scalar receiver is a miss and yields false. A key the receiver rejects is not a miss; see `existence.bracket` and `existence.variable`.

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

r[existence.map] A map existence check finds a key
`$m.?[k]` MUST yield true when the map holds `k` and false otherwise, without halting. `$m.?name` (a spelled name) MUST yield false, because a map holds no named fields.

r[existence.map-type] A map existence check needs the key type
`$m.?[k]` with a selector that is not the key type MUST halt with `#TYPE_MISMATCH`. An empty
undeclared `map[]` has no key type, so `.?[k]` with a scalar `k` MUST yield false. A declared
empty map MUST check `k` against its declared key type.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A step before `.?` is missing | RILL-R009 | Yes |
| An index is not an integer | `#INVALID_INPUT` | Yes |
| A dict selector is not a string | `#TYPE_MISMATCH` | Yes |
| A `.?[sel]` selector the read `[sel]` rejects | The read's error | Yes |
| A map selector has the wrong key type | `#TYPE_MISMATCH` | Yes |

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
