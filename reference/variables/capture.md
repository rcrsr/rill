---
id: capture
title: Capture
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R001]
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
A capture MUST NOT convert, call, or select. A code block before `=>` runs by its own rule
(`code-block.head`), not because of the capture.

r[capture.assert] A typed capture asserts
`v => $x:T` MUST assert `v` against `T` before binding, as `assertion` states, and MUST NOT
convert.

r[capture.rebind] A later capture replaces the binding
A capture into a bound variable MUST replace its value, subject to the variable's type lock
(`type-lock`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The value does not match the capture's type or the variable's lock | RILL-R001 | Yes |

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

Open decision: #569, which halt a typed capture raises when its assertion fails. On 0.23.0 it is
RILL-R001 "cannot assign".
