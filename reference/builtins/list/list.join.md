---
id: list.join
title: list.join
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R036]
depends: [method, list, defaults, interpolation, conversion, code-block]
tests: [functions.test.ts, expressions.test.ts, conversion.test.ts, builtin-collection-methods.test.ts]
---

# list.join

`.join` yields one string holding each element of a list, with a separator between elements.

## Syntax

```text
list.join(separator: string = ",") -> string
```

## Evaluation

r[list.join.separator] .join inserts each element between separators
`.join(sep)` MUST yield the receiver's elements in order with `sep` between each two, each
element inserted as interpolation inserts it (`interpolation.string`, `interpolation.printed`).
`list[].join(sep)` MUST yield `""`.

r[list.join.default] The separator defaults to a comma
`.join` with no argument MUST join with `","`.

r[list.join.no-form] An element with no printed form halts
An element that interpolation cannot insert, a function or an iterator at any depth
(`conversion.no-string-nested`), MUST halt `.join` with RILL-R036.

## Interactions

A held block among the elements halts the read (`code-block.non-selecting`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| An element holds a function or an iterator (`conversion.no-string-nested`) | RILL-R036 | Yes |

## Examples

```rill
list[list["a", "b"].join("-"), list[1, true, #c].join, list[].join]
# Result: list["a-b", "1,true,#c", ""]
```

```rill
# Error: cannot convert list to string: contains iterator
list[list[1].first].join
```
