---
id: access
title: Access forms
status: normative
since: 0.24.0
issues: []
grammar: [property-access, field-access, bracket-access, method-call, method-name]
errors: [RILL-P001, RILL-P006, RILL-R002]
depends: [selection, ordered]
tests: [expressions.test.ts, property-access.test.ts, ordered-access.test.ts]
---

# Access forms

An access form follows a value and reads a field, an element, or a method result from it.

## Syntax

```ebnf
property-access = field-access | bracket-access ;
field-access  = "." , ( identifier
                      | "$" , identifier ) ;
bracket-access = "[" , pipe-chain , "]" ;
method-call   = "." , method-name , [ "(" , [ arguments ] , ")" ] ;
method-name   = "contains" | "match" | "is_match"
              | "starts_with" | "ends_with"
              | "lower" | "upper"
              | "replace" | "replace_all"
              | "index_of"
              | "repeat"
              | "pad_start" | "pad_end"
              | "empty" | "lines"
              | "eq" | "ne" | "lt" | "gt" | "le" | "ge"
              | "len" | "trim"
              | "head" | "tail"
              | "first"
              | "at"
              | "split" | "join"
              | "keys" | "values" | "entries" ;
```

## Static rules

r[access.field-name] A dot takes a name
A `.` after a value MUST be followed by an identifier or `$` and an identifier. `$t.1` and a
trailing `$d.` MUST be rejected with RILL-P006.

r[access.method-target] A method target takes a name
`v -> .1` MUST be rejected with RILL-P001.

## Evaluation

r[access.any-receiver] A bracket follows any value
`[sel]` MUST apply to the value before it, whether a variable, a literal, a grouped expression,
or a call result: `list[1, 2][0]`, `(list[1, 2])[1]`, and `"a,b".split(",")[1]` select.

r[access.chain] Access forms apply left to right
Each access form MUST apply to the result of the one before it, so `$d.a.b` reads `b` from `$d.a`.

r[access.ordered-key] An ordered selector is a string or a number
A bracket selector on an ordered that is neither a string nor a number MUST halt with RILL-R002
naming its kind.

## Interactions

What each receiver selects is stated in `selection`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A `.` with no name after it | RILL-P006 | No |
| A method target that is not a name | RILL-P001 | No |
| An ordered selector is neither a string nor a number | RILL-R002 | Yes |

## Examples

```rill
"a,b".split(",")[1]
# Result: "b"
```

```rill
dict[a: dict[b: 1]] => $d
$d.a.b
# Result: 1
```

```rill
# Error: RILL-R002
ordered[a: 1][true]
```
