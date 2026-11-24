---
id: json
title: json
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, RILL-R044, RILL-R045]
depends: [invocation, defaults, pipe, string, number, bool, list, dict]
tests: [spread.test.ts, args.test.ts, vectors.test.ts, builtin-functions-core.test.ts]
---

# json

`json` yields the JSON text of a value as a string.

## Syntax

```text
json(value: any) -> string
```

## Evaluation

r[json.text] json yields a string of JSON text
`json(v)` MUST yield a string holding the JSON text of `v`, with no whitespace between tokens.

r[json.string] A string serializes as a quoted JSON string
A string MUST serialize as a JSON string: the text in double quotes, with `"`, `\`, and control
characters escaped as JSON requires. Every other character MUST be written as itself, so
`json("é")` yields `"é"`.

r[json.number] A number serializes in its printed form
A number MUST serialize as the text it prints as (`number.print`, `number.print-exponent`), so
`json(1.0)` yields `1` and `json(0.0000001)` yields `1e-7`.

r[json.bool] A bool serializes as its word
`true` and `false` MUST serialize as `true` and `false`.

r[json.list] A list serializes as a JSON array
A list MUST serialize as a JSON array with one member per element, in list order. A string,
number, bool, list, or dict element MUST serialize as it does alone. `json(list[])` yields `[]`.

r[json.dict] A dict serializes as a JSON object
A dict MUST serialize as a JSON object with one member per key, named by the key as a JSON
string. A string, number, bool, list, or dict value MUST serialize as it does alone.
`json(dict[])` yields `{}`.

r[json.unsupported] Ordered, tuple, map, function, type, iterator, stream, and vector halt
An ordered, a tuple, a map, a function, a type value, an iterator, a stream, or a vector MUST
halt with `#INVALID_INPUT`, as the argument or at any depth inside a list or a dict.

## Interactions

`v -> json` passes `v` as the argument (`pipe.call-operand`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The value holds a kind JSON does not carry (`json.unsupported`) | `#INVALID_INPUT` | Yes |
| No argument is passed (`defaults.param-required`) | RILL-R044 | No |
| More than one argument is passed (`invocation.excess`) | RILL-R045 | No |

## Examples

```rill
json(list[1, "a\"b", true, list[]])
# Result: "[1,\"a\\\"b\",true,[]]"
```

```rill
json(dict[a: list[1.5, dict[]]])
# Result: "{{\"a\":[1.5,{{}}]}}"
```

```rill
guard { json(dict[a: tuple[1]]) } => $r
$r.!code
# Result: #INVALID_INPUT
```

## Notes

Which text an atom, a datetime, or a duration serializes as, the order of a dict's members, and
the halt for a held code block are undecided: see INCONSISTENCIES.md.
