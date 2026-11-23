---
id: construct-options
title: Construct options
status: normative
since: 0.24.0
issues: []
grammar: [construct-options, positive-integer, timeout-block]
errors: [INVALID_INPUT, RILL-P001, RILL-P004, RILL-P025, RILL-P027, RILL-R002, RILL-R082, RILL-R083, TYPE_MISMATCH]
depends: [loop, pass]
tests: [construct-options.test.ts, timeout.test.ts, throttling.test.ts]
---

# Construct options

A control statement takes its options as a dict in parentheses between its keyword and its body.

## Syntax

```ebnf
construct-options = "(" , [ dict-element , { "," , dict-element } ] , ")" ;
positive-integer  = nonzero-digit , { digit } ;
timeout-block     = "timeout" , construct-options , block ;
```

```text
keyword(name: value, ...) { body }
guard(...$policy) { body }
```

A spread is legal in `guard`, `pass`, and `timeout`. `construct-options.literal-bound` rejects it in
`retry`, `do`, and `while ... do`.

| Keyword | Options |
|---------|---------|
| `do`, `while ... do` | `limit`, optional |
| `pass` | `ignore_halts` and `async`, bools defaulting to `false` |
| `guard` | `on`, optional |
| `retry` | `attempts`, required, and `on`, optional |
| `timeout` | `total` and `idle`, optional |

## Static rules

r[construct-options.parens] Options are written in parentheses
A control statement's options MUST be written in parentheses after its keyword. The form
`keyword<...>` MUST be rejected with RILL-P025 and a message naming the parenthesized form.

r[construct-options.dict] Options are a dict of the keyword's options type
The options MUST be checked as a dict against the keyword's options type. An unknown option,
a missing required option, or a value of the wrong type MUST halt with `#TYPE_MISMATCH`. An
option with a default MAY be absent. A written option repeated MUST be rejected with RILL-P027.

r[construct-options.named] An option is written with its name
Each entry MUST be a `name: value` entry or a spread. A bare value, as in `retry(3)` or
`guard(1)`, MUST be rejected with RILL-P001.

r[construct-options.order] Options have no order
Options MUST be accepted in any order.

r[construct-options.values] An option value is an expression
An option value MUST be evaluated as an expression and checked against its field's type,
except where a literal is required.

r[construct-options.literal-bound] Bounds are literals
`limit` and `attempts` MUST be written positive integer literals. A computed value or zero MUST be
rejected with RILL-P004. Any spread in the options of `retry`, `do`, or `while ... do` MUST be
rejected with RILL-P004, whatever it supplies. A variable, computed, or multi-key entry in those
options MUST be rejected with RILL-P004.

r[construct-options.spread] A dict may be spread in
In `guard`, `pass`, and `timeout`, `keyword(...$d)` MUST supply the fields of `$d` as options
(`construct-options.literal-bound` rejects a spread in the other keywords). A spread field that
repeats a written option, or a spread or computed key that duplicates another key, MUST halt with
`#INVALID_INPUT`. A spread of a value that is not a dict MUST halt with RILL-R002.

r[construct-options.space] A space before the parenthesis is legal
`keyword (opts)` MUST parse as `keyword(opts)`.

r[construct-options.none] No options means no parentheses
The forms without options, `do { }`, `pass { }`, and `guard { }`, MUST keep their meaning. An
empty `keyword()` is legal for `guard`, `retry`, `timeout`, `pass`, and `do`, and means the same as
the form without parentheses, so `retry() { }` halts `#TYPE_MISMATCH` because `attempts` is required.

r[construct-options.timeout-context] timeout is recognized by what follows it
`timeout` MUST open a timeout block when the identifier is followed by `(` and either the first
entry is `key:` or the matching `)` is followed on the same line by `{`. The body MUST start on
the line where the options end. Any other `timeout` MUST stay an ordinary name, so a host function
called `timeout` remains callable. `timeout<` with the `<` touching the keyword MUST be rejected
with RILL-P025.

r[construct-options.timeout-limits] timeout takes total, idle, both, or neither
`timeout` MUST accept `total`, `idle`, both, or neither. With both, the first limit reached MUST
end the body.

r[construct-options.timeout-idle-activity] idle restarts on activity
`timeout(idle: D)` MUST restart its timer when a stream chunk arrives in the body or a host
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

r[construct-options.timeout-total-expiry] total expiry halts RILL-R082
A body still running when its `total` limit elapses MUST halt with RILL-R082.

r[construct-options.timeout-idle-expiry] idle expiry halts RILL-R083
A body with no activity for its `idle` limit MUST halt with RILL-R083.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| An unknown option, a missing required option, or a wrong value type | `#TYPE_MISMATCH` | Yes |
| `limit` or `attempts` is not a written positive integer literal | RILL-P004 | No |
| A spread, or a variable, computed, or multi-key entry, in the options of `retry`, `do`, or `while ... do` | RILL-P004 | No |
| An option written as a bare value | RILL-P001 | No |
| A `timeout` body does not start on the line where its options end (`construct-options.timeout-context`) | RILL-P004 | No |
| Options written in angle brackets, `keyword<...>` | RILL-P025 | No |
| A written option repeated | RILL-P027 | No |
| A spread field repeats a written option, or a spread or computed key duplicates another key | `#INVALID_INPUT` | Yes |
| A spread value is not a dict | RILL-R002 | Yes |
| A time bound's duration has a months part | `#INVALID_INPUT` | Yes |
| A `timeout` `total` or `idle` limit is above 2147483647 milliseconds | `#INVALID_INPUT` | Yes |
| A `timeout` body outlasts its `total` limit | RILL-R082 | Yes |
| A `timeout` body has no activity for its `idle` limit | RILL-R083 | Yes |

## Examples

```rill
0 -> while ($ < 10) do(limit: 100) { $ + 1 }
# Result: 10
```

```rill
# Error: #TYPE_MISMATCH
retry(attempts: 3, bogus: 1) { 1 }
```

```rill
# Error: RILL-P004
dict[attempts: 3] => $d
retry(...$d) { 1 }
```

## Notes

On 0.23.0 each keyword parses its options in angle brackets with its own grammar, and that form now
halts RILL-P025. `retry` names its bound `limit`, and `pass<on_error: #IGNORE>` is written
`pass(ignore_halts: true)`.
`guard`, `retry`, and `timeout` are stated with errors and limits.
