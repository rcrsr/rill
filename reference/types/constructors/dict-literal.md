---
id: dict-literal
title: Dict literals
status: normative
since: 0.24.0
issues: []
grammar: [dict, dict-element, dict-entry, dict-key]
errors: [RILL-R002]
depends: [dict]
tests: [dict-variable-keys.test.ts, parser-syntax-errors.test.ts, type-constructors.test.ts]
---

# Dict literals

A dict literal builds a dict from entries, each binding one or more keys to a value.

## Syntax

```ebnf
dict          = "[" , ":" , "]"
              | "[" , dict-element , { "," , dict-element } , "]"
              | "dict" , "[" , "]"
              | "dict" , "[" , dict-element , { "," , dict-element } , "]" ;
dict-element  = "..." , expression
              | dict-entry ;
dict-key      = identifier | number | bool | string
              | "break" | "return" | "yield" | "pass" | "assert" | "error"
              | "guard" | "retry" | "while" | "do"
              | "$" , identifier
              | "(" , pipe-chain , ")" ;
dict-entry    = ( dict-key | "[" , expression , { "," , expression } , "]" ) , ":" , expression ;
```

## Evaluation

r[dict-literal.key-computed] A variable or computed key evaluates to a string
A variable key such as `$k` and a computed key such as `(expr)` in a dict or ordered literal MUST
evaluate to a string, and that string is the key. Any other value MUST halt with RILL-R002, so
`dict[(1): "n"]` halts while `dict[1: "n"]` holds the key `"1"`.

r[dict-literal.key-multi] An entry MAY list several keys
A list literal in key position of a dict or ordered literal MUST bind each of its elements as a
key to the entry's value, so `dict[["a", "b"]: 1]` equals `dict[a: 1, b: 1]`. Each element is an
expression and MUST evaluate to a string, and an empty list MUST halt with RILL-R002.

## Interactions

A key written as a name, number, or bool follows `dict.key-string`, a key spelled twice follows
`dict.key-duplicate`, and the bare bracket form follows `dict.bare`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A variable, computed, or multi-key key is not a string | RILL-R002 | Yes |
| A multi-key list is empty | RILL-R002 | Yes |

## Examples

```rill
"k" => $k
dict[$k: 1, ("x" -> .upper): 2] == dict[k: 1, X: 2]
# Result: true
```

```rill
dict[["a", "b"]: 1] == dict[a: 1, b: 1]
# Result: true
```

```rill
# Error: RILL-R002
dict[(1): "n"]
```
