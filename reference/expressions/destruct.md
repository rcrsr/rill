---
id: destruct
title: Destructure
status: normative
since: 0.24.0
issues: []
grammar: [destructure, positional-list, positional-pattern, keyed-list, keyed-pattern]
errors: [RILL-P001, RILL-P026, RILL-R001, RILL-R002, RILL-R009, TYPE_MISMATCH]
depends: [pipe, selection]
tests: [destruct-slice-keyword.test.ts, extraction.test.ts]
---

# Destructure

`v -> destruct<...>` binds the elements or fields of `v` to variables, and passes `v` on.

## Syntax

```ebnf
destructure = "destruct" , "<" , [ positional-list | keyed-list ] , ">" ;
positional-list = positional-pattern , { "," , positional-pattern } ;
positional-pattern = "$" , identifier , [ ":" , capture-type ]
                   | "_"
                   | destructure ;
keyed-list = keyed-pattern , { "," , keyed-pattern } ;
keyed-pattern = identifier , ":" , "$" , identifier , [ ":" , capture-type ] ;
```

```text
list[1, 2] -> destruct<$a, $b>              positional
list[1, 2] -> destruct<$a, _>               skip an element
dict[a: 1] -> destruct<a: $x>               keyed
list[list[1, 2]] -> destruct<destruct<$a, $b>>   nested
```

## Static rules

r[destruct.target] destruct is a pipe target
`destruct<...>` MUST be written after `->`. At the head of a statement it MUST be rejected with
RILL-P001.

r[destruct.no-mix] A pattern is positional or keyed, not both
A pattern that mixes `$name` or `_` elements with `key: $name` elements MUST be rejected with
RILL-P026.

r[destruct.nest-positional] Only a positional element nests
A nested `destruct<...>` MUST appear as a positional element. `key: destruct<...>` MUST be
rejected with RILL-P001.

## Evaluation

r[destruct.positional-source] A positional pattern takes a list or a tuple
A positional pattern MUST bind each element of a list or a tuple, in order. Any other source, an
iterator included, MUST halt with RILL-R002 naming the source's kind.

r[destruct.length] A positional pattern matches the list or tuple length
A positional pattern whose element count differs from the length of the list or tuple MUST
halt with RILL-R002. `destruct<>` matches only an empty list or tuple.

r[destruct.skip] _ skips an element
`_` MUST consume one element without binding it.

r[destruct.nested] A nested pattern destructures its element
A nested `destruct<...>` MUST destructure its element by the same rules.

r[destruct.keyed-source] A keyed pattern takes a dict or an ordered
`key: $name` MUST bind the field `key` of a dict or an ordered. A pattern MAY name a subset of
the fields. Any other source MUST halt with RILL-R002 naming the source's kind.

r[destruct.missing-field] A missing key halts
A keyed element whose key the dict or ordered lacks MUST halt with RILL-R009.

r[destruct.bind] Each element binds as a capture
Each `$name` MUST bind as `=> $name` would in the enclosing scope, with the same rebinding and
type lock rules (`capture.bind`, `capture.rebind`, `type-lock.halt`).

r[destruct.typed] A typed element asserts
`$name:T` MUST assert the element against `T` before binding. A mismatch MUST halt with
`#TYPE_MISMATCH`, as a typed capture does (`capture.mismatch`). An element that breaks the type lock of an
existing variable, with no annotation, MUST halt with RILL-R001 (`type-lock.halt`).

r[destruct.result] destruct yields its input
`v -> destruct<...>` MUST yield `v` unchanged.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `destruct` at a statement head, or a keyed nested pattern | RILL-P001 | No |
| A pattern mixes positional and keyed elements | RILL-P026 | No |
| The source kind does not fit the pattern | RILL-R002 | Yes |
| The pattern and list or tuple lengths differ | RILL-R002 | Yes |
| A keyed element names a missing key | RILL-R009 | Yes |
| A typed element fails its type | `#TYPE_MISMATCH` | Yes |
| An element breaks an existing type lock | RILL-R001 | Yes |

## Examples

```rill
list[1, 2, 3] -> destruct<$a, _, $c>
$a + $c
# Result: 4
```

```rill
dict[name: "ann", age: 30] -> destruct<name: $n>
$n
# Result: "ann"
```

```rill
list[list[1, 2], list[3, 4]] -> destruct<destruct<$a, $b>, destruct<$c, $d>>
$a + $d
# Result: 5
```

```rill
tuple[1, 2] -> destruct<$a, $b>
$a + $b
# Result: 3
```

```rill
ordered[a: 1, b: 2] -> destruct<b: $x>
$x
# Result: 2
```

```rill
# Error: RILL-R002
range(0, 3) -> destruct<$a, $b, $c>
```

```rill
# Error: Destructure pattern has 2 elements, list has 3
list[1, 2, 3] -> destruct<$a, $b>
```

```rill
# Error: Destructure pattern cannot mix positional and keyed elements
list[1, 2] -> destruct<$a, b: $b>
```

## Notes

Superseded: `destruct.positional`, now `destruct.positional-source`, `destruct.keyed`, now
`destruct.keyed-source`, `destruct.count`, now `destruct.length`, and `destruct.missing`, now
`destruct.missing-field`. On 0.23.0 a positional pattern takes only a list and a keyed pattern
only a dict, and the halt says "got object" for a tuple.
