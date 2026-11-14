---
id: guard
title: Guard
status: normative
since: 0.24.0
issues: [578]
grammar: []
errors: [RILL-P004]
depends: [invalid-value]
tests: [guard-retry.test.ts]
---

# Guard

`guard { body }` runs a body and turns a catchable halt inside it into an invalid value.

## Syntax

```text
guard { body }
guard(on: #CODE) { body }
guard(on: list[#A, #B]) { body }
```

## Static rules

r[guard.on-codes] A selector names core error codes
Every atom in `on` MUST be in the closed core error set. An atom outside it MUST be rejected
with RILL-P004.

r[guard.on-empty] A selector is not empty
`on: list[]` MUST be rejected with RILL-P004.

r[guard.on-single] A selector may be one atom {pending #578}
`on: #CODE` MUST mean `on: list[#CODE]`.

## Evaluation

r[guard.pass] A body that completes yields its value
When the body completes, `guard` MUST yield its result unchanged.

r[guard.catch] A catchable halt becomes an invalid value
When the body raises a catchable halt, `guard` MUST yield an invalid value holding that halt.

r[guard.selector] A selector narrows the catch
With `on`, `guard` MUST catch only halts whose code is listed, and MUST let any other halt
propagate.

r[guard.non-catchable] A non-catchable halt passes through
A non-catchable halt (`halt.non-catchable`) MUST propagate out of `guard`.

r[guard.signals] Control signals pass through
`break` and `return` in the body MUST pass through `guard` (`break.not-halt`).

r[guard.dollar] The body sees the incoming $
`$` in the body MUST be the `$` bound where `guard` stands.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `on` names an atom outside the core set, or is empty | RILL-P004 | No |

## Examples

```rill
guard { 1 / 0 } => $r
$r.! ? "failed" ! $r
# Result: "failed"
```

```rill
guard { "x" } -> .upper
# Result: "X"
```

```rill
# Error: Assertion failed
guard { 5 -> assert ($ > 9) }
```

## Notes

On 0.23.0 the selector is written `guard<on: list[#A]>` and takes a list only.
