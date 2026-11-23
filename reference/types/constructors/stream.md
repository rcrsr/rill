---
id: stream
title: Stream types
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-P006, RILL-R036, TYPE_MISMATCH]
depends: [type-value, structural-typing]
tests: [stream-type-parsing.test.ts, streams.test.ts, type-inner-outer.test.ts, unspecified-type-args.test.ts, type-form-outer.test.ts, type-constructors.test.ts]
---

# Stream types

A stream type describes a stream by two types: the chunk type that iteration yields and the resolution type that invocation returns.

## Syntax

```text
stream                    any stream
stream(string)            chunk type string, resolution unspecified
stream(string):number     chunk type string, resolution number
```

r[stream.slots] A stream type has an inner slot and an outer slot
`stream(T):R` MUST take `T` as its inner and `R` as its outer.

r[stream.chunk] The inner is the chunk type
`stream(T):R` MUST name `T` as the type of each chunk that iteration yields.

r[stream.resolution] The outer is the resolution type
`stream(T):R` MUST name `R` as the type that invoking the stream returns.

r[stream.unspecified-outer] An omitted outer is unspecified
`.outer` on `stream(number)` MUST return `any`. A bare `stream` MUST return `any` from both
`.inner` and `.outer`.

r[stream.unspecified] stream, stream(), and stream(any) are one type
`stream`, `stream()`, and `stream(any)` MUST compare equal.

r[stream.bare-outer] A bare stream MAY take an outer
`stream:R` MUST equal `stream(any):R`.

r[stream.position] A stream type is written in every type position
`stream(T):R` MUST be accepted after an assertion colon, in a capture annotation, as a
parameter type, and as an argument of another type.

## Evaluation

r[stream.accepts] A stream type accepts by its chunk and resolution types
A stream value MUST have `stream(T):R` when `T` accepts its chunk type and `R` accepts its
resolution type, as `list(T)` accepts by element type. `stream(any)` MUST accept every stream,
and a stream type with no outer MUST accept any resolution type.

r[stream.equality] Stream types are equal when both types are equal
`stream(number):string` MUST equal `stream(number):string`. It MUST NOT equal
`stream(number):number` or `stream(number)`.

r[stream.inner] A stream type's inner is the chunk type
`.inner` MUST return `T` for `stream(T):R`.

r[stream.outer] A stream type's outer is the resolution type
`.outer` MUST return `R` for `stream(T):R`.

r[stream.print] A stream type prints its slots
`stream(T):R` MUST print as `stream(T):R`, and a type with no outer MUST print as
`stream(T)`.

r[stream.no-conversion] Assertion applies to a stream and conversion does not
`$s -> :stream(string)` MUST pass a stream whose chunk type is `string`. Piping a stream into
a collection type, such as `list(string)`, MUST halt with RILL-R036.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| Assertion value is not a stream of the asserted type | `#TYPE_MISMATCH` | Yes |
| Pipe of a stream into a collection type | RILL-R036 | Yes |
| Outer on a type that takes none | RILL-P006 | No |

## Examples

```rill
stream(number):string => $t
$t.inner == number
# Result: true
```

```rill
stream(number):string => $t
$t.outer == string
# Result: true
```

```rill
stream(number):string == stream(number):number
# Result: false
```

```rill
stream(number).outer == any
# Result: true
```

## Notes

Superseded: `stream.membership` is now `stream.accepts`.

Streams are stateful and single-use, and `$s == $s` halts RILL-R002 on 0.23.0 builds. Those
facts belong to the stream value, not to its type.

The 0.23.0 `.^chunk` and `.^output` probes are removed; `.inner` and `.outer` on the stream's
type replace them.
