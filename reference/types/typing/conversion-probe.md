---
id: conversion-probe
title: Conversion probe
status: normative
since: 0.24.0
issues: [682]
grammar: []
errors: []
depends: [halt, type-form, assertion, conversion]
tests: []
---

# Conversion probe

A conversion probe, `value -> =?T`, tests whether converting the value to type `T` would yield a value, and returns the answer as a bool.

## Syntax

r[conversion-probe.form] A probe is `=?` and a type {pending #682}
`=?T` MUST be accepted as a pipe target, where `T` is any type form a conversion accepts.

```ebnf
conversion-probe = "=" , "?" , type-target ;
```

r[conversion-probe.position] A probe follows an expression {pending #682}
`=?T` MUST be accepted after a primary or any postfix operator, as `:?T` is (`assertion.position`),
and the postfix form MUST test the value it follows.

## Evaluation

r[conversion-probe.result] A probe yields whether the conversion would succeed {pending #682}
`v -> =?T` MUST yield `true` when `v -> T` yields a value, and `false` when that conversion halts
because the value does not convert.

r[conversion-probe.no-halt] A value that does not convert does not halt the probe {pending #682}
A probe MUST NOT halt on a value the conversion rejects, and it MUST NOT change the piped value.

r[conversion-probe.type-form] A type form the conversion rejects halts the probe {pending #682}
A type form that `-> T` rejects MUST raise the same error in `=?T`.

## Interactions

A conversion failure this probe can test falls under `halt.probe-rule`.

## Examples

```rill pending=682
"abc" -> =?number
# Result: false
```

```rill pending=682
"5" -> =?number
# Result: true
```

```rill pending=682
list["1", "x"] -> =?list(number)
# Result: false
```

```rill pending=682
list["1", "x"] -> filter({ $=?number })
# Result: list["1"]
```
