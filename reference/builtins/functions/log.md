---
id: log
title: log
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R044, RILL-R045, TYPE_MISMATCH]
depends: [invocation, defaults, pipe, interpolation, code-block]
tests: [methods.test.ts, expressions.test.ts, code-block.test.ts, builtin-functions-core.test.ts]
---

# log

`log` passes the text of a value to the host's log callback and yields the value.

## Syntax

```text
log(message: any) -> any
```

## Evaluation

r[log.value] log yields its argument unchanged
`log(v)` MUST yield `v`, so `v -> log -> .upper` continues the chain with `v`.

r[log.text] log writes the text an interpolation inserts
`log(v)` MUST pass the host's log callback one string: the text that interpolating `v` inserts
(`interpolation.string`, `interpolation.printed`). A string is passed without quotes, and
`log(list["a"])` passes `list["a"]`.

r[log.immediate] Each call writes once, when it runs
Each call of `log` MUST pass its text once, before it yields, in evaluation order. A halt raised
after the call MUST NOT withdraw the text: `guard { log(1)` then `1 / 0 }` passes `1`.

## Interactions

A held code block anywhere in the argument halts before any text is passed
(`code-block.non-selecting`). `v -> log` passes `v` as the argument (`pipe.call-operand`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The argument holds a code block (`code-block.non-selecting`) | `#TYPE_MISMATCH` | Yes |
| No argument is passed (`defaults.param-required`) | RILL-R044 | No |
| More than one argument is passed (`invocation.excess`) | RILL-R045 | No |

## Examples

```rill
"a" -> log -> .upper
# Result: "A"
```

```rill
list[1, 2] -> seq({ log($) * 10 })
# Result: list[10, 20]
```

```rill
# Error: entry 'a' holds a code block
log(dict[a: { $ + 1 }])
```

## Notes

A function or an iterator has no interpolated text (`conversion.no-string-form`), yet `log` of
one passes `type(fn)` or `type(iterator)`. Which text `log` passes for them is undecided: see
INCONSISTENCIES.md.
