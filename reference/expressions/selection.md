---
id: selection
title: Selection
status: normative
since: 0.24.0
issues: [576, 599]
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH, RILL-R002, RILL-R003, RILL-R005, RILL-R009]
depends: [dict, ordered, list, tuple, map, string, carried-type]
tests: [property-access.test.ts, dynamic-field-access.test.ts, list-dispatch.test.ts, unified-dispatch.test.ts, ordered-access.test.ts, existence-check.test.ts, existence-check-dynamic.test.ts, access-halt.test.ts, default-value-operator.test.ts]
---

# Selection

Selection reads one element of a collection by a key or an index, the selector.

## Syntax

```text
$c.name       field by name         $c.$k        field by variable
$c.(expr)     field by expression   $c[sel]      bracket
sel -> $c     dispatch pipe         $c.?name     existence check
```

## Evaluation

r[selection.forms] Each container accepts a fixed set of forms
A container MUST accept only the forms its row allows, and dispatch is stated in `dispatch`. Any other form MUST halt. A dash marks a form that a pending rule below builds.

| Container | `.name` | `.$k`, `.(expr)`, `[sel]` | Dispatch `sel -> $c` |
|-----------|---------|---------------------------|----------------------|
| dict | yes | string key | yes |
| ordered | yes | string key | - |
| list | no | number index | yes |
| tuple | no | number index | - |
| map | no | - | - |
| string | no | no; `.at(n)` reads a code point | no |

r[selection.no-name] A list, tuple, or scalar has no named fields
`.name` on a list, a tuple, or a scalar MUST halt with RILL-R003.

r[selection.variable] A variable form selects by the variable's value
`$c.$k` MUST select by the value of `$k`. An undefined `$k` MUST halt with RILL-R005.

r[selection.computed] A computed form selects by an expression's value
`$c.(expr)` MUST evaluate `expr`, then select by its value. `[sel]` MUST select as `.(sel)` does.

r[selection.string] A string has no index form
`$s[0]`, `$s.(0)`, and `0 -> $s` MUST halt with RILL-R002, for a string `$s`.

r[selection.index-type] A list or tuple selector is a number
A non-number selector at `[]` on a list or a tuple, or in dispatch on a list, MUST halt with RILL-R002.

r[selection.no-mask] A fallback does not mask a wrong index type
`??` MUST NOT mask the halt of a non-number selector at `[]` on a list or a tuple, or in dispatch on a list.

r[selection.index-integer] An index is an integer
A non-integer index at `[]`, `.(n)`, `.at`, or dispatch on a list, a tuple, an ordered, or a string `.at` MUST halt with `#INVALID_INPUT`.

r[selection.negative] A negative index counts from the end
On a list and a tuple, `[]`, `.(n)`, `.$k`, and `.at` MUST read `-1` as the last element, as do list dispatch and a string `.at`.

r[selection.range] An index out of range halts
An index outside `-len` to `len - 1` MUST halt with RILL-R009.

r[selection.at] .at applies to a list, a tuple, and a string
`.at` on a dict or an ordered MUST halt with RILL-R003.

r[selection.missing] A missing key halts
A key a dict or an ordered lacks MUST halt with RILL-R009.

r[selection.default] A fallback replaces a missing selection
`$d.b ?? d`, `$d.(k) ?? d`, `k -> $d ?? d`, and `$l.at(n) ?? d` MUST yield `d` when the selection is missing.

r[selection.ordered-type] An ordered selector is a string {pending #576}
An ordered selector that is not a string, a number position included, MUST halt with
`#TYPE_MISMATCH`, as a dict selector does.

r[selection.ordered-exists] An existence check needs a string on an ordered {pending #576}
`$o.?(k)` with a selector that is not a string MUST halt with `#TYPE_MISMATCH`, as a map
existence check does with a wrong key type.

r[selection.key-type] A dict selector is a string {pending #576}
A dict selector that is not a string MUST halt with `#TYPE_MISMATCH`. Selection converts nothing.

r[selection.key-no-mask] A fallback does not mask a wrong dict selector {pending #576}
`??` MUST NOT mask the halt of a non-string dict selector.

r[selection.exists] The existence check finds a key
`.?name`, `.?$k`, and `.?(k)` MUST yield true when the selection exists.

r[selection.exists-missing] The existence check never halts for a missing key
The same forms MUST yield false, without halting, when the selection is missing or the receiver is a scalar.

r[selection.exists-index] The existence check reads an index
On a list and a tuple, `.?(n)` MUST yield true for `-len` to `len - 1`.

r[selection.exists-integer] The existence check needs an integer index
`.?(n)` with a non-integer `n` on a list, a tuple, or an ordered MUST halt with `#INVALID_INPUT`.

r[selection.exists-type] A type qualifier narrows the existence check
`.?name&T` MUST yield true only when the field exists and has type `T`.

r[selection.map-forms] A map selects by its key type {pending #599}
`.$k`, `.(expr)`, `[sel]`, and dispatch on a map MUST select the value at the key `sel`.

r[selection.map-name] A map has no named fields {pending #599}
`$m.a` MUST halt.

r[selection.map-type] A map selector has the key type {pending #599}
A map selector that is not the key type MUST halt with `#TYPE_MISMATCH`.

r[selection.map-no-mask] A fallback does not mask a wrong map selector {pending #599}
`??` MUST NOT mask the halt of a map selector that is not the key type.

r[selection.map-negative] A map index is the key {pending #599}
On `map(number, V)`, `$m[-1]` MUST select the key -1.

r[selection.map-missing] A missing map key halts {pending #599}
A selector of the key type that the map lacks MUST halt with RILL-R009.

r[selection.map-default] A fallback replaces a missing map key {pending #599}
`$m.(#absent) ?? d` MUST yield `d` when the map lacks the key.

r[selection.map-exists] A map existence check finds a key {pending #599}
`$m.?(k)` MUST yield true when the map holds `k` and false otherwise, without halting.

r[selection.map-exists-type] A map existence check needs the key type {pending #599}
`$m.?(k)` with a selector that is not the key type MUST halt with `#TYPE_MISMATCH`.

## Interactions

Element typing follows `carried-type.element`. A pipe into a collection is stated in `dispatch`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| Missing key, or index out of range | RILL-R009 | Yes |
| A list or tuple selector is not a number, or a string is indexed | RILL-R002 | Yes |
| `.name` or `.at` on a receiver that has none | RILL-R003 | Yes |
| A variable selector is undefined | RILL-R005 | Yes |
| An index or an existence-check index is not an integer | `#INVALID_INPUT` | Yes |
| A dict, ordered, or map selector has the wrong type {pending #576} | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
dict[a: 1, b: 2] => $d
"b" => $k
list[$d.a, $d.$k, $d.("a"), $d["b"]] => $hits
list[$d.?a, $d.?("z")] => $found
dict[hits: $hits, found: $found]
# Result: dict[found: list[true, false], hits: list[1, 2, 1, 2]]
```

```rill
dict[a: 1] => $d
list[($d["b"]) ?? 0, $d.b ?? 0, "b" -> $d ?? 0]
# Result: list[0, 0, 0]
```

```rill
# Error: index out of bounds
list["x", "y"][5]
```

```rill pending=599
map[200: "ok", 404: "missing"][404]
# Result: "missing"
```

## Notes

On 0.23.0 a `??` after a bracket read does not recover a missing key or index (`$d["b"] ?? 5`
halts RILL-R009); parenthesize the read. Tracked in #601.

On 0.23.0 an ordered also selects by number position: `$o[0]`, `$o[-1]`, `$o.(1)`, and `$o.?(0)`
yields true. A bool selector on an ordered halts RILL-R002.

On 0.23.0 a dict selector that is a number matches a number key, so `1 -> dict[1: "n"]` yields
`"n"`, and a wrong dict selector in dispatch halts RILL-R009 and `??` masks it. `$l.("a") ?? 0`
on a list yields `0`, and `$s.(0) ?? 1` on a string yields `1`, because those halts are catchable
by the fallback. `0 -> list[{ 5 }]` yields the block uncalled, `$t[0]` on a tuple yields a held
block uncalled, and `fn` values do not parse inside a dict literal.

The error id for the map name halt is set when #599 is built.
