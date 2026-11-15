---
id: selection
title: Selection
status: normative
since: 0.24.0
issues: [576, 599, 607]
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH, RILL-R002, RILL-R003, RILL-R005, RILL-R009]
depends: [dict, ordered, list, tuple, map, string, carried-type]
tests: [property-access.test.ts, dynamic-field-access.test.ts, list-dispatch.test.ts, unified-dispatch.test.ts, ordered-access.test.ts, access-halt.test.ts, default-value-operator.test.ts]
---

# Selection

Selection reads one element of a collection by a key or an index, the selector.

## Syntax

```text
$c.name       field by name         $c.$k        selector in a variable
$c[sel]       selector expression   sel -> $c    dispatch pipe
```

## Evaluation

r[selection.forms] Each container accepts a fixed set of forms
A container MUST accept only the forms its row allows, and dispatch is stated in `dispatch`. Any other form MUST halt. A dash marks a form that a pending rule below builds.

| Container | `.name` | `.$k`, `[sel]` | Dispatch `sel -> $c` |
|-----------|---------|----------------|----------------------|
| dict | yes | string key | yes |
| ordered | yes | string key | - |
| list | no | number index | yes |
| tuple | no | number index | - |
| map | no | - | - |
| string | no | no; `.at(n)` reads a code point | no |

r[selection.no-name] A list, tuple, or scalar has no named fields
`.name` on a list, a tuple, or a scalar MUST halt with RILL-R003.

r[selection.computed] A bracket selects by an expression's value
`$c[sel]` MUST evaluate `sel`, then select by its value.

r[selection.variable] The variable form is the bracket form with a variable
`$c.$k` MUST select as `$c[$k]` does. An undefined `$k` MUST halt with RILL-R005.

r[selection.no-paren] The parenthesized selector is removed {pending #607}
`$c.(expr)`, `$c.?(expr)`, the alternatives form `$c.(a || b)`, and the block form `$c.{ ... }`
MUST be rejected at parse time, with a message naming `$c[expr]` and `$c.?[expr]`.

r[selection.string] A string has no index form
`$s[0]`, `$s.$k`, and `0 -> $s` MUST halt with RILL-R002, for a string `$s`.

r[selection.index-type] A list or tuple selector is a number
A non-number selector at `[]` on a list or a tuple, or in dispatch on a list, MUST halt with RILL-R002.

r[selection.no-mask] A fallback does not mask a wrong index type
`??` MUST NOT mask the halt of a non-number selector at `[]` on a list or a tuple, or in dispatch on a list.

r[selection.index-integer] An index is an integer
A non-integer index at `[]`, `.$k`, `.at`, or dispatch on a list, a tuple, an ordered, or a string `.at` MUST halt with `#INVALID_INPUT`.

r[selection.negative] A negative index counts from the end
On a list and a tuple, `[]`, `.$k`, and `.at` MUST read `-1` as the last element, as do list dispatch and a string `.at`.

r[selection.range] An index out of range halts
An index outside `-len` to `len - 1` MUST halt with RILL-R009.

r[selection.at] .at applies to a list, a tuple, and a string
`.at` on a dict or an ordered MUST halt with RILL-R003.

r[selection.missing] A missing key halts
A key a dict or an ordered lacks MUST halt with RILL-R009.

r[selection.default] A fallback replaces a missing selection
`$d.b ?? d`, `$d.$k ?? d`, `k -> $d ?? d`, and `$l.at(n) ?? d` MUST yield `d` when the selection is missing.

r[selection.bracket-default] A fallback replaces a missing bracket selection
`$c[sel] ?? d` MUST yield `d` when the key or index is missing.

r[selection.key-type] A dict selector is a string {pending #576}
A dict selector that is not a string MUST halt with `#TYPE_MISMATCH`. Selection converts nothing.

r[selection.key-no-mask] A fallback does not mask a wrong dict selector {pending #576}
`??` MUST NOT mask the halt of a non-string dict selector.

r[selection.map-forms] A map selects by its key type {pending #599}
`.$k`, `[sel]`, and dispatch on a map MUST select the value at the key `sel`.

r[selection.map-name] A map has no named fields {pending #599}
`$m.a` MUST halt with RILL-R003, as `.name` does on any receiver that has no named fields.

r[selection.map-type] A map selector has the key type {pending #599}
A map selector that is not the key type MUST halt with `#TYPE_MISMATCH`.

r[selection.map-no-mask] A fallback does not mask a wrong map selector {pending #599}
`??` MUST NOT mask the halt of a map selector that is not the key type.

r[selection.map-negative] A map index is the key {pending #599}
On `map(number, V)`, `$m[-1]` MUST select the key -1.

r[selection.map-missing] A missing map key halts {pending #599}
A selector of the key type that the map lacks MUST halt with RILL-R009.

r[selection.map-default] A fallback replaces a missing map key {pending #599}
`$m[#absent] ?? d` MUST yield `d` when the map lacks the key.

## Interactions

Element typing follows `carried-type.element`. The existence check `.?` is stated in `existence`. A pipe into a collection is stated in `dispatch`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| Missing key, or index out of range | RILL-R009 | Yes |
| A list or tuple selector is not a number, or a string is indexed | RILL-R002 | Yes |
| `.name` or `.at` on a receiver that has none | RILL-R003 | Yes |
| A variable selector is undefined | RILL-R005 | Yes |
| An index is not an integer | `#INVALID_INPUT` | Yes |
| A dict selector is not a string {pending #576} | `#TYPE_MISMATCH` | Yes |
| A map selector has the wrong key type {pending #599} | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
dict[a: 1, b: 2] => $d
"b" => $k
list[$d.a, $d.$k, $d["a"], "b" -> $d] => $hits
$hits
# Result: list[1, 2, 1, 2]
```

```rill
dict[a: 1] => $d
list[$d["b"] ?? 0, $d.b ?? 0, list[1][5] ?? 0]
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

The 0.23.0 forms `$c.(expr)` and `$c.?(expr)` are removed in 0.24.0 (#607). Write `$c[expr]`
and `$c.?[expr]`.

On 0.23.0 an ordered also selects by number position: `$o[0]`, `$o[-1]`, `$o.(1)`, and `$o.?(0)`
yields true. A bool selector on an ordered halts RILL-R002.

On 0.23.0 a dict selector that is a number matches a number key, so `1 -> dict[1: "n"]` yields
`"n"`, and a wrong dict selector in dispatch halts RILL-R009 and `??` masks it. `$l.("a") ?? 0`
on a list yields `0`, and `$s.(0) ?? 1` on a string yields `1`, because those halts are catchable
by the fallback. `0 -> list[{ 5 }]` yields the block uncalled, `$t[0]` on a tuple yields a held
block uncalled, and `fn` values do not parse inside a dict literal.
