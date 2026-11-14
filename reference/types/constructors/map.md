---
id: map
title: Maps
status: normative
since: 0.24.0
issues: [599]
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH, RILL-R036]
depends: [type-value, type-form, any, union, list, tuple, dict]
tests: []
---

# Maps

A map is a collection keyed by values of one scalar kind, with one value type.

## Syntax

```text
map(K, V)                  keys of type K, values of type V
map[key: value, ...]       literal; a key is an expression
```

## Static rules

r[map.form] A map type names a key type and a value type {pending #599}
A map type MUST be written `map(K, V)`, with two unnamed arguments.

r[map.value-type] A value type is any type {pending #599}
`V` MUST be any type.

r[map.key-kind] A key type is one scalar kind {pending #599}
`K` MUST be `string`, `number`, `bool`, `atom`, `datetime`, `duration`, or `error_code`.
`map(list, number)` MUST be rejected.

r[map.key-union] A key union has members of one kind {pending #599}
`K` MAY be a union whose members share one kind, as in `union(#a, #b)`.

r[map.key-union-mixed] A key union of two kinds is rejected {pending #599}
`map(union(atom, string), number)` MUST be rejected.

r[map.key-any] map(any, V) leaves the key kind open {pending #599}
`map(any, V)` MUST be legal. Each map value still has exactly one key kind.

r[map.unspecified] A bare map is map(any, any) {pending #599}
`map`, `map()`, and `map(any, any)` MUST compare equal.

r[map.no-outer] A map type takes no outer {pending #599}
`map(atom, number):string` MUST be a parse error.

r[map.key-pipe] A pipe chain used as a key is parenthesized {pending #599}
A key that is a pipe chain MUST be written in parentheses, as in `map[($x -> .upper): 1]`.

r[map.key-bare] A bare identifier key is a parse error {pending #599}
`map[a: 1]` MUST be a parse error, because `a` is a name and a key is a value.

r[map.duplicate-parse] A duplicate literal key is a parse error {pending #599}
Two keys written as equal literals in one `map[...]` MUST be rejected at parse time.

## Evaluation

r[map.key-value] A literal key is a value {pending #599}
A key in `map[...]` MUST be an expression: `map[1: "x"]` has the number key 1, `map[$k: 1]` the value of `$k`.

r[map.key-multi] An entry MAY list several keys {pending #599}
`map[[#a, #b]: 1]` MUST bind both keys to the value 1.

r[map.duplicate-run] A duplicate computed key halts {pending #599}
Two keys equal by value in one literal, not both literals, MUST halt with `#INVALID_INPUT`.

r[map.key-mixed] Keys of two kinds halt {pending #599}
`map[#a: 1, "b": 2]` MUST halt with `#TYPE_MISMATCH`.

r[map.key-scalar] A non-scalar key halts {pending #599}
A key whose value is not a scalar MUST halt with `#TYPE_MISMATCH`.

r[map.no-reserved] A map has no reserved keys {pending #599}
`map[#keys: 1]` and `map["values": 1]` MUST hold the keys they name.

r[map.infer-values] Values infer a union {pending #599}
`map[#a: 1, #b: "x"]` MUST infer `map(atom, union(number, string))`.

r[map.infer-keys] A declared key type narrows the keys {pending #599}
`map(union(#a, #b), number)[#a: 1, #b: 2]` MUST hold the key type `union(#a, #b)`.

r[map.order] Iteration follows insertion order {pending #599}
A map MUST iterate in insertion order.

r[map.order-views] .keys, .values, and .entries follow iteration order {pending #599}
`.keys`, `.values`, and `.entries` MUST list entries in the order iteration yields them.

r[map.equality] Maps are equal when their entries are equal {pending #599}
Two maps MUST be equal when they hold equal keys with equal values, in any order.

r[map.iteration] Iteration yields one dict per entry {pending #599}
Each iteration step MUST yield `dict[key: K, value: V]`.

r[map.keys] .keys is a list of keys {pending #599}
`.keys` MUST return `list(K)`.

r[map.values] .values is a list of values {pending #599}
`.values` MUST return `list(V)`.

r[map.entries] .entries is a list of key and value tuples {pending #599}
`.entries` MUST return `list(tuple(K, V))`.

r[map.len] .len is the entry count {pending #599}
`.len` MUST return the number of entries.

r[map.empty] .empty tests for no entries {pending #599}
`.empty` MUST return true for `map[]` and false otherwise.

r[map.type-equality] Map types are equal when keys and values are equal {pending #599}
`map(K1, V1)` MUST equal `map(K2, V2)` when `K1` equals `K2` and `V1` equals `V2`.

r[map.inner] The inner of a map type is a tuple of its parameters {pending #599}
`map(K, V).inner` MUST return `tuple[K, V]`.

r[map.inner-unspecified] The inner of a bare map type is a tuple of any {pending #599}
`map.inner` MUST return `tuple[any, any]`.

r[map.filter] filter over a map yields a list of entries {pending #599}
`filter` over a map MUST return a list of entries, each `tuple(K, V)`.

## Interactions

Selection by key is stated in `selection`.

r[map.no-spread] A map never spreads {pending #599}
Spreading a map into a dict literal or an argument list MUST halt.

r[map.from-dict] A dict converts to a string-keyed map {pending #599}
`dict -> map(string, V)` MUST convert each value to `V`.

r[map.to-dict] A string-keyed map converts to a dict {pending #599}
`map(string, V) -> dict` MUST yield a dict with the same keys.

r[map.to-dict-key] A map with another key kind does not convert to a dict {pending #599}
`map(atom, V) -> dict` MUST raise RILL-R036. No key converts implicitly.

r[map.from-list] A list does not convert to a map {pending #599}
`list -> map` MUST raise RILL-R036.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| Two equal keys, not both literals {pending #599} | `#INVALID_INPUT` | Yes |
| Keys of two kinds, or a non-scalar key {pending #599} | `#TYPE_MISMATCH` | Yes |
| A map with a non-string key kind, or a list, converts {pending #599} | RILL-R036 | Yes |

## Examples

```rill pending=599
map[#a: 1, #b: "x"].^type.signature
# Result: "map(atom, union(number, string))"
```

```rill pending=599
map[1: "x", 2: "y"].keys
# Result: list[1, 2]
```

```rill pending=599
# Error: #TYPE_MISMATCH
map[#a: 1, "b": 2]
```

## Notes

`map[#a: 1]` halts RILL-P001 on 0.23.0, and `map(atom, number)` halts RILL-R006. `dict[1: "x"]`
has the string key `"1"`: a map key is a value, and a dict key is a name.

A map crosses the host boundary as a JavaScript `Map` with atom keys as their names; that belongs
to the host-boundary chapter.

The error id for the halt of a map that spreads is set when #599 is built.
