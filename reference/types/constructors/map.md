---
id: map
title: Maps
status: normative
since: 0.24.0
issues: []
grammar: [map, map-entry, map-key]
errors: [INVALID_INPUT, RILL-P027, RILL-R002, RILL-R036, TYPE_MISMATCH]
depends: [type-value, type-form, any, union, list, tuple, dict]
tests: [map-type.test.ts, map-literal.test.ts, map-selection.test.ts, map-conversion.test.ts, map-iteration.test.ts, map-defaults.test.ts, type-constructors.test.ts]
---

# Maps

A map is a collection keyed by values of one scalar kind, with one value type.

## Syntax

```ebnf
map           = "map" , "[" , [ map-entry , { "," , map-entry } ] , "]" ;
map-entry     = map-key , ":" , expression ;
map-key       = string | number | "-" , number | bool | atom-literal
              | "$" , identifier
              | "(" , expression , ")"
              | "[" , map-key , { "," , map-key } , "]"
              | "list" , "[" , map-key , { "," , map-key } , "]" ;
```

```text
map(K, V)                  keys of type K, values of type V
map[key: value, ...]       literal; a key is an expression
```

## Static rules

r[map.form] A map type names a key type and a value type
A map type MUST be written `map(K, V)`, with two unnamed arguments.

r[map.value-type] A value type is any type
`V` MUST be any type.

r[map.key-kind] A key type is one scalar kind
`K` MUST be `string`, `number`, `bool`, `atom`, `datetime`, `duration`, or `error_code`.
`map(list, number)` MUST halt with `#INVALID_INPUT`.

r[map.key-union] A key union has members of one kind
`K` MAY be a union whose members share one kind, as in `union(#a, #b)`.

r[map.key-union-mixed] A key union of two kinds is rejected
`map(union(atom, string), number)` MUST halt with `#INVALID_INPUT`.

r[map.key-any] map(any, V) leaves the key kind open
`map(any, V)` MUST be legal. Each map value still has exactly one key kind.

r[map.unspecified] A bare map is map(any, any)
`map`, `map()`, and `map(any, any)` MUST compare equal.

r[map.no-outer] A map type takes no outer
`map(atom, number):string` MUST be a parse error.

r[map.key-pipe] A pipe chain used as a key is parenthesized
A key that is a pipe chain MUST be written in parentheses, as in `map[($x -> .upper): 1]`.

r[map.key-bare] A bare identifier key is a parse error
`map[a: 1]` MUST be a parse error, because `a` is a name and a key is a value.

r[map.duplicate-parse] A duplicate literal key is a parse error
Two keys written as literals that are equal by value in one `map[...]` MUST be rejected at parse
time with RILL-P027: `1` and `1.0` collide, `0` and `-0` collide, and `1` and `"1"` do not. An
interpolated string is not a literal, and a literal element of a multi-key list counts.

## Evaluation

r[map.key-value] A literal key is a value
A key in `map[...]` MUST be an expression: `map[1: "x"]` has the number key 1, `map[$k: 1]` the value of `$k`.

r[map.key-multi] An entry MAY list several keys
`map[[#a, #b]: 1]` MUST bind both keys to the value 1. Only a list literal in key position is a
multi-key. A variable holding a list is a non-scalar key (`map.key-scalar`).

r[map.key-multi-empty] An empty multi-key list halts
`map[[]: 1]` MUST halt with RILL-R002.

r[map.duplicate-run] A duplicate computed key halts
Two keys equal by value in one literal, not both literals, MUST halt with `#INVALID_INPUT`.

r[map.key-mixed] Keys of two kinds halt
`map[#a: 1, "b": 2]` MUST halt with `#TYPE_MISMATCH`.

r[map.key-scalar] A non-scalar key halts
A key whose value is not a scalar MUST halt with `#TYPE_MISMATCH`.

r[map.no-reserved] A map has no reserved keys
`map[#keys: 1]` and `map["values": 1]` MUST hold the keys they name.

r[map.infer-values] Values infer a union
`map[#a: 1, #b: "x"]` MUST infer `map(atom, union(number, string))`.

r[map.infer-keys] A declared key type narrows the keys
`map(union(#a, #b), number)[#a: 1, #b: 2]` MUST hold the key type `union(#a, #b)`.

r[map.order] Iteration follows insertion order
A map MUST iterate in insertion order.

r[map.order-views] .keys, .values, and .entries follow iteration order
`.keys`, `.values`, and `.entries` MUST list entries in the order iteration yields them.

r[map.equality] Maps are equal when their entries are equal
Two maps MUST be equal when they hold equal keys with equal values, in any order.

r[map.iteration] Iteration yields one dict per entry
Each iteration step MUST yield `dict[key: K, value: V]`.

r[map.keys] .keys is a list of keys
`.keys` MUST return `list(K)`.

r[map.values] .values is a list of values
`.values` MUST return `list(V)`.

r[map.entries] .entries is a list of key and value tuples
`.entries` MUST return `list(tuple(K, V))`.

r[map.len] .len is the entry count
`.len` MUST return the number of entries.

r[map.empty] .empty tests for no entries
`.empty` MUST return true for `map[]` and false otherwise.

r[map.type-equality] Map types are equal when keys and values are equal
`map(K1, V1)` MUST equal `map(K2, V2)` when `K1` equals `K2` and `V1` equals `V2`.

r[map.inner] The inner of a map type is a tuple of its parameters
`map(K, V).inner` MUST return `tuple[K, V]`.

r[map.inner-unspecified] The inner of a bare map type is a tuple of any
`map.inner` MUST return `tuple[any, any]`.

## Interactions

Selection by key is stated in `selection`. `filter` over a map is stated in `filter.map`.

r[map.no-spread] A map never spreads
Spreading a map MUST halt as a spread of the wrong kind does: RILL-R002 in a literal
(`spread.dict`) and RILL-R001 in an argument list (`spread.arg-other`).

r[map.from-dict] A dict converts to a string-keyed map
`dict -> map(string, V)` MUST convert each value to `V`.

r[map.to-dict] A string-keyed map converts to a dict
`map(string, V) -> dict` MUST yield a dict with the same keys.

r[map.to-dict-key] A map with another key kind does not convert to a dict
`map(atom, V) -> dict` MUST raise RILL-R036. No key converts implicitly.

r[map.from-list] A list does not convert to a map
`list -> map` MUST raise RILL-R036.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| Two equal literal keys | RILL-P027 | No |
| Two equal keys, not both literals | `#INVALID_INPUT` | Yes |
| A type argument is not legal: wrong arity, a named argument, a default, or a non-scalar or mixed-kind key type | `#INVALID_INPUT` | Yes |
| Keys of two kinds, or a non-scalar key | `#TYPE_MISMATCH` | Yes |
| An empty multi-key list | RILL-R002 | Yes |
| A map with a non-string key kind, or a list, converts | RILL-R036 | Yes |

## Examples

```rill
map[#a: 1, #b: "x"].^type.signature
# Result: "map(atom, union(number, string))"
```

```rill
map[1: "x", 2: "y"].keys
# Result: list[1, 2]
```

```rill
# Error: #TYPE_MISMATCH
map[#a: 1, "b": 2]
```

## Notes

`map[#a: 1]` halts RILL-P001 on 0.23.0, and `map(atom, number)` halts RILL-R006. `dict[1: "x"]`
has the string key `"1"`: a map key is a value, and a dict key is a name.

A map crosses the host boundary as a JavaScript `Map` with atom keys as their names; that belongs
to the host-boundary chapter.
