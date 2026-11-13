---
id: map
title: Maps
status: normative
since: 0.24.0
issues: [599]
grammar: []
errors: [TYPE_MISMATCH, RILL-R036]
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

r[map.form] A map type names a key type and a value type {pending #599}
A map type MUST be written `map(K, V)`, with two unnamed arguments.

r[map.key-kind] A key type is one scalar kind {pending #599}
`K` MUST be `string`, `number`, `bool`, `atom`, `datetime`, `duration`, or `error_code`.
`map(list, number)` MUST be rejected.

r[map.key-union] A key union has members of one kind {pending #599}
`K` MAY be a union whose members all share one kind, as in `union(#a, #b)` or
`union(200, 404)`.

r[map.key-union-mixed] A key union of two kinds is rejected {pending #599}
`map(union(atom, string), number)` MUST be rejected.

r[map.key-any] map(any, V) leaves the key kind open {pending #599}
`map(any, V)` MUST be legal. Each map value still has exactly one key kind.

r[map.value-type] A value type is any type {pending #599}
`V` MUST be any type.

r[map.unspecified] A bare map is map(any, any) {pending #599}
`map`, `map()`, and `map(any, any)` MUST compare equal: both parameters default to `any`.

r[map.no-outer] A map type takes no outer {pending #599}
A map type written with an outer, such as `map(atom, number):string`, MUST be a parse error.

## Evaluation

r[map.order] Iteration follows insertion order {pending #599}
A map MUST iterate its entries in insertion order.

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
`map(K, V).inner` MUST return `tuple[K, V]`, following the positional shape of its parameters.

r[map.inner-unspecified] The inner of a bare map type is a tuple of any {pending #599}
`.inner` on `map` MUST return `tuple[any, any]`. The type of `.inner` on any map type is
`tuple(type, type)`.

## Interactions

r[map.no-spread] A map never spreads {pending #599}
Spreading a map into a dict literal or an argument list MUST halt with `#TYPE_MISMATCH`.

r[map.from-dict] A dict converts to a string-keyed map {pending #599}
`dict -> map(string, V)` MUST convert each value to `V`.

r[map.to-dict] A string-keyed map converts to a dict {pending #599}
`map(string, V) -> dict` MUST yield a dict with the same keys.

r[map.to-dict-key] A map with another key kind does not convert to a dict {pending #599}
`map(atom, V) -> dict` MUST raise RILL-R036. No key converts implicitly.

r[map.from-list] A list does not convert to a map {pending #599}
`list -> map` MUST raise RILL-R036.

Literals are stated in `map-literal`, and selection by key in `map-selection`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A map spreads into a dict literal or an argument list {pending #599} | `#TYPE_MISMATCH` | Yes |
| A map with a non-string key kind converts to a dict {pending #599} | RILL-R036 | Yes |
| A list converts to a map {pending #599} | RILL-R036 | Yes |

## Examples

```rill pending=599
map[#a: 1, #b: "x"].^type.signature
# Result: "map(atom, union(number, string))"
```

```rill pending=599
map[#a: 1, #b: 2] -> .keys
# Result: list[#a, #b]
```

```rill pending=599
map[#a: 1, #b: 2].len
# Result: 2
```

## Notes

`map[#a: 1]` halts RILL-P001 ("Expected type name") on 0.23.0, and `map(atom, number)` halts
RILL-R006.

How a map crosses the host boundary, a JavaScript `Map` with atom keys as their names, belongs to
the host-boundary chapter.
