# rill Maps

*Collections keyed by values of one scalar kind*

---

## Map Type

A map holds entries keyed by values of one scalar kind, with one value type. Write it with `map[key: value, ...]`; a key is an expression, not a name.

```rill
map[#a: 1, #b: "x"].^type.signature
# Result: "map(atom, union(number, string))"
```

The type is `map(K, V)`. `K` is one of `string`, `number`, `bool`, `atom`, `datetime`, `duration`, `error_code`, or a union of members of one kind. `V` is any type. A bare `map` equals `map(any, any)`.

```rill
list[map == map(any, any), map(union(#a, #b), number) == map(union(#b, #a), number)]
# Result: list[true, true]
```

A key type that is not a scalar kind halts `#INVALID_INPUT`; an outer type halts `RILL-P006`.

```rill
guard { map(list, number) } => $r
$r.!code
# Result: #INVALID_INPUT
```

```text
map(atom, number):string
# Error: RILL-P006
```

---

## Map Keys

A key is a scalar literal (a negative number included), `$name`, `(expr)`, or a list literal of keys that share the entry's value. Any other expression, such as `$a.b`, a call, or `??`, needs parentheses. A map has no reserved keys, so `keys` and `values` are ordinary keys.

```rill
"k" => $s
map[$s: 1, ("a" -> .upper): 2, ["x", "y"]: 3].len
# Result: 4
```

```rill
map["keys": 1, "values": 2].keys
# Result: list["keys", "values"]
```

Only a list literal in key position lists several keys. A variable that holds a list is a non-scalar key and halts `#TYPE_MISMATCH`.

```rill
list["x", "y"] => $ks
guard { map[$ks: 1] }.!code
# Result: #TYPE_MISMATCH
```

Each fault below halts with the code shown. A bare identifier is `RILL-P001`, and two literal keys equal by value (`1` and `1.0`) are `RILL-P027`. Two equal computed keys halt `#INVALID_INPUT`, and keys of two kinds or a non-scalar key halt `#TYPE_MISMATCH`.

```rill
"a" => $k
list[
  guard { map[$k: 1, $k: 2] }.!code,
  guard { map[#a: 1, "b": 2] }.!code,
  guard { map[(dict[a: 1]): 1] }.!code
]
# Result: list[#INVALID_INPUT, #TYPE_MISMATCH, #TYPE_MISMATCH]
```

```text
map[a: 1]
# Error: RILL-P001

map[1: "a", 1.0: "b"]
# Error: RILL-P027
```

---

## Map Order and Equality

A map iterates in insertion order. Two maps are equal when they hold equal keys with equal values, in any order.

```rill
list[map[1: "x", 2: "y"].keys, map[1: "a", 2: "b"] == map[2: "b", 1: "a"]]
# Result: list[list[1, 2], true]
```

---

## Map Methods

The methods are `.keys`, `.values`, `.entries`, `.len`, `.empty`, `.eq()`, and `.ne()`. A field name does not select a map entry: `$m.a` halts `RILL-R003`, `.?a` is `false`, and spreading a map into `dict[...]` halts `RILL-R002`.

```rill
map[#a: 1] => $m
list[$m.?a, guard { $m.a }.!code, guard { dict[...$m] }.!code]
# Result: list[false, #RILL_R003, #RILL_R002]
```

---

## Selecting from a Map

```rill
list[map[200: "ok", 404: "missing"][404], map[-1: "last", 0: "first"][-1], map[1: "a"][2] ?? "none"]
# Result: list["missing", "last", "none"]
```

`$m[key]`, `.$k`, and `key -> $m` select by key. The selector must have the held key kind. A negative number is a key, not an index from the end. An absent key halts `RILL-R009`, and `??` recovers it. A wrong key kind halts `#TYPE_MISMATCH`.

```rill
guard { map[1: "a"][2] } => $miss
guard { map[1: "a"]["x"] } => $kind
list[$miss.!code, $kind.!code]
# Result: list[#RILL_R009, #TYPE_MISMATCH]
```

An undeclared empty `map[]` has no key type, so any scalar selector is a missing key. A declared empty map checks the selector against its declared key type.

```rill
map(string, number)[] => $m
list[map[][1] ?? "none", guard { $m[1] }.!code]
# Result: list["none", #TYPE_MISMATCH]
```

A block held as a value runs when selected, with the key as `$`:

```rill
map[404: { "missing {$}" }] => $m
404 -> $m
# Result: "missing 404"
```

---

## Map Type Assertions

An assertion to `map(K, V)` checks every key against `K` and every value against `V`. An empty map has every `map(K, V)`.

```rill
list[
  map[#a: 1, #b: 2] -> :?map(atom, number),
  map[#a: 1, #b: "x"] -> :?map(atom, number),
  map[] -> :?map(string, bool)
]
# Result: list[true, false, true]
```

---

## Sorting a Map

`sort` without a key function orders the entries by key and returns a map. With a key function, `$` is the entry dict and the result is ordered by the key the function returns.

```rill
map["b": 2, "a": 1] -> sort
# Result: map["a": 1, "b": 2]
```

```rill
map["a": 3, "b": 1] -> sort({ $.value })
# Result: map["b": 1, "a": 3]
```

---

## Map Conversion

Only a `dict` and a `map(string, V)` convert to each other, and each value converts to `V`. Any other source halts `RILL-R036`. A string-keyed map converts to a dict only when no key is one of the eight reserved dict method names (see [Dict Keys Are Strings](topic-types.md#dict-keys-are-strings)).

```rill
dict[a: "x"] -> map(string, string) => $m
list[$m["a"], map["a": 1] -> dict]
# Result: list["x", dict[a: 1]]
```

```rill
list[
  guard { map[#a: 1] -> dict }.!code,
  guard { map[#a: 1] -> map(string, number) }.!code,
  guard { map["len": 1] -> dict }.!code,
  guard { ordered[a: 1] -> map }.!code,
  guard { tuple[1] -> map }.!code,
  guard { list[1] -> map }.!code
]
# Result: list[#RILL_R036, #RILL_R036, #RILL_R036, #RILL_R036, #RILL_R036, #RILL_R036]
```

---

## Maps at the Host Boundary

A map crosses to the host as a JavaScript `Map`; an atom key becomes its name string. A host function that returns a JavaScript `Map` whose keys are scalars of one kind produces a rill map. A `Map` with keys of mixed kinds, or with a non-scalar key, halts `RILL-R085`. See [Host Integration](integration-host.md) for the return-value rules.

---

## See Also

| Document | Description |
|----------|-------------|
| [Types](topic-types.md) | Primitives, tuples, dicts, and other collection types |
| [Type System](topic-type-system.md) | Structural types, type assertions, unions |
| [Collections](topic-collections.md) | Iteration, `filter`, and `sort` over a map |
| [Host Integration](integration-host.md) | Host function return values and signatures |
