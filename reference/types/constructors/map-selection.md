---
id: map-selection
title: Map selection
status: normative
since: 0.24.0
issues: [599]
grammar: []
errors: [TYPE_MISMATCH, RILL-R009]
depends: [map]
tests: []
---

# Map selection

A map yields the value at a key through a dispatch pipe, a computed key, or a bracket key.

## Evaluation

r[map-selection.dispatch] A pipe into a map selects by key {pending #599}
`#a -> $m` MUST yield the value at key `#a`.

r[map-selection.computed] A computed key selects {pending #599}
`$m.(#a)` MUST yield the value at key `#a`.

r[map-selection.bracket] A bracket key selects {pending #599}
`$m[#a]` MUST yield the value at key `#a`.

r[map-selection.no-field] A map has no named fields {pending #599}
`$m.a` MUST halt with RILL-R009, the halt a missing dict field raises.

r[map-selection.selector-type] The selector type equals the key type {pending #599}
A selector whose type is not the key type MUST halt with `#TYPE_MISMATCH`. Selection converts
nothing.

r[map-selection.no-mask] A fallback does not mask a wrong selector type {pending #599}
`??` MUST NOT mask the halt of a wrong-typed selector.

r[map-selection.missing-halt] A missing key halts {pending #599}
Selecting a key of the key type that the map lacks MUST halt with RILL-R009, the halt a missing dict field raises.

r[map-selection.missing-key] A missing key falls back {pending #599}
`$m.(#absent) ?? d` MUST yield `d` when the selector has the key type and the map lacks the key.

r[map-selection.exists] The existence check tests for a key {pending #599}
`$m.?(#k)` MUST yield true when the map holds the key and false otherwise, without halting.

r[map-selection.exists-type] The existence check needs the key type {pending #599}
`$m.?(#k)` with a selector that is not the key type MUST halt with `#TYPE_MISMATCH`.

r[map-selection.block] A selected block runs with the key bound {pending #599}
A block selected by key MUST run with `$` bound to the key.

r[map-selection.fn] A selected function is returned {pending #599}
A function selected by key MUST be returned and MUST NOT be called.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The selector type is not the key type {pending #599} | `#TYPE_MISMATCH` | Yes |
| A named field or a missing key is selected {pending #599} | RILL-R009 | Yes |

## Examples

```rill pending=599
map[200: "ok", 404: "missing"][404]
# Result: "missing"
```

```rill pending=599
#circle -> map[#circle: 1, #square: 4]
# Result: 1
```

```rill pending=599
map[#a: 1].(#b) ?? 0
# Result: 0
```

```rill pending=599
# Error: #TYPE_MISMATCH
"a" -> map[#a: 1]
```

## Notes

RILL-R009 is the dict analog's id; the id a map raises is not yet fixed.

`$m[-1]` reads like the list form that counts from the end. On a map it selects the key -1.
