---
id: map-literal
title: Map literals
status: normative
since: 0.24.0
issues: [599]
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [map]
tests: []
---

# Map literals

A map literal is `map[key: value, ...]`, where each key is a value written as an expression.

## Syntax

r[map-literal.key-value] A literal key is a value {pending #599}
A key in `map[...]` MUST be an expression. `map[1: "x"]` has the number key 1, `map[#a: 1]` an
atom key, and `map[$k: 1]` the value of the variable `$k`.

r[map-literal.key-pipe] A pipe chain used as a key is parenthesized {pending #599}
A key that is a pipe chain MUST be written in parentheses, as in `map[($x -> .upper): 1]`.

r[map-literal.key-multi] An entry MAY list several keys {pending #599}
`map[[#a, #b]: 1]` MUST bind both keys to the value 1.

r[map-literal.key-bare] A bare identifier key is a parse error {pending #599}
`map[a: 1]` MUST be a parse error, because `a` is a name and a key is a value.

r[map-literal.duplicate-parse] A duplicate literal key is a parse error {pending #599}
Two keys written as equal literals in one `map[...]` MUST be rejected at parse time.

## Evaluation

r[map-literal.duplicate-run] A duplicate computed key halts {pending #599}
Two keys equal by value in one literal, when not both literals, MUST halt with `#INVALID_INPUT`.

r[map-literal.key-mixed] Keys of two kinds halt {pending #599}
`map[#a: 1, "b": 2]` MUST halt with `#TYPE_MISMATCH`.

r[map-literal.key-scalar] A non-scalar key halts {pending #599}
A key whose value is not a scalar MUST halt with `#TYPE_MISMATCH`.

r[map-literal.no-reserved] A map has no reserved keys {pending #599}
`map[#keys: 1]` and `map["values": 1]` MUST hold the keys they name.

r[map-literal.infer-values] Values infer a union {pending #599}
`map[#a: 1, #b: "x"]` MUST infer `map(atom, union(number, string))`.

r[map-literal.infer-keys] A declared key type narrows the keys {pending #599}
`map(union(#a, #b), number)[#a: 1, #b: 2]` MUST hold the key type `union(#a, #b)`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| Two equal keys, not both literals {pending #599} | `#INVALID_INPUT` | Yes |
| Keys of two kinds, or a non-scalar key {pending #599} | `#TYPE_MISMATCH` | Yes |

## Examples

```rill pending=599
map[1: "x", 2: "y"].keys
# Result: list[1, 2]
```

```rill pending=599
# Error: #TYPE_MISMATCH
map[#a: 1, "b": 2]
```

## Notes

`map[1: "x"]` has the number key 1, while `dict[1: "x"]` has the string key `"1"`: a map key is a
value, and a dict key is a name.
