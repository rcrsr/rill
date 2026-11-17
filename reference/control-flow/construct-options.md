---
id: construct-options
title: Construct options
status: normative
since: 0.24.0
issues: [578]
grammar: []
errors: [INVALID_INPUT, RILL-P004, RILL-P025, TYPE_MISMATCH]
depends: [loop, pass]
tests: [timeout.test.ts, throttling.test.ts]
---

# Construct options

A control statement takes its options as a dict in parentheses between its keyword and its body.

## Syntax

```text
keyword(name: value, ...) { body }
keyword(...$policy) { body }
```

| Keyword | Options |
|---------|---------|
| `do`, `while ... do` | `limit`, optional |
| `pass` | `ignore_halts` and `async`, bools defaulting to `false` |
| `guard` | `on`, optional |
| `retry` | `attempts`, required, and `on`, optional |
| `timeout` | `total` and `idle`, optional |

## Static rules

r[construct-options.parens] Options are written in parentheses {pending #578}
A control statement's options MUST be written in parentheses after its keyword. The form
`keyword<...>` MUST be rejected with RILL-P025 and a message naming the parenthesized form.

r[construct-options.dict] Options are a dict of the keyword's options type {pending #578}
The options MUST be checked as a dict against the keyword's options type. An unknown option,
a missing required option, or a value of the wrong type MUST halt with `#TYPE_MISMATCH`. An
option with a default MAY be absent.

r[construct-options.order] Options have no order {pending #578}
Options MUST be accepted in any order.

r[construct-options.values] An option value is an expression {pending #578}
An option value MUST be evaluated as an expression and checked against its field's type,
except where a literal is required.

r[construct-options.literal-bound] Bounds are literals {pending #578}
`limit` and `attempts` MUST be written positive integer literals. A computed value, zero, or
a spread that supplies either MUST be rejected with RILL-P004.

r[construct-options.spread] A dict may be spread in {pending #578}
`keyword(...$d)` MUST supply the fields of `$d` as options. A spread field that repeats a written
option MUST halt with `#INVALID_INPUT`.

r[construct-options.space] A space before the parenthesis is legal {pending #578}
`keyword (opts)` MUST parse as `keyword(opts)`.

r[construct-options.none] No options means no parentheses
The forms without options, `do { }`, `pass { }`, and `guard { }`, MUST keep their meaning.

r[construct-options.timeout-limits] timeout takes total, idle, both, or neither
`timeout` MUST accept `total`, `idle`, both, or neither. With both, the first limit reached MUST
end the body.

r[construct-options.timeout-idle-activity] idle restarts on activity
`timeout<idle: D>` MUST restart its timer when a stream chunk arrives in the body or a host
function call returns. That activity MUST restart the idle limit of every enclosing `timeout`. A
body doing neither, such as a pure computation, MUST count as idle. Only a host call that returns
counts; a call that halts does not. Activity in a concurrent sibling branch outside the `timeout`
body MUST NOT restart the limit.

r[construct-options.timeout-fixed-duration] a time bound needs a fixed length
A duration with a nonzero months part has no fixed length. A `timeout` limit or a time-domain
operator option that turns a duration into wall time, such as `debounce`, `throttle`, `sample`, or
the `idle_flush` option of `batch`, MUST halt `#INVALID_INPUT` naming the option for such a
duration.

r[construct-options.timeout-ceiling] a timeout limit has a ceiling
A `timeout` `total` or `idle` limit above 2147483647 milliseconds, about 24.8 days, MUST halt
`#INVALID_INPUT` naming the option before the body runs. A limit of exactly 2147483647 milliseconds
MUST be accepted.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| An unknown option, a missing required option, or a wrong value type | `#TYPE_MISMATCH` | Yes |
| `limit` or `attempts` is not a written positive integer literal | RILL-P004 | No |
| Options written in angle brackets {pending #578} | RILL-P025 | No |
| A spread field repeats a written option {pending #578} | `#INVALID_INPUT` | Yes |
| A time bound's duration has a months part | `#INVALID_INPUT` | Yes |
| A `timeout` `total` or `idle` limit is above 2147483647 milliseconds | `#INVALID_INPUT` | Yes |

## Examples

```rill pending=578
0 -> while ($ < 10) do(limit: 100) { $ + 1 }
# Result: 10
```

```rill pending=578
# Error: #TYPE_MISMATCH
retry(attempts: 3, bogus: 1) { 1 }
```

## Notes

On 0.23.0 each keyword parses its options in angle brackets with its own grammar, and `retry`
names its bound `limit`. `guard`, `retry`, and `timeout` are stated with errors and limits.
