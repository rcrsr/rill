---
id: pass
title: Pass
status: normative
since: 0.24.0
issues: []
grammar: [pass, pass-block]
errors: [RILL-P004, RILL-P025, RILL-R005, TYPE_MISMATCH]
depends: [conditional]
tests: [pass.test.ts, pass-parsing.test.ts, pass-async.test.ts]
---

# Pass

`pass` yields the incoming `$` unchanged; `pass { body }` runs a body for its effects and then
yields the incoming `$`.

## Syntax

```ebnf
pass       = "pass" ;
pass-block = "pass" , construct-options , block ;
```

```text
pass                              the incoming $
v -> pass { body }                run body, yield v
v -> pass(ignore_halts: true) { body }
v -> pass(async: true) { body }
```

## Static rules

r[pass.target-body] pass after an arrow takes a body
`v -> pass` with no body MUST be rejected with RILL-P004.

## Evaluation

r[pass.identity] pass yields the incoming $
`pass` MUST yield the `$` bound where it stands. With none bound, it MUST halt with RILL-R005.

r[pass.body] A pass body runs and its result is discarded
`v -> pass { body }` MUST run `body` with `$` bound to `v`, discard its result, and yield `v`.

r[pass.halts] A pass body halt propagates by default
A halt in a `pass` body MUST propagate unless `ignore_halts` is true.

r[pass.ignore] ignore_halts suppresses catchable halts
With `ignore_halts: true`, a catchable halt in the body MUST be discarded, and `pass` MUST yield
`v`. A non-catchable halt, `break`, and `return` MUST still propagate.

r[pass.async] async runs the body without waiting
With `async: true`, `pass` MUST yield `v` without waiting for the body to finish.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `-> pass` with no body | RILL-P004 | No |
| `pass` where no `$` is bound | RILL-R005 | Yes |
| The options are written in angle brackets (`construct-options.parens`) | RILL-P025 | No |
| `ignore_halts` or `async` is not a bool (`construct-options.dict`) | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
"in" -> .contains("i") ? pass ! "fallback"
# Result: "in"
```

```rill
"s" -> { dict[status: pass] }
# Result: dict[status: "s"]
```

```rill
5 -> pass { $ * 100 }
# Result: 5
```

```rill
10 -> pass(ignore_halts: true) { 1 / 0 }
# Result: 10
```

## Notes

On 0.23.0 the options are written `pass<on_error: #IGNORE>` and `pass<async: true>`, and that form
now halts RILL-P025.
`on_error` accepts only `#IGNORE`, and any other value raises RILL-P004.
