---
id: destruct
title: Destructure
status: normative
since: 0.24.0
issues: [615, 616]
grammar: [destructure, destruct-pattern]
errors: [RILL-P001, RILL-P026, RILL-R001, RILL-R002, RILL-R009]
depends: [pipe, selection]
tests: [destruct-slice-keyword.test.ts, extraction.test.ts]
---

# Destructure

`v -> destruct<...>` binds the elements or fields of `v` to variables, and passes `v` on.

## Syntax

```ebnf
destructure = "destruct" , "<" , [ destruct-pattern , { "," , destruct-pattern } ] , ">" ;
destruct-pattern = "$" , identifier , [ ":" , capture-type ]
                 | identifier , ":" , "$" , identifier , [ ":" , capture-type ]
                 | "_"
                 | destructure ;
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

r[destruct.no-mix] A pattern is positional or keyed, not both {pending #616}
A pattern that mixes `$name` or `_` elements with `key: $name` elements MUST be rejected with
RILL-P026.

r[destruct.nest-positional] Only a positional element nests
A nested `destruct<...>` MUST appear as a positional element. `key: destruct<...>` MUST be
rejected with RILL-P001.

## Evaluation

r[destruct.positional-source] A positional pattern takes a list or a tuple {pending #615}
A positional pattern MUST bind each element of a list or a tuple, in order. Any other source, an
iterator included, MUST halt with RILL-R002 naming the source's kind.

r[destruct.count] A positional pattern matches the list length
A positional pattern whose element count differs from the list's length MUST halt with
RILL-R002. `destruct<>` matches only an empty list.

r[destruct.skip] _ skips an element
`_` MUST consume one element without binding it.

r[destruct.nested] A nested pattern destructures its element
A nested `destruct<...>` MUST destructure its element by the same rules.

r[destruct.keyed-source] A keyed pattern takes a dict or an ordered {pending #615}
`key: $name` MUST bind the field `key` of a dict or an ordered. A pattern MAY name a subset of
the fields. Any other source MUST halt with RILL-R002 naming the source's kind.

r[destruct.missing] A missing key halts
A keyed element whose key the dict lacks MUST halt with RILL-R009.

r[destruct.bind] Each element binds as a capture
Each `$name` MUST bind as `=> $name` would in the enclosing scope, with the same rebinding and
type lock rules (`capture.bind`, `capture.rebind`, `type-lock.halt`).

r[destruct.typed] A typed element asserts
`$name:T` MUST assert the element against `T` before binding. A mismatch MUST halt with
RILL-R001.

r[destruct.result] destruct yields its input
`v -> destruct<...>` MUST yield `v` unchanged.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `destruct` at a statement head, or a keyed nested pattern | RILL-P001 | No |
| A pattern mixes positional and keyed elements {pending #616} | RILL-P026 | No |
| The source kind does not fit the pattern | RILL-R002 | Yes |
| The pattern and list lengths differ | RILL-R002 | Yes |
| A keyed element names a missing key | RILL-R009 | Yes |
| A typed element fails its type | RILL-R001 | Yes |

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
# Error: Destructure pattern has 2 elements, list has 3
list[1, 2, 3] -> destruct<$a, $b>
```

## Notes

Superseded: `destruct.positional`, now `destruct.positional-source`, and `destruct.keyed`, now
`destruct.keyed-source`. On 0.23.0 a positional pattern takes only a list and a keyed pattern
only a dict, and the halt says "got object" for a tuple.

On 0.23.0 a positional pattern binds a `key: $name` element by position (#616).
