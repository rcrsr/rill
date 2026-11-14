---
id: construct-options
title: Construct options
status: normative
since: 0.24.0
issues: [578]
grammar: []
errors: []
depends: [loop, pass]
tests: []
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
`keyword<...>` MUST be rejected with a message naming the parenthesized form.

r[construct-options.dict] Options are a dict of the keyword's options type {pending #578}
The options MUST be checked as a dict against the keyword's options type. An unknown option
MUST be rejected, a required option MUST be present, and an option with a default MAY be
absent.

r[construct-options.order] Options have no order {pending #578}
Options MUST be accepted in any order.

r[construct-options.values] An option value is an expression {pending #578}
An option value MUST be evaluated as an expression and checked against its field's type,
except where a literal is required.

r[construct-options.literal-bound] Bounds are literals {pending #578}
`limit` and `attempts` MUST be written integer literals. A spread MUST NOT supply either.

r[construct-options.spread] A dict may be spread in {pending #578}
`keyword(...$d)` MUST supply the fields of `$d` as options.

r[construct-options.space] A space before the parenthesis is legal {pending #578}
`keyword (opts)` MUST parse as `keyword(opts)`.

r[construct-options.none] No options means no parentheses
The forms without options, `do { }`, `pass { }`, and `guard { }`, MUST keep their meaning.

## Examples

```rill pending=578
0 -> while ($ < 10) do(limit: 100) { $ + 1 }
# Result: 10
```

## Notes

On 0.23.0 each keyword parses its options in angle brackets with its own grammar, and `retry`
names its bound `limit`. `guard`, `retry`, and `timeout` are stated with errors and limits.
