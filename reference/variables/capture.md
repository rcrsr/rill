---
id: capture
title: Capture
status: normative
since: 0.24.0
issues: [569]
grammar: []
errors: [RILL-R001, TYPE_MISMATCH]
depends: [statement, assertion, type-lock]
tests: [capture-types.test.ts, lexer-capture-arrow.test.ts]
---

# Capture

A capture `=> $x` binds the incoming value to a variable and passes the value on unchanged.

## Syntax

```text
v => $x          bind
v => $x:T        bind and assert
v => $x -> ...   bind, then continue the chain
```

## Evaluation

r[capture.bind] A capture binds the incoming value
`v => $x` MUST bind `$x` to `v`.

r[capture.pass-on] A capture passes the value on
The chain after a capture MUST continue with `v`, so `5 => $x => $y` binds both to 5.

r[capture.no-eval] A capture evaluates nothing
A capture MUST NOT convert, call, or select.

r[capture.assert] A typed capture asserts
`v => $x:T` MUST assert `v` against `T` before binding, as `assertion` states, and MUST NOT
convert.

r[capture.mismatch] A typed capture that fails its assertion halts as an assertion does {pending #569}
`v => $x:T` where `v` does not have `T` MUST halt with `#TYPE_MISMATCH`, the halt `v -> :T`
raises. A capture that breaks the variable's type lock keeps RILL-R001 (`type-lock`).

r[capture.rebind] A later capture replaces the binding
A capture into a bound variable MUST replace its value, subject to the variable's type lock
(`type-lock`).

## Interactions

A code block before `=>` runs by its own rule (`code-block.head`), not because of the capture.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The value does not have the capture's type {pending #569} | `#TYPE_MISMATCH` | Yes |
| The value breaks the variable's type lock | RILL-R001 | Yes |

## Examples

```rill
5 => $x -> { $ + 1 } => $y
list[$x, $y]
# Result: list[5, 6]
```

```rill
5 => $x
6 => $x
$x
# Result: 6
```

```rill
# Error: Type mismatch
"5" => $x:number
```

## Notes

On 0.23.0 a typed capture that fails its assertion halts RILL-R001 "cannot assign".
